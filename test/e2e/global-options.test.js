/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Checks --version and --project-dir. Needs network access for the
// `npm install` of the scaffolder. No credentials are necessary.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { REPO_DIR, makeTempDir, removeDir, runCli, scaffoldApp, writeFixtureContent } from './helpers.js';

const VERSION = JSON.parse(fs.readFileSync(path.resolve(REPO_DIR, 'package.json'), 'utf-8')).version;

describe('global options', () => {
  let dir;
  let computeJsDir;

  before(() => {
    dir = makeTempDir('global-options');
    writeFixtureContent(path.resolve(dir, 'public'));
    computeJsDir = scaffoldApp(dir, [ '--kv-store-name', 'e2e-content' ]);
  });

  after(() => {
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('--version prints only the version, in any directory', () => {
    for (const cwd of [ dir, computeJsDir ]) {
      const result = runCli([ '--version' ], { cwd });
      assert.equal(result.stdout, `${VERSION}\n`, cwd);
    }
  });

  test('--project-dir runs a command for the app in another directory', () => {
    runCli([ 'publish-content', '--local', '--project-dir=./compute-js' ], { cwd: dir });
    // The working dir is relative to the directory of static-publish.rc.js.
    assert.equal(fs.existsSync(path.resolve(computeJsDir, 'static-publisher/kvstore.json')), true);
    assert.equal(fs.existsSync(path.resolve(dir, 'static-publisher')), false);
    const result = runCli([ 'collections', 'list', '--local', '--project-dir', './compute-js' ], { cwd: dir });
    assert.match(result.output, /live/);
  });

  test('--project-dir fails for a directory with no static-publish.rc.js', () => {
    const result = runCli([ 'publish-content', '--local', '--project-dir=./public' ], { cwd: dir, allowFailure: true });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /has no static-publish\.rc\.js/);
    assert.equal(fs.existsSync(path.resolve(dir, 'public/compute-js')), false, 'nothing was scaffolded');
  });

  test('--project-dir fails for a directory that does not exist', () => {
    const result = runCli([ 'collections', 'list', '--project-dir=./missing' ], { cwd: dir, allowFailure: true });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /is not a directory/);
  });
});
