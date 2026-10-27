/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Checks the contract with tools that run the CLI, for example in CI:
// --version, --project-dir, --json, exit codes, and no secrets in the output.
// Needs network access for `npm install` (and api.fastly.com for the secrets
// test). No credentials are necessary.

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

// Runs the CLI and parses stdout as one JSON object.
function runJson(args, options) {
  const result = runCli([ ...args, '--json' ], { ...options, allowFailure: true });
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch (err) {
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

  describe('--version', () => {
    test('prints only the version, in any directory', () => {
      for (const cwd of [ dir, computeJsDir, makeTempDir('cli-version') ]) {
        const result = runCli([ '--version' ], { cwd });
        assert.equal(result.status, 0);
        assert.equal(result.stdout, `${VERSION}\n`, cwd);
      }
    });

    test('with --json', () => {
      const { status, json } = runJson([ '--version' ], { cwd: dir });
      assert.equal(status, 0);
      assert.deepEqual(json, { schemaVersion: 1, version: VERSION });
    });
  });

  describe('--json', () => {
    test('publish-content: one JSON object on stdout, the log on stderr, with --project-dir', () => {
      const { status, json, stderr } = runJson([ 'publish-content', '--local', '--project-dir', 'compute-js' ], { cwd: dir });
      assert.equal(status, 0, stderr);
      assert.match(stderr, /Fastly Compute JavaScript Static Publisher \(Management mode\)/);
      assert.equal(json.schemaVersion, 1);
      assert.equal(json.collection, 'live');
      assert.equal(json.publishId, 'default');
      assert.equal(json.files.total, 12);
      assert.equal(json.files.hidden, 0);
      assert.equal(typeof json.files.uploaded, 'number');
      assert.equal(typeof json.files.reused, 'number');
      assert.equal(json.expiresAt, null);
      assert.equal(json.purge, null);
    });

    test('publish-content: the same content again succeeds', () => {
      const { status, json } = runJson([ 'publish-content', '--local', '--expires-at', '2099-01-01T00:00:00Z', '--collection-name', 'pr-1' ], { cwd: computeJsDir });
      assert.equal(status, 0);
      assert.equal(json.collection, 'pr-1');
      assert.equal(json.expiresAt, '2099-01-01T00:00:00.000Z');
      assert.equal(runJson([ 'publish-content', '--local', '--collection-name', 'pr-1' ], { cwd: computeJsDir }).status, 0);
    });

    test('collections list', () => {
      const { status, json } = runJson([ 'collections', 'list', '--local' ], { cwd: computeJsDir });
      assert.equal(status, 0);
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

    test('a command that does not support --json', () => {
      const { status, json } = runJson([ 'clean', '--local' ], { cwd: computeJsDir });
      assert.equal(status, 2);
      assert.equal(json.error.code, 'json-not-supported');
    });
  });

  describe('exit codes and error codes', () => {
    const cases = [
      [ 'an unknown flag', [ 'publish-content', '--local', '--nope' ], 2, 'usage' ],
      [ 'an unknown command', [ 'nope' ], 2, 'usage' ],
      [ 'a new collection name that breaks the rule', [ 'publish-content', '--local', '--collection-name', 'Bad_Name' ], 2, 'collection-name-invalid' ],
      [ 'a --project-dir that does not exist', [ 'collections', 'list', '--project-dir', 'nope' ], 2, 'project-dir-not-found' ],
    ];
    for (const [ name, args, exitCode, code ] of cases) {
      test(name, () => {
        const result = runCli([ ...args, '--json' ], { cwd: computeJsDir, allowFailure: true });
        assert.equal(result.status, exitCode, result.output);
        const json = JSON.parse(result.stdout);
        assert.equal(json.schemaVersion, 1);
        assert.equal(json.error.code, code);
        assert.equal(typeof json.error.message, 'string');
      });
    }

    test('without --json, the same exit code', () => {
      const result = runCli([ 'publish-content', '--local', '--collection-name', 'Bad_Name' ], { cwd: computeJsDir, allowFailure: true });
      assert.equal(result.status, 2);
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
      const env = { FASTLY_API_TOKEN: '' };
      const { status, json } = runJson([ 'collections', 'list' ], { cwd: computeJsDir, env });
      assert.equal(status, 2);
      assert.equal(json.error.code, 'credentials-missing');
    });

    test('promote from a collection that does not exist', () => {
      const result = runCli([ 'collections', 'promote', '--local', '--collection-name', 'nope', '--to', 'x' ], { cwd: computeJsDir, allowFailure: true });
      assert.equal(result.status, 2);
      assert.match(result.output, /Collection 'nope' does not exist\./);
    });

    test('promote to the same target again succeeds', () => {
      for (let i = 0; i < 2; i++) {
        const result = runCli([ 'collections', 'promote', '--local', '--collection-name', 'live', '--to', 'copy' ], { cwd: computeJsDir });
        assert.equal(result.status, 0);
      }
    });

    test('deleting a collection that does not exist succeeds', () => {
      const result = runCli([ 'collections', 'delete', '--local', '--collection-name', 'does-not-exist' ], { cwd: computeJsDir });
      assert.equal(result.status, 0);
      assert.match(result.output, /does not exist\. Nothing to delete\./);
    });
  });

  describe('secrets', () => {
    const TOKEN = 'cjsp-test-token-0123456789abcdef';

    test('a token in a flag is not in the output, also in errors', () => {
      const result = runCli([ 'collections', 'list', '--fastly-api-token', TOKEN ], { cwd: computeJsDir, allowFailure: true, env: { FASTLY_API_TOKEN: '' } });
      assert.notEqual(result.status, 0);
      assert.ok(!result.output.includes(TOKEN), result.output);
    });

    test('a token in the environment is not in the output', () => {
      const result = runCli([ 'collections', 'list', '--json' ], { cwd: computeJsDir, allowFailure: true, env: { FASTLY_API_TOKEN: TOKEN } });
      assert.notEqual(result.status, 0);
      assert.ok(!result.output.includes(TOKEN), result.output);
      assert.equal(JSON.parse(result.stdout).error.code, 'failed');
    });
  });
});
