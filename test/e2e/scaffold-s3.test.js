/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Scaffolds an S3 app and checks the generated fastly.toml. Needs network
// access for `npm install`. No credentials are necessary.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { makeTempDir, removeDir, scaffoldApp, writeFixtureContent } from './helpers.js';

describe('scaffold with S3-compatible storage', () => {
  let dir;
  let fastlyToml;

  before(() => {
    dir = makeTempDir('scaffold-s3');
    writeFixtureContent(path.resolve(dir, 'public'));
    const computeJsDir = scaffoldApp(dir, [
      '--storage-mode', 's3',
      '--s3-region', 'us-east-1',
      '--s3-bucket', 'e2e-bucket',
      '--s3-endpoint', 'https://s3.example.com',
    ]);
    fastlyToml = fs.readFileSync(path.resolve(computeJsDir, 'fastly.toml'), 'utf-8');
  });

  after(() => {
    if (dir != null) {
      removeDir(dir);
    }
  });

  // The Fastly CLI reads the keys of a Secret Store from "entries".
  test('declares the Secret Store keys in [setup] as entries', () => {
    assert.match(fastlyToml, /^\[setup\.secret_stores\.S3_CREDENTIALS\.entries\.S3_ACCESS_KEY_ID\]$/m);
    assert.match(fastlyToml, /^\[setup\.secret_stores\.S3_CREDENTIALS\.entries\.S3_SECRET_ACCESS_KEY\]$/m);
    assert.doesNotMatch(fastlyToml, /\.items\b/);
  });

  test('declares the backend in [setup]', () => {
    assert.match(fastlyToml, /^\[setup\.backends\.s3_storage\]\naddress = "s3\.example\.com"$/m);
  });
});
