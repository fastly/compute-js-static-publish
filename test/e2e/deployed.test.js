/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Deploys an app to a real Fastly service, and makes sure that the purge after
// a publish clears the response cache. The app uses a real KV Store.
//
// Set these environment variables:
//   FASTLY_API_TOKEN             an API token that can write to the KV Store,
//                                deploy to the service, and purge the service
//   CJSP_TEST_KV_STORE_NAME      the name of a KV Store for tests
//   CJSP_TEST_DEPLOY_SERVICE_ID  a Compute service for tests. THE TEST REPLACES
//                                THE ACTIVE VERSION OF THIS SERVICE.
//   CJSP_TEST_DEPLOY_URL         the URL of the service, for example
//                                https://<name>.edgecompute.app
//
// Before the first run, link the KV Store to the service with the name
// CJSP_TEST_KV_STORE_NAME. See test/README.md.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  makeTempDir,
  rawRequest,
  removeDir,
  run,
  runCli,
  scaffoldApp,
  skipUnlessEnv,
  skipUnlessFastlyCli,
  uniquePublishId,
  writeFixtureContent,
  writeTestAppIndex,
} from './helpers.js';

const COLLECTION_NAME = 'e2e';

// A long max age, so that only a purge can make the cache serve new content
// during the test.
const RESPONSE_CACHE_MAX_AGE = 3600;

const skip =
  skipUnlessEnv('FASTLY_API_TOKEN', 'CJSP_TEST_KV_STORE_NAME', 'CJSP_TEST_DEPLOY_SERVICE_ID', 'CJSP_TEST_DEPLOY_URL') ||
  skipUnlessFastlyCli();

// Calls fn until it returns a value that is not undefined. Throws with the last
// value of describeLast() if the time ends.
async function waitFor(fn, { timeoutMs, intervalMs = 2000, describeLast }) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const result = await fn();
    if (result !== undefined) {
      return result;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs} ms. ${describeLast?.() ?? ''}`);
    }
    await sleep(intervalMs);
  }
}

describe('deployed service', { skip }, () => {
  const serviceId = process.env.CJSP_TEST_DEPLOY_SERVICE_ID;
  const baseUrl = process.env.CJSP_TEST_DEPLOY_URL?.replace(/\/+$/, '');
  const publishId = uniquePublishId('e2e');
  let dir;
  let computeJsDir;
  let publicDir;

  // FASTLY_SERVICE_ID is empty, so that the CLI purges only when a test asks for it.
  const cliEnv = { FASTLY_SERVICE_ID: '' };

  function writeVersion(version) {
    fs.writeFileSync(path.resolve(publicDir, 'version.txt'), version);
  }

  function publish({ purge }) {
    fs.rmSync(path.resolve(computeJsDir, 'static-publisher'), { recursive: true, force: true });
    const args = [ 'publish-content', '--collection-name', COLLECTION_NAME, '--expires-in', '1d' ];
    if (purge) {
      args.push('--fastly-service-id', serviceId);
    }
    return runCli(args, { cwd: computeJsDir, env: cliEnv }).output;
  }

  let last;
  async function getVersion() {
    last = await rawRequest(baseUrl + '/version.txt', {
      headers: { 'x-use-cache': '1', 'x-server-timing': '1' },
    });
    return last;
  }
  function describeLast() {
    if (last == null) {
      return 'No response.';
    }
    return `Last response: ${last.status}, Server-Timing: ${last.headers['server-timing']}, body: ${last.body.toString().slice(0, 200)}. ` +
      'If the status is 500, make sure that the KV Store is linked to the service (see test/README.md).';
  }
  const isHit = (res) => /\bcache;dur=[\d.]+;desc="hit/.test(res.headers['server-timing'] ?? '');

  // The tests are steps of one sequence. If a step fails, skip the steps
  // after it, so that the output shows the first failure.
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

  before(() => {
    console.log(`Publish ID: ${publishId}`);
    dir = makeTempDir('deployed');
    publicDir = path.resolve(dir, 'public');
    writeFixtureContent(publicDir);
    writeVersion(`v1 ${publishId}`);
    // Do not give --service-id to the scaffolder. Then fastly.toml has no
    // service_id, and publish-content purges only with --fastly-service-id.
    computeJsDir = scaffoldApp(dir, [
      '--publish-id', publishId,
      '--kv-store-name', process.env.CJSP_TEST_KV_STORE_NAME,
    ]);
    writeTestAppIndex(computeJsDir, {
      activeCollectionName: COLLECTION_NAME,
      responseCacheMaxAge: RESPONSE_CACHE_MAX_AGE,
    });
  });

  after(() => {
    if (computeJsDir != null) {
      try {
        runCli([ 'collections', 'delete', '--collection-name', COLLECTION_NAME ], { cwd: computeJsDir, env: cliEnv });
        runCli([ 'clean' ], { cwd: computeJsDir, env: cliEnv });
      } catch (err) {
        console.error(`Could not delete the test keys for publish ID ${publishId}:`, err);
      }
    }
    if (dir != null) {
      removeDir(dir);
    }
  });

  step('publishes and deploys the app', async () => {
    publish({ purge: false });
    run('fastly', [
      'compute', 'publish',
      '--service-id', serviceId,
      // The latest version has the KV Store link, also if it is not active yet.
      '--version', 'latest',
      '--non-interactive',
      '--status-check-off',
      '--comment', `compute-js-static-publish e2e test ${publishId}`,
    ], { cwd: computeJsDir });

    // Wait until the new version of the app serves the content.
    await waitFor(async () => {
      const res = await getVersion();
      return res.status === 200 && res.body.toString() === `v1 ${publishId}` ? res : undefined;
    }, { timeoutMs: 300_000, intervalMs: 5000, describeLast });
  });

  step('caches the response', async () => {
    await waitFor(async () => {
      const res = await getVersion();
      return isHit(res) ? res : undefined;
    }, { timeoutMs: 60_000, describeLast });
    assert.equal(last.body.toString(), `v1 ${publishId}`);
  });

  step('without a purge, the cache serves the old content', async () => {
    writeVersion(`v2 ${publishId}`);
    const output = publish({ purge: false });
    assert.doesNotMatch(output, /Purging surrogate key/);

    // Give the KV Store time to have the new index everywhere.
    await sleep(30_000);
    for (let i = 0; i < 5; i++) {
      const res = await getVersion();
      assert.ok(isHit(res), `response ${i} is a cache hit. ${describeLast()}`);
      assert.equal(res.body.toString(), `v1 ${publishId}`);
    }
  });

  step('a publish with a purge makes the cache serve the new content', async () => {
    const output = publish({ purge: true });
    assert.match(output, new RegExp(`Purging surrogate key \\[${publishId}-${COLLECTION_NAME}\\]`));
    assert.match(output, /^Purged$/m);

    // The response cache keeps responses for RESPONSE_CACHE_MAX_AGE (one hour).
    // Thus, if the new content comes before that, the purge cleared the cache.
    await waitFor(async () => {
      const res = await getVersion();
      return res.status === 200 && res.body.toString() === `v2 ${publishId}` ? res : undefined;
    }, { timeoutMs: 180_000, describeLast });
  });
});
