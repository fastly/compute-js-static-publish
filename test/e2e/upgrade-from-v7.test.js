/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Examines the upgrade steps in MIGRATING.md. Scaffolds and publishes an app
// with v7 from npm, then installs this checkout in the same app without a new
// scaffold. Needs the Fastly CLI and network access. No credentials are
// necessary.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import {
  REPO_DIR,
  makeTempDir,
  removeDir,
  run,
  runCli,
  skipUnlessFastlyCli,
  startServe,
  writeFixtureContent,
  writeTestAppIndex,
} from './helpers.js';
import { checkResponseCache, checkServedContent } from './served-content.js';

describe('upgrade from v7', { skip: skipUnlessFastlyCli() }, () => {
  let dir;
  let computeJsDir;
  let server;

  before(() => {
    dir = makeTempDir('upgrade');
    writeFixtureContent(path.resolve(dir, 'public'));

    // Scaffold and publish with v7.
    run('npx', [ '-y', '@fastly/compute-js-static-publish@7', '--root-dir', './public', '--kv-store-name', 'e2e-content' ], { cwd: dir });
    computeJsDir = path.resolve(dir, 'compute-js');
    run('npm', [ 'run', 'dev:publish' ], { cwd: computeJsDir });

    // Install this checkout. Do not scaffold again.
    run('npm', [ 'install', '--save-dev', `file:${REPO_DIR}` ], { cwd: computeJsDir });
  });

  after(async () => {
    await server?.stop();
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('the v7 app uses the legacy static-publish.rc.js format', () => {
    const rcText = fs.readFileSync(path.resolve(computeJsDir, 'static-publish.rc.js'), 'utf-8');
    assert.match(rcText, /kvStoreName/);
    assert.doesNotMatch(rcText, /storageMode/);
  });

  test('v8 serves the content that v7 published', async (t) => {
    server = await startServe(computeJsDir);
    try {
      await checkServedContent(t, server.baseUrl, { autoExt: false, contentTypes: false, serverTiming: false });
    } finally {
      await server.stop();
      server = null;
    }
  });

  test('v8 publishes with the v7 static-publish.rc.js', async (t) => {
    runCli([ 'publish-content', '--local' ], { cwd: computeJsDir });
    writeTestAppIndex(computeJsDir);
    server = await startServe(computeJsDir);
    await checkServedContent(t, server.baseUrl, { autoExt: false });
    await t.test('caches responses with the response cache', async (t) => {
      await checkResponseCache(t, server.baseUrl);
    });
  });
});
