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
