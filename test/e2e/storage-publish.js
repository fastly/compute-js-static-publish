/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Tests for publishing to real storage (a KV Store or an S3-compatible bucket).
// The credentials come only from the environment. The tests use a unique
// publish ID and the collection 'e2e', and delete all their keys at the end.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';

import {
  REPO_DIR,
  makeTempDir,
  parseUploadSummary,
  rawRequest,
  removeDir,
  runCli,
  scaffoldApp,
  startServe,
  uniquePublishId,
  writeFixtureContent,
  writeTestAppIndex,
} from './helpers.js';
import { checkResponseCache, checkServedContent } from './served-content.js';

export const COLLECTION_NAME = 'e2e';

// Larger than the KV Store chunk size (20 MiB), so that the KV Store provider
// splits it into chunks.
const LARGE_BINARY_BYTES = 21 * 1024 * 1024;

// Creates the storage provider of the CLI, to list the keys in storage.
async function loadCliStorageProvider(computeJsDir, storageMode) {
  const rcUrl = pathToFileURL(path.resolve(computeJsDir, 'static-publish.rc.js'));
  const { default: rc } = await import(rcUrl.href);
  const providerModule = storageMode === 's3' ? 's3-storage-provider.js' : 'kv-store-provider.js';
  const { buildStoreProvider } = await import(pathToFileURL(path.resolve(REPO_DIR, 'build/cli/cli/storage', providerModule)).href);
  const provider = await buildStoreProvider(rc, {
    computeAppDir: computeJsDir,
    localMode: false,
    fastlyApiToken: undefined,
    s3AccessKeyId: undefined,
    s3SecretAccessKey: undefined,
  });
  assert.ok(provider != null, 'the CLI storage provider is created');
  return provider;
}

// Defines the tests. Call it in a describe() block.
//   storageMode: 'kv-store' or 's3'
//   scaffoldArgs: the storage arguments for the scaffolder
//   serve: true to also serve the content with `fastly compute serve`.
//     Only S3 mode can do this: a local server cannot read a real KV Store.
//   purgeServiceId: if set, publish with --fastly-service-id and examine the
//     purge. If not set, make sure that no purge runs.
export function defineStoragePublishTests({ storageMode, scaffoldArgs, serve = false, purgeServiceId }) {
  const publishId = uniquePublishId('e2e');
  let dir;
  let computeJsDir;
  let provider;
  let server;
  let cleanedUp = false;

  // FASTLY_SERVICE_ID is empty, so that the CLI purges only the service of the test.
  const cliEnv = { FASTLY_SERVICE_ID: '' };
  const publishArgs = [ 'publish-content', '--collection-name', COLLECTION_NAME, '--expires-in', '1d' ];
  if (purgeServiceId) {
    publishArgs.push('--fastly-service-id', purgeServiceId);
  }

  function publish() {
    // Delete the working directory first, to simulate a new CI checkout.
    fs.rmSync(path.resolve(computeJsDir, 'static-publisher'), { recursive: true, force: true });
    return runCli(publishArgs, { cwd: computeJsDir, env: cliEnv }).output;
  }

  async function listKeys() {
    return (await provider.getStorageKeys(`${publishId}_`)) ?? [];
  }

  async function deleteCollectionAndClean() {
    runCli([ 'collections', 'delete', '--collection-name', COLLECTION_NAME ], { cwd: computeJsDir, env: cliEnv });
    runCli([ 'clean' ], { cwd: computeJsDir, env: cliEnv });
  }

  before(async () => {
    console.log(`Publish ID: ${publishId}`);
    dir = makeTempDir(storageMode);
    writeFixtureContent(path.resolve(dir, 'public'), { largeBinaryBytes: LARGE_BINARY_BYTES });
    computeJsDir = scaffoldApp(dir, [ '--publish-id', publishId, ...scaffoldArgs ]);
    provider = await loadCliStorageProvider(computeJsDir, storageMode);
  });

  after(async () => {
    await server?.stop();
    // If a test failed before the cleanup test, try to delete the keys now.
    if (!cleanedUp && computeJsDir != null) {
      try {
        await deleteCollectionAndClean();
      } catch (err) {
        console.error(`Could not delete the test keys for publish ID ${publishId}:`, err);
      }
    }
    if (dir != null) {
      removeDir(dir);
    }
  });

  // The tests are steps of one sequence. If a step fails, skip the steps
  // after it (except the cleanup), so that the output shows the first failure.
  let failed = false;
  function step(name, fn) {
    test(name, async (t) => {
      if (failed) {
        t.skip('an earlier step failed');
        return;
      }
      try {
        await fn(t);
      } catch (err) {
        failed = true;
        throw err;
      }
    });
  }

  let firstPublishOutput;
  step('publishes the content', async () => {
    firstPublishOutput = publish();
    const summary = parseUploadSummary(firstPublishOutput);
    assert.ok(summary != null, 'the output has the upload summary');
    assert.equal(summary.existing, 0);
    assert.ok(summary.toUpload > 0);
    const keys = await listKeys();
    assert.ok(keys.includes(`${publishId}_index_${COLLECTION_NAME}`), 'has the index');
    assert.ok(keys.includes(`${publishId}_settings_${COLLECTION_NAME}`), 'has the settings');
  });

  step('skips all files that are already in storage', () => {
    const output = publish();
    const summary = parseUploadSummary(output);
    assert.ok(summary != null, 'the output has the upload summary');
    assert.ok(summary.existing > 0);
    assert.equal(summary.toUpload, 0);
  });

  step('lists the collection', () => {
    const { output } = runCli([ 'collections', 'list' ], { cwd: computeJsDir, env: cliEnv });
    assert.match(output, new RegExp(`^\\s+${COLLECTION_NAME}$`, 'm'));
  });

  if (purgeServiceId) {
    step('purges the surrogate key of the collection', () => {
      assert.match(firstPublishOutput, new RegExp(`Purging surrogate key \\[${publishId}-${COLLECTION_NAME}\\]`));
      assert.match(firstPublishOutput, /^Purged$/m);
    });
  } else {
    step('does not purge without a Service ID', () => {
      assert.doesNotMatch(firstPublishOutput, /Purging surrogate key/);
    });
  }

  if (serve) {
    step('serves the published content', async (t) => {
      writeTestAppIndex(computeJsDir, { activeCollectionName: COLLECTION_NAME });
      server = await startServe(computeJsDir);
      await checkServedContent(t, server.baseUrl);
      await t.test('caches responses with the response cache', async (t) => {
        await checkResponseCache(t, server.baseUrl);
      });
      await t.test('serves a file that is larger than 20 MiB', async () => {
        const res = await rawRequest(server.baseUrl + '/large.bin');
        assert.equal(res.status, 200);
        const expected = fs.readFileSync(path.resolve(dir, 'public/large.bin'));
        assert.equal(res.body.length, expected.length);
        assert.ok(res.body.equals(expected), 'the body is the same as the file');
      });
      await server.stop();
      server = null;
    });
  }

  test('collections delete and clean remove all the keys', async (t) => {
    if (failed) {
      t.skip('an earlier step failed. The after() hook tries to delete the keys');
      return;
    }
    await deleteCollectionAndClean();
    cleanedUp = true;
    assert.deepEqual(await listKeys(), []);
  });
}
