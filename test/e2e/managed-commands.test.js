/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// status, upgrade, the version check of deploy and dev, and the checks that
// deploy does before it calls the Fastly API. No network and no credentials
// are necessary.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { REPO_DIR, makeTempDir, removeDir, runCli, writeFixtureContent } from './helpers.js';

const VERSION = JSON.parse(fs.readFileSync(path.resolve(REPO_DIR, 'package.json'), 'utf-8')).version;
const NO_TOKEN = { FASTLY_API_TOKEN: '', FASTLY_SERVICE_ID: '' };

function runJson(args, cwd, env = NO_TOKEN) {
  const result = runCli([ ...args, '--json' ], { cwd, env, allowFailure: true });
  return { ...result, json: JSON.parse(result.stdout) };
}

describe('managed commands', () => {
  let dir;
  let projectFile;
  const readProject = () => fs.readFileSync(projectFile, 'utf-8');
  const editProject = (fn) => fs.writeFileSync(projectFile, fn(readProject()));
  const setVersion = (version) => editProject(text => text.replace(/staticPublishVersion: "[^"]*",/, `staticPublishVersion: "${version}",`));

  before(() => {
    dir = makeTempDir('managed-commands');
    writeFixtureContent(path.resolve(dir, 'public'));
    runCli([ '--managed', '--root-dir', './public', '--kv-store-name', 'e2e-content', '--collection-selection', 'query:collection' ], { cwd: dir });
    projectFile = path.resolve(dir, 'static-publish.project.js');
  });

  after(() => {
    if (dir != null) {
      removeDir(dir);
    }
  });

  describe('status', () => {
    test('without a service: a deploy is necessary', () => {
      const { status, json } = runJson([ 'status' ], dir);
      assert.equal(status, 0);
      assert.equal(json.schemaVersion, 1);
      assert.equal(json.mode, 'managed');
      assert.equal(json.serviceId, null);
      assert.deepEqual(json.staticPublishVersion, { recorded: VERSION, running: VERSION, check: 'same' });
      assert.match(json.fingerprint.current, /^[0-9a-f]{64}$/);
      assert.equal(json.fingerprint.deployed, null);
      assert.equal(json.needsDeploy, true);
      assert.deepEqual(json.previewUrls, [ { type: 'query', url: 'https://<service domain>/?collection={collection}' } ]);
    });

    test('with a service but no API token: unknown', () => {
      const { json } = runJson([ 'status', '--fastly-service-id', 'SVC123' ], dir);
      assert.equal(json.serviceId, 'SVC123');
      assert.equal(json.needsDeploy, null);
      assert.match(json.reasons[0], /no API token/);
    });

    test('the fingerprint does not change for publishContent or the service ID, and changes for the app', () => {
      const before = runJson([ 'status' ], dir).json.fingerprint.current;
      const original = readProject();
      try {
        editProject(text => text.replace('notFoundPageFile: "/404.html"', 'notFoundPageFile: false'));
        editProject(text => text.replace('    serviceId: undefined,', '    serviceId: "SVC123",'));
        assert.equal(runJson([ 'status' ], dir).json.fingerprint.current, before);
        editProject(text => text.replace('defaultCollectionName: "live"', 'defaultCollectionName: "main"'));
        assert.notEqual(runJson([ 'status' ], dir).json.fingerprint.current, before);
      } finally {
        fs.writeFileSync(projectFile, original);
      }
    });

    test('in an ejected app: the mode', () => {
      const ejectedDir = makeTempDir('status-ejected');
      try {
        fs.writeFileSync(path.resolve(ejectedDir, 'static-publish.rc.js'), `export default { kvStoreName: 'x', publishId: 'default', defaultCollectionName: 'live', staticPublisherWorkingDir: './static-publisher' };`);
        fs.writeFileSync(path.resolve(ejectedDir, 'fastly.toml'), 'service_id = "SVC9"\n');
        const { json } = runJson([ 'status' ], ejectedDir);
        assert.deepEqual(json, { schemaVersion: 1, mode: 'ejected', serviceId: 'SVC9' });
      } finally {
        removeDir(ejectedDir);
      }
    });
  });

  describe('version check and upgrade', () => {
    test('a project made by an older version: deploy and dev stop, upgrade moves it', () => {
      setVersion('7.0.0');
      try {
        const deploy = runJson([ 'deploy' ], dir);
        assert.equal(deploy.status, 2);
        assert.equal(deploy.json.error.code, 'version-mismatch');
        assert.match(deploy.json.error.message, /This project uses 7\.0\.0.*Run 'upgrade'/);

        const dev = runCli([ 'dev' ], { cwd: dir, allowFailure: true });
        assert.equal(dev.status, 2);
        assert.match(dev.output, /Run 'upgrade'/);

        const upgrade = runCli([ 'upgrade' ], { cwd: dir });
        assert.ok(upgrade.output.includes(`now uses ${VERSION} (was 7.0.0)`), upgrade.output);
        assert.match(readProject(), new RegExp(`staticPublishVersion: "${VERSION.replace(/\./g, '\\.')}",`));
        assert.match(runCli([ 'upgrade' ], { cwd: dir }).output, /already uses/);
      } finally {
        setVersion(VERSION);
      }
    });

    test('--auto-upgrade writes the version and continues', () => {
      setVersion('7.0.0');
      try {
        const deploy = runJson([ 'deploy', '--auto-upgrade' ], dir);
        // It continues to the next check: no API token.
        assert.equal(deploy.json.error.code, 'credentials-missing');
        assert.match(readProject(), new RegExp(`staticPublishVersion: "${VERSION.replace(/\./g, '\\.')}",`));
      } finally {
        setVersion(VERSION);
      }
    });

    test('a project made by a newer version: always stop', () => {
      setVersion('99.0.0');
      try {
        for (const args of [ [ 'deploy' ], [ 'deploy', '--auto-upgrade' ] ]) {
          const result = runJson(args, dir);
          assert.equal(result.status, 2);
          assert.equal(result.json.error.code, 'version-mismatch');
          assert.match(result.json.error.message, /99\.0\.0 or later/);
        }
        const upgrade = runCli([ 'upgrade' ], { cwd: dir, allowFailure: true });
        assert.equal(upgrade.status, 2);
        assert.match(readProject(), /staticPublishVersion: "99\.0\.0",/);
      } finally {
        setVersion(VERSION);
      }
    });

    test('a missing version: stop, and upgrade adds it', () => {
      editProject(text => text.replace(/^ {4}staticPublishVersion: .*\n/m, ''));
      const deploy = runJson([ 'deploy' ], dir);
      assert.equal(deploy.json.error.code, 'version-mismatch');
      assert.match(deploy.json.error.message, /missing/);
      runCli([ 'upgrade' ], { cwd: dir });
      assert.match(readProject(), new RegExp(`staticPublishVersion: "${VERSION.replace(/\./g, '\\.')}",`));
    });
  });

  describe('deploy checks', () => {
    test('without an API token', () => {
      const { status, json } = runJson([ 'deploy' ], dir);
      assert.equal(status, 2);
      assert.equal(json.error.code, 'credentials-missing');
    });

    test('the first deploy of an S3 app in non-interactive mode', () => {
      const s3Dir = makeTempDir('managed-s3');
      try {
        writeFixtureContent(path.resolve(s3Dir, 'public'));
        runCli([ '--managed', '--root-dir', './public', '--storage-mode', 's3', '--s3-region', 'us-east-1', '--s3-bucket', 'b', '--s3-endpoint', 'https://s3.example.com' ], { cwd: s3Dir });
        const { status, json } = runJson([ 'deploy', '--non-interactive' ], s3Dir, { ...NO_TOKEN, FASTLY_API_TOKEN: 'not-a-real-token-123456' });
        assert.equal(status, 2);
        assert.equal(json.error.code, 'first-deploy-manual');
      } finally {
        removeDir(s3Dir);
      }
    });
  });
});
