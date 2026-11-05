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

function runText(args, cwd, env = NO_TOKEN) {
  return runCli(args, { cwd, env, allowFailure: true });
}

// The value of a line '<label>   : <value>' in the output of status.
function statusValue(output, label) {
  const line = output.split('\n').find(x => x.startsWith(`${label} `) && x.includes(' : '));
  return line?.slice(line.indexOf(' : ') + 3).trim();
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
      const { status, output } = runText([ 'status' ], dir);
      assert.equal(status, 0);
      assert.equal(statusValue(output, 'Mode'), 'managed');
      assert.equal(statusValue(output, 'Service ID'), '(none)');
      assert.equal(statusValue(output, 'Version of the project'), VERSION);
      assert.equal(statusValue(output, 'Version that runs'), VERSION);
      assert.match(statusValue(output, 'Fingerprint'), /^[0-9a-f]{64}$/);
      assert.equal(statusValue(output, 'Deployed fingerprint'), '(unknown)');
      assert.equal(statusValue(output, 'Deploy necessary'), 'yes');
      assert.equal(statusValue(output, 'Preview URL (query)'), 'https://<service domain>/?collection={collection}');
    });

    test('with a service but no API token: unknown', () => {
      const { output } = runText([ 'status', '--fastly-service-id', 'SVC123' ], dir);
      assert.match(statusValue(output, 'Service ID'), /^SVC123 /);
      assert.equal(statusValue(output, 'Deploy necessary'), 'unknown');
      assert.match(output, /\* Unknown: no API token/);
    });

    test('--json', () => {
      const result = runText([ 'status', '--json' ], dir);
      assert.equal(result.status, 0, result.output);
      const json = JSON.parse(result.stdout);
      assert.equal(json.schemaVersion, 1);
      assert.equal(json.mode, 'managed');
      assert.equal(json.serviceId, null);
      assert.deepEqual(json.staticPublishVersion, { recorded: VERSION, running: VERSION, check: 'same' });
      assert.match(json.fingerprint.current, /^[0-9a-f]{64}$/);
      assert.equal(json.fingerprint.deployed, null);
      assert.equal(json.needsDeploy, true);
      assert.deepEqual(json.previewUrls, [ { type: 'query', url: 'https://<service domain>/?collection={collection}' } ]);

      const withService = JSON.parse(runText([ 'status', '--json', '--fastly-service-id', 'SVC123' ], dir).stdout);
      assert.equal(withService.serviceId, 'SVC123');
      assert.equal(withService.needsDeploy, null);
      assert.match(withService.reasons[0], /no API token/);
    });

    test('the fingerprint does not change for publishContent or the service ID, and changes for the app', () => {
      const fingerprint = () => statusValue(runText([ 'status' ], dir).output, 'Fingerprint');
      const before = fingerprint();
      const original = readProject();
      try {
        editProject(text => text.replace('notFoundPageFile: "/404.html"', 'notFoundPageFile: false'));
        editProject(text => text.replace('    serviceId: undefined,', '    serviceId: "SVC123",'));
        assert.equal(fingerprint(), before);
        editProject(text => text.replace('defaultCollectionName: "live"', 'defaultCollectionName: "main"'));
        assert.notEqual(fingerprint(), before);
      } finally {
        fs.writeFileSync(projectFile, original);
      }
    });

    test('in an ejected app: the mode', () => {
      const ejectedDir = makeTempDir('status-ejected');
      try {
        fs.writeFileSync(path.resolve(ejectedDir, 'static-publish.rc.js'), `export default { kvStoreName: 'x', publishId: 'default', defaultCollectionName: 'live', staticPublisherWorkingDir: './static-publisher' };`);
        fs.writeFileSync(path.resolve(ejectedDir, 'fastly.toml'), 'service_id = "SVC9"\n');
        const { output } = runText([ 'status' ], ejectedDir);
        assert.equal(statusValue(output, 'Mode'), 'ejected');
        assert.equal(statusValue(output, 'Service ID'), 'SVC9');
      } finally {
        removeDir(ejectedDir);
      }
    });

    test('deploy in an ejected app: --force and --auto-upgrade are errors', () => {
      const ejectedDir = makeTempDir('deploy-ejected');
      try {
        fs.writeFileSync(path.resolve(ejectedDir, 'static-publish.rc.js'), `export default { kvStoreName: 'x', publishId: 'default', defaultCollectionName: 'live', staticPublisherWorkingDir: './static-publisher' };`);
        for (const option of [ '--force', '--auto-upgrade' ]) {
          const result = runText([ 'deploy', option ], ejectedDir);
          assert.notEqual(result.status, 0, option);
          assert.match(result.output, new RegExp(`${option} is only for a managed project`));
          assert.doesNotMatch(result.output, /▶️ fastly/, 'the Fastly CLI did not run');
        }
      } finally {
        removeDir(ejectedDir);
      }
    });
  });

  describe('version check and upgrade', () => {
    test('a project made by an older version: deploy and dev stop, upgrade moves it', () => {
      setVersion('7.0.0');
      try {
        const deploy = runText([ 'deploy' ], dir);
        assert.notEqual(deploy.status, 0);
        assert.match(deploy.output, /This project uses 7\.0\.0.*Run 'upgrade'/);

        const dev = runCli([ 'dev' ], { cwd: dir, allowFailure: true });
        assert.notEqual(dev.status, 0);
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
        const deploy = runText([ 'deploy', '--auto-upgrade' ], dir);
        // It continues to the next check: no API token.
        assert.match(deploy.output, /Fastly API Token not provided/);
        assert.match(readProject(), new RegExp(`staticPublishVersion: "${VERSION.replace(/\./g, '\\.')}",`));
      } finally {
        setVersion(VERSION);
      }
    });

    test('a project made by a newer version: always stop', () => {
      setVersion('99.0.0');
      try {
        for (const args of [ [ 'deploy' ], [ 'deploy', '--auto-upgrade' ] ]) {
          const result = runText(args, dir);
          assert.notEqual(result.status, 0);
          assert.match(result.output, /99\.0\.0 or later/);
        }
        const upgrade = runCli([ 'upgrade' ], { cwd: dir, allowFailure: true });
        assert.notEqual(upgrade.status, 0);
        assert.match(readProject(), /staticPublishVersion: "99\.0\.0",/);
      } finally {
        setVersion(VERSION);
      }
    });

    test('a missing version: stop, and upgrade adds it', () => {
      editProject(text => text.replace(/^ {4}staticPublishVersion: .*\n/m, ''));
      const deploy = runText([ 'deploy' ], dir);
      assert.notEqual(deploy.status, 0);
      assert.match(deploy.output, /missing/);
      runCli([ 'upgrade' ], { cwd: dir });
      assert.match(readProject(), new RegExp(`staticPublishVersion: "${VERSION.replace(/\./g, '\\.')}",`));
    });
  });

  describe('a command in another directory', () => {
    test('a subdirectory of the project: the CLI names the project directory', () => {
      const sub = path.resolve(dir, 'sub-e2e');
      fs.mkdirSync(sub, { recursive: true });
      try {
        const { status, output } = runText([ 'status' ], sub);
        assert.equal(status, 2);
        assert.match(output, /'status' is a command for a managed project or an app/);
        assert.match(output, /\.\. has static-publish\.project\.js\. Run the command there, or add --project-dir=\.\./);
        assert.doesNotMatch(output, /Scaffolding mode/);
      } finally {
        fs.rmSync(sub, { recursive: true, force: true });
      }
    });
  });

  describe('deploy checks', () => {
    test('options after -- that deploy sets itself are errors', () => {
      for (const [ args, message ] of [
        [ [ '--', '--comment=x' ], /--comment cannot be given to the Fastly CLI/ ],
        [ [ '--', '-is', 'abc' ], /-s \(--service-id\) cannot be given to the Fastly CLI/ ],
      ]) {
        const { status, output } = runText([ 'deploy', ...args ], dir, { ...NO_TOKEN, FASTLY_API_TOKEN: 'not-a-real-token-123456' });
        assert.notEqual(status, 0, args.join(' '));
        assert.match(output, message);
        assert.doesNotMatch(output, /▶️ fastly/, 'the Fastly CLI did not run');
      }
    });

    test('without an API token', () => {
      const { status, output } = runText([ 'deploy' ], dir);
      assert.notEqual(status, 0);
      assert.match(output, /Fastly API Token not provided/);
    });

    test('the first deploy of an S3 app in non-interactive mode', () => {
      const s3Dir = makeTempDir('managed-s3');
      try {
        writeFixtureContent(path.resolve(s3Dir, 'public'));
        runCli([ '--managed', '--root-dir', './public', '--storage-mode', 's3', '--s3-region', 'us-east-1', '--s3-bucket', 'b', '--s3-endpoint', 'https://s3.example.com' ], { cwd: s3Dir });
        const { status, output } = runText([ 'deploy', '--non-interactive' ], s3Dir, { ...NO_TOKEN, FASTLY_API_TOKEN: 'not-a-real-token-123456' });
        assert.notEqual(status, 0);
        assert.match(output, /first deploy of an app with S3 storage must be done by hand/);
      } finally {
        removeDir(s3Dir);
      }
    });
  });
});
