/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Checks the contract with tools that run the CLI, for example in CI: --json,
// the exit codes, the error codes, and the operations that succeed when they
// run again. Needs network access for the `npm install` of the scaffolder.
// No credentials are necessary.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import {
  REPO_DIR,
  makeTempDir,
  removeDir,
  runCli,
  scaffoldApp,
  writeFixtureContent,
} from './helpers.js';

const VERSION = JSON.parse(fs.readFileSync(path.resolve(REPO_DIR, 'package.json'), 'utf-8')).version;

// Runs the CLI with --json, and parses stdout as one JSON object.
function runJson(args, options) {
  const result = runCli([ ...args, '--json' ], { ...options, allowFailure: true });
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    throw new Error(`stdout is not one JSON object:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return { ...result, json };
}

describe('CLI contract', () => {
  let dir;
  let computeJsDir;

  before(() => {
    dir = makeTempDir('cli-contract');
    writeFixtureContent(path.resolve(dir, 'public'));
    computeJsDir = scaffoldApp(dir, [ '--kv-store-name', 'e2e-content' ]);
  });

  after(() => {
    if (dir != null) {
      removeDir(dir);
    }
  });

  describe('--json', () => {
    test('--version', () => {
      const { status, json } = runJson([ '--version' ], { cwd: dir });
      assert.equal(status, 0);
      assert.deepEqual(json, { schemaVersion: 1, version: VERSION });
    });

    test('publish-content: one JSON object on stdout, and the log on stderr', () => {
      const { status, json, stderr } = runJson([ 'publish-content', '--local', '--project-dir', 'compute-js' ], { cwd: dir });
      assert.equal(status, 0, stderr);
      assert.match(stderr, /Fastly Compute JavaScript Static Publisher \(Management mode\)/);
      assert.equal(json.schemaVersion, 1);
      assert.equal(json.collection, 'live');
      assert.equal(json.publishId, 'default');
      assert.deepEqual(json.files, { total: 12, hidden: 0 });
      assert.equal(typeof json.storageItems.uploaded, 'number');
      assert.equal(typeof json.storageItems.reused, 'number');
      assert.equal(json.expiresAt, null);
      assert.equal(json.purge, null, 'no purge with --local');
    });

    test('publish-content: the same content again succeeds', () => {
      const first = runJson([ 'publish-content', '--local', '--expires-at', '2099-01-01T00:00:00Z', '--collection-name', 'pr-1' ], { cwd: computeJsDir });
      assert.equal(first.status, 0, first.stderr);
      assert.equal(first.json.collection, 'pr-1');
      assert.equal(first.json.expiresAt, '2099-01-01T00:00:00.000Z');
      const second = runJson([ 'publish-content', '--local', '--collection-name', 'pr-1' ], { cwd: computeJsDir });
      assert.equal(second.status, 0, second.stderr);
    });

    test('collections list', () => {
      const { status, json, stderr } = runJson([ 'collections', 'list', '--local' ], { cwd: computeJsDir });
      assert.equal(status, 0, stderr);
      assert.equal(json.schemaVersion, 1);
      assert.equal(json.defaultCollection, 'live');
      const live = json.collections.find(x => x.name === 'live');
      assert.equal(live.isDefault, true);
      assert.equal(live.files, 12);
      assert.equal(live.hidden, 0);
      assert.equal(live.expired, false);
      assert.deepEqual(live.requires, []);
      assert.match(live.publishedAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.ok(json.collections.some(x => x.name === 'pr-1' && !x.isDefault));
    });

    test('status of an ejected app', () => {
      const { status, json } = runJson([ 'status' ], { cwd: computeJsDir });
      assert.equal(status, 0);
      assert.deepEqual(json, { schemaVersion: 1, mode: 'ejected', serviceId: null });
    });

    test('a command that does not support --json', () => {
      for (const args of [ [ 'clean', '--local' ], [ 'collections', 'update-expiration', '--local', '--collection-name', 'pr-1', '--expires-never' ] ]) {
        const { status, json } = runJson(args, { cwd: computeJsDir });
        assert.equal(status, 2, args.join(' '));
        assert.equal(json.error.code, 'json-not-supported', args.join(' '));
      }
      const { status, json } = runJson([ '--root-dir', './public' ], { cwd: dir });
      assert.equal(status, 2);
      assert.equal(json.error.code, 'json-not-supported', 'scaffold');
    });

    test('publish-content: storageItems.uploaded counts variants, not the chunks of a large file', () => {
      // Larger than one KV Store chunk (20 MiB), so the file is split into two chunks.
      const bigFile = path.resolve(dir, 'public', 'big.bin');
      fs.writeFileSync(bigFile, Buffer.alloc(21 * 1024 * 1024, 1));
      try {
        const { status, json, stderr } = runJson([ 'publish-content', '--local', '--collection-name', 'big-1' ], { cwd: computeJsDir });
        assert.equal(status, 0, stderr);
        const planned = Number(/(\d+) variant\(s\) to upload/.exec(stderr)?.[1]);
        assert.ok(planned > 0, stderr);
        assert.equal(json.storageItems.uploaded, planned);
      } finally {
        fs.rmSync(bigFile);
      }
    });
  });

  describe('exit codes and error codes', () => {
    const cases = [
      [ 'an unknown option', [ 'publish-content', '--local', '--nope' ], 'usage' ],
      [ 'an unknown command', [ 'nope' ], 'usage' ],
      [ 'a global option without a value', [ 'collections', 'list', '--project-dir' ], 'usage' ],
      [ 'a new collection name that breaks the rule', [ 'publish-content', '--local', '--collection-name', 'Bad_Name' ], 'collection-name-invalid' ],
      [ 'a --project-dir that does not exist', [ 'collections', 'list', '--project-dir', 'nope' ], 'project-dir-not-found' ],
    ];
    for (const [ name, args, code ] of cases) {
      test(name, () => {
        const { status, json, output } = runJson(args, { cwd: computeJsDir });
        assert.equal(status, 2, output);
        assert.deepEqual(Object.keys(json), [ 'schemaVersion', 'error' ]);
        assert.equal(json.schemaVersion, 1);
        assert.equal(json.error.code, code);
        assert.equal(typeof json.error.message, 'string');
      });
    }

    test('without --json, the same exit code', () => {
      const result = runCli([ 'publish-content', '--local', '--collection-name', 'Bad_Name' ], { cwd: computeJsDir, allowFailure: true });
      assert.equal(result.status, 2);
      assert.match(result.output, /❌ Collection name 'Bad_Name' is not valid\./);
    });

    test('promote from a collection that does not exist', () => {
      const result = runCli([ 'collections', 'promote', '--local', '--collection-name', 'nope', '--to', 'x' ], { cwd: computeJsDir, allowFailure: true });
      assert.equal(result.status, 2);
      assert.match(result.output, /❌ Collection 'nope' does not exist\./);
    });

    test('a config file that cannot be loaded', () => {
      const brokenDir = makeTempDir('cli-broken-rc');
      try {
        fs.writeFileSync(path.resolve(brokenDir, 'static-publish.rc.js'), 'export default {');
        const { status, json } = runJson([ 'collections', 'list', '--local' ], { cwd: brokenDir });
        assert.equal(status, 2);
        assert.equal(json.error.code, 'config-invalid');
      } finally {
        removeDir(brokenDir);
      }
    });

    test('a missing API token', () => {
      const { status, json } = runJson([ 'collections', 'list' ], { cwd: computeJsDir, env: { FASTLY_API_TOKEN: '' } });
      assert.equal(status, 2);
      assert.equal(json.error.code, 'credentials-missing');
    });

    test('a failed operation: exit 1, and no secret in the message', () => {
      const token = 'not-a-real-token-0123456789abcdef';
      const { status, json, output } = runJson([ 'collections', 'list' ], { cwd: computeJsDir, env: { FASTLY_API_TOKEN: token } });
      assert.equal(status, 1, output);
      assert.equal(json.error.code, 'failed');
      assert.equal(output.includes(token), false);
    });
  });

  describe('operations that succeed when they run again', () => {
    test('promote to the same target', () => {
      for (let i = 0; i < 2; i++) {
        const { status, json, stderr } = runJson([ 'collections', 'promote', '--local', '--collection-name', 'live', '--to', 'copy' ], { cwd: computeJsDir });
        assert.equal(status, 0, stderr);
        assert.deepEqual(json, { schemaVersion: 1, from: 'live', to: 'copy', publishId: 'default', expiresAt: null });
      }
    });

    test('delete a collection, and delete it again', () => {
      const first = runJson([ 'collections', 'delete', '--local', '--collection-name', 'copy' ], { cwd: computeJsDir });
      assert.equal(first.status, 0, first.stderr);
      assert.deepEqual(first.json, { schemaVersion: 1, collection: 'copy', publishId: 'default', deleted: true, purge: null });

      const second = runJson([ 'collections', 'delete', '--local', '--collection-name', 'copy' ], { cwd: computeJsDir });
      assert.equal(second.status, 0, second.stderr);
      assert.deepEqual(second.json, { schemaVersion: 1, collection: 'copy', publishId: 'default', deleted: false, reason: 'not-found', purge: null });
      assert.match(second.stderr, /Collection 'copy' does not exist\. Nothing to delete\./);
    });
  });
});
