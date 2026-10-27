/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Checks the collection name rules of the CLI, with --local. Needs network
// access for `npm install`. No credentials are necessary.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { makeTempDir, removeDir, runCli, scaffoldApp, writeFixtureContent } from './helpers.js';

describe('collection names', () => {
  let dir;
  let computeJsDir;

  before(() => {
    dir = makeTempDir('collection-names');
    writeFixtureContent(path.resolve(dir, 'public'));
    computeJsDir = scaffoldApp(dir, [ '--kv-store-name', 'e2e-content' ]);
    runCli([ 'publish-content', '--local' ], { cwd: computeJsDir });
  });

  after(() => {
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('publish to a new collection with a name that is not valid fails', () => {
    const result = runCli([ 'publish-content', '--local', '--collection-name', 'Feature_X' ], { cwd: computeJsDir, allowFailure: true });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /Collection name 'Feature_X' is not valid/);
  });

  test('publish to an existing collection with a name that is not valid warns and works', () => {
    // A name like this could be published before the rule existed.
    const kvStoreJsonPath = path.resolve(computeJsDir, 'static-publisher/kvstore.json');
    const kvStoreJson = JSON.parse(fs.readFileSync(kvStoreJsonPath, 'utf-8'));
    kvStoreJson['default_index_feature_x'] = kvStoreJson['default_index_live'];
    kvStoreJson['default_settings_feature_x'] = kvStoreJson['default_settings_live'];
    fs.writeFileSync(kvStoreJsonPath, JSON.stringify(kvStoreJson));

    const result = runCli([ 'publish-content', '--local', '--collection-name', 'feature_x' ], { cwd: computeJsDir });
    assert.equal(result.status, 0);
    assert.match(result.output, /Warning: Collection name 'feature_x' is not valid/);
  });

  test('promote to a new collection with a name that is not valid fails', () => {
    const result = runCli([ 'collections', 'promote', '--local', '--collection-name', 'live', '--to', 'Staging' ], { cwd: computeJsDir, allowFailure: true });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /Collection name 'Staging' is not valid/);
  });

  test('promote to a valid name works', () => {
    const result = runCli([ 'collections', 'promote', '--local', '--collection-name', 'live', '--to', 'staging' ], { cwd: computeJsDir });
    assert.equal(result.status, 0);
  });
});
