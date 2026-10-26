/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Scaffolds a KV Store app, publishes with --local, and serves the app with
// `fastly compute serve`. Needs the Fastly CLI and network access for
// `npm install`. No credentials are necessary.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import {
  makeTempDir,
  rawRequest,
  removeDir,
  runCli,
  scaffoldApp,
  skipUnlessFastlyCli,
  startServe,
  writeFixtureContent,
  writeTestAppIndex,
} from './helpers.js';
import { checkResponseCache, checkServedContent } from './served-content.js';

describe('local mode (fastly compute serve)', { skip: skipUnlessFastlyCli() }, () => {
  let dir;
  let computeJsDir;
  let server;

  before(async () => {
    dir = makeTempDir('local');
    writeFixtureContent(path.resolve(dir, 'public'));
    computeJsDir = scaffoldApp(dir, [ '--kv-store-name', 'e2e-content' ]);
    writeTestAppIndex(computeJsDir);
    runCli([ 'publish-content', '--local' ], { cwd: computeJsDir });
    server = await startServe(computeJsDir);
  });

  after(async () => {
    await server?.stop();
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('writes the local KV Store file', () => {
    const kvStoreJson = JSON.parse(fs.readFileSync(path.resolve(computeJsDir, 'static-publisher/kvstore.json'), 'utf-8'));
    const keys = Object.keys(kvStoreJson);
    assert.ok(keys.includes('default_index_live'), 'has the index');
    assert.ok(keys.includes('default_settings_live'), 'has the settings');
    assert.ok(keys.some(key => key.startsWith('default_files_sha256_')), 'has files');
  });

  test('does not write publicDirPrefix to publish-content.config.js', () => {
    const config = fs.readFileSync(path.resolve(computeJsDir, 'publish-content.config.js'), 'utf-8');
    assert.doesNotMatch(config, /publicDirPrefix/);
  });

  test('serves the published content', async (t) => {
    await checkServedContent(t, server.baseUrl);
  });

  test('caches responses with the response cache', async (t) => {
    await checkResponseCache(t, server.baseUrl);
  });

  test('lists the collection', () => {
    const { output } = runCli([ 'collections', 'list', '--local' ], { cwd: computeJsDir });
    assert.match(output, /live \*DEFAULT\*/);
  });
});

// The public dir is under the root dir. The asset keys are relative to the
// root dir, so the server must add publicDirPrefix to the request path.
describe('local mode with a public dir under the root dir', { skip: skipUnlessFastlyCli() }, () => {
  let dir;
  let computeJsDir;
  let server;

  before(async () => {
    dir = makeTempDir('local-public-dir');
    writeFixtureContent(path.resolve(dir, 'site/public'));
    computeJsDir = scaffoldApp(dir, [ '--public-dir', './site/public', '--kv-store-name', 'e2e-content' ], { rootDir: './site' });
    writeTestAppIndex(computeJsDir);
    runCli([ 'publish-content', '--local' ], { cwd: computeJsDir });
    server = await startServe(computeJsDir);
  });

  after(async () => {
    await server?.stop();
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('writes publicDirPrefix to publish-content.config.js', () => {
    const config = fs.readFileSync(path.resolve(computeJsDir, 'publish-content.config.js'), 'utf-8');
    assert.match(config, /publicDirPrefix: "\/public"/);
  });

  test('serves the published content', async (t) => {
    await checkServedContent(t, server.baseUrl);
  });
});

// A newer version can publish a collection that needs a feature that this
// version does not support. Then this version must not serve the collection.
describe('local mode with a collection that requires an unsupported feature', { skip: skipUnlessFastlyCli() }, () => {
  let dir;
  let computeJsDir;
  let kvStoreJsonPath;
  let server;

  const readKvStoreJson = () => JSON.parse(fs.readFileSync(kvStoreJsonPath, 'utf-8'));

  before(async () => {
    dir = makeTempDir('local-requires');
    writeFixtureContent(path.resolve(dir, 'public'));
    computeJsDir = scaffoldApp(dir, [ '--kv-store-name', 'e2e-content' ]);
    runCli([ 'publish-content', '--local' ], { cwd: computeJsDir });

    // Do what a newer CLI does: add a feature to the metadata of the index.
    kvStoreJsonPath = path.resolve(computeJsDir, 'static-publisher/kvstore.json');
    const kvStoreJson = readKvStoreJson();
    const indexEntry = kvStoreJson['default_index_live'];
    indexEntry.metadata = JSON.stringify({ ...JSON.parse(indexEntry.metadata), requires: 'future-feature', futureField: 'x' });
    fs.writeFileSync(kvStoreJsonPath, JSON.stringify(kvStoreJson));

    runCli([ 'collections', 'promote', '--collection-name', 'live', '--to', 'copy', '--local' ], { cwd: computeJsDir });
    server = await startServe(computeJsDir);
  });

  after(async () => {
    await server?.stop();
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('does not serve the collection', async () => {
    const res = await rawRequest(server.baseUrl + '/', { headers: { accept: 'text/html' } });
    assert.equal(res.status, 404);
    assert.doesNotMatch(res.body.toString(), /<h1>Home<\/h1>/);
  });

  test('promote keeps the fields of the metadata', () => {
    const metadata = JSON.parse(readKvStoreJson()['default_index_copy'].metadata);
    assert.equal(metadata.requires, 'future-feature');
    assert.equal(metadata.futureField, 'x');
  });

  test('collections list shows the feature', () => {
    const { output } = runCli([ 'collections', 'list', '--local' ], { cwd: computeJsDir });
    assert.match(output, /Requires {3}: future-feature/);
    assert.match(output, /This version does not support future-feature/);
  });
});

// Storage can return a body that does not have the size in its metadata, for
// example a KV Store entry whose metadata reached the POP before its body. The
// server must not serve or cache such a body as a complete response.
describe('local mode with a body that does not have its stored size', { skip: skipUnlessFastlyCli() }, () => {
  let dir;
  let computeJsDir;
  let server;

  const headers = { 'x-server-timing': '1' };
  const cacheHeaders = { ...headers, 'x-use-cache': '1' };

  // Replaces the body of the original variant of a file, and keeps its metadata.
  function replaceBody(kvStoreJson, assetPath, body) {
    const index = JSON.parse(fs.readFileSync(path.resolve(computeJsDir, kvStoreJson['default_index_live'].file), 'utf-8'));
    const key = 'default_files_sha256_' + index[assetPath].key.slice('sha256:'.length);
    const bodyFile = `static-publisher/replaced-${path.basename(assetPath)}`;
    fs.writeFileSync(path.resolve(computeJsDir, bodyFile), body);
    kvStoreJson[key].file = bodyFile;
  }

  before(async () => {
    dir = makeTempDir('local-body-size');
    writeFixtureContent(path.resolve(dir, 'public'));
    computeJsDir = scaffoldApp(dir, [ '--kv-store-name', 'e2e-content' ]);
    writeTestAppIndex(computeJsDir);
    runCli([ 'publish-content', '--local' ], { cwd: computeJsDir });

    const kvStoreJsonPath = path.resolve(computeJsDir, 'static-publisher/kvstore.json');
    const kvStoreJson = JSON.parse(fs.readFileSync(kvStoreJsonPath, 'utf-8'));
    replaceBody(kvStoreJson, '/about.html', '');
    replaceBody(kvStoreJson, '/cached.html', '<!doctype');
    fs.writeFileSync(kvStoreJsonPath, JSON.stringify(kvStoreJson));

    server = await startServe(computeJsDir);
  });

  after(async () => {
    await server?.stop();
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('answers 500 for an empty body, and logs the sizes', async () => {
    const res = await rawRequest(server.baseUrl + '/about.html', { headers });
    assert.equal(res.status, 500);
    assert.match(server.getOutput(), /File sha256:\w+ \(identity\): expected \d+ bytes, got 0/);
  });

  test('stops the response for a short body, and logs the sizes', async () => {
    await assert.rejects(rawRequest(server.baseUrl + '/cached.html', { headers }));
    assert.match(server.getOutput(), /File sha256:\w+ \(identity\): expected \d+ bytes, got 9/);
  });

  test('does not cache an empty or a short body', async () => {
    for (const assetPath of [ '/about.html', '/cached.html' ]) {
      for (let i = 0; i < 2; i++) {
        const res = await rawRequest(server.baseUrl + assetPath, { headers: cacheHeaders });
        assert.equal(res.status, 500, `${assetPath}, request ${i + 1}`);
      }
    }
  });

  test('serves and caches a body that has its stored size', async () => {
    const first = await rawRequest(server.baseUrl + '/index.html', { headers: cacheHeaders });
    assert.equal(first.status, 200);
    assert.match(first.headers['server-timing'] ?? '', /\bcache;dur=[\d.]+;desc="miss"/);
    const second = await rawRequest(server.baseUrl + '/index.html', { headers: cacheHeaders });
    assert.equal(second.status, 200);
    assert.match(second.headers['server-timing'] ?? '', /\bcache;dur=[\d.]+;desc="hit/);
  });
});
