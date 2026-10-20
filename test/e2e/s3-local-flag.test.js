/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// In S3 mode, each command that accepts --local stops with an error before it
// connects to the bucket. The endpoint is a port where nothing listens, so a
// command that connects fails with ECONNREFUSED. No network and no credentials
// are necessary.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { makeTempDir, removeDir, runCli, writeFixtureContent } from './helpers.js';

const COMMANDS = [
  [ 'publish-content', '--overwrite-existing' ],
  [ 'collections', 'list' ],
  [ 'collections', 'delete', '--collection-name=x' ],
  [ 'collections', 'promote', '--collection-name=x', '--to=y' ],
  [ 'collections', 'update-expiration', '--collection-name=x', '--expires-never' ],
  [ 'clean' ],
];

describe('--local in S3 mode', () => {
  let dir;

  before(() => {
    dir = makeTempDir('s3-local-flag');
    writeFixtureContent(path.resolve(dir, 'public'));
    fs.writeFileSync(path.resolve(dir, 'static-publish.rc.js'), `\
export default {
  storageMode: 's3',
  s3: { region: 'us-east-1', bucket: 'test', endpoint: 'http://127.0.0.1:9' },
  publishId: 'default',
  defaultCollectionName: 'live',
  staticPublisherWorkingDir: './static-publisher',
};
`);
    fs.writeFileSync(path.resolve(dir, 'publish-content.config.js'), `\
export default {
  rootDir: './public',
};
`);
  });

  after(() => {
    if (dir != null) {
      removeDir(dir);
    }
  });

  for (const args of COMMANDS) {
    test(`${args.slice(0, 2).join(' ')}: stops before it connects`, () => {
      const result = runCli([ ...args, '--local' ], {
        cwd: dir,
        env: { S3_ACCESS_KEY_ID: 'dummy', S3_SECRET_ACCESS_KEY: 'dummy' },
        allowFailure: true,
      });
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /--local is available only in KV Store mode/);
      assert.doesNotMatch(result.output, /ECONNREFUSED|Working on S3/);
    });
  }

  test('without --local: the command connects to the bucket', () => {
    const result = runCli([ 'collections', 'list' ], {
      cwd: dir,
      env: { S3_ACCESS_KEY_ID: 'dummy', S3_SECRET_ACCESS_KEY: 'dummy' },
      allowFailure: true,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /Working on S3/);
    assert.doesNotMatch(result.output, /--local is available only/);
  });
});
