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

import { makeTempDir, removeDir, runCli, scaffoldApp, writeFixtureContent } from './helpers.js';

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

// Without --s3-endpoint, the bucket is on AWS. The CLI computes the host name,
// so it needs no AWS credentials and no network.
describe('scaffold with an AWS S3 bucket and no --s3-endpoint', () => {
  let dir;

  before(() => {
    dir = makeTempDir('scaffold-s3-aws');
    writeFixtureContent(path.resolve(dir, 'public'));
  });

  after(() => {
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('the backend is the virtual-hosted host name of the bucket', () => {
    const computeJsDir = scaffoldApp(dir, [ '--storage-mode', 's3', '--s3-region', 'us-east-1', '--s3-bucket', 'e2e-bucket' ]);
    const fastlyToml = fs.readFileSync(path.resolve(computeJsDir, 'fastly.toml'), 'utf-8');
    assert.match(fastlyToml, /^\[setup\.backends\.s3_storage\]\naddress = "e2e-bucket\.s3\.us-east-1\.amazonaws\.com"$/m);
  });

  test('a bucket name with a dot needs --s3-endpoint', () => {
    const other = makeTempDir('scaffold-s3-dot');
    try {
      writeFixtureContent(path.resolve(other, 'public'));
      // No AWS credentials: the CLI must not need them.
      const env = { AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '', AWS_PROFILE: '', AWS_SHARED_CREDENTIALS_FILE: '/nonexistent', AWS_CONFIG_FILE: '/nonexistent' };
      const result = runCli([ '--root-dir', './public', '--storage-mode', 's3', '--s3-region', 'us-east-1', '--s3-bucket', 'my.bucket' ], { cwd: other, env, allowFailure: true });
      assert.notEqual(result.status, 0);
      assert.match(result.output, /The bucket name 'my\.bucket' has a dot/);
      assert.doesNotMatch(result.output, /CredentialsProviderError/);
      assert.equal(fs.existsSync(path.resolve(other, 'compute-js')), false);
    } finally {
      removeDir(other);
    }
  });
});
