/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Ejects managed projects, and compares the result with an ejected scaffold
// of the same flags. The tests never run a published version of this package,
// so they give eject a `file:` spec through CJSP_TEST_EJECT_PACKAGE_SPEC.
// Needs network access for `npm install`, and the Fastly CLI for the serve
// test. No credentials are necessary.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import {
  REPO_DIR,
  makeTempDir,
  rawRequest,
  removeDir,
  runCli,
  skipUnlessFastlyCli,
  startServe,
  writeFixtureContent,
} from './helpers.js';

const EJECT_ENV = { CJSP_TEST_EJECT_PACKAGE_SPEC: `file:${REPO_DIR}`, FASTLY_SERVICE_ID: '' };

// The files of an app, without node_modules and package-lock.json, with the
// version and the date of generatedFrom replaced.
function readAppFiles(dir) {
  const files = {};
  const walk = (sub) => {
    for (const entry of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'package-lock.json') {
        continue;
      }
      const rel = path.posix.join(sub, entry.name);
      if (entry.isDirectory()) {
        walk(rel);
        continue;
      }
      files[rel] = fs.readFileSync(path.join(dir, rel), 'utf-8')
        .replace(/staticPublishVersion: "[^"]*"/, 'staticPublishVersion: "<v>"')
        .replace(/generatedAt: "\d{4}-\d{2}-\d{2}"/, 'generatedAt: "<d>"');
    }
  };
  walk('');
  return files;
}

function writeFixture(dir) {
  writeFixtureContent(path.resolve(dir, 'public'));
  fs.writeFileSync(path.resolve(dir, 'package.json'), JSON.stringify({
    name: 'eject-e2e',
    private: true,
    devDependencies: { '@fastly/compute-js-static-publish': `file:${REPO_DIR}` },
  }));
}

describe('eject', () => {
  const dirs = [];
  after(() => {
    for (const dir of dirs) {
      removeDir(dir);
    }
  });
  const newDir = (name) => {
    const dir = makeTempDir(name);
    dirs.push(dir);
    writeFixture(dir);
    return dir;
  };

  test('one config, three paths: scaffold flags, a managed project, and eject give the same app', () => {
    const flags = [
      '--root-dir', './public', '--kv-store-name', 'site-content', '--name', 'my-site', '--author', 'me@example.com',
      '--description', 'My site', '--service-id', 'SVC123', '--publish-id', 'pub1', '--default-collection-name', 'main',
      '--collection-selection', 'query:collection,sticky', '--collection-selection', 'cookie',
    ];
    const scaffoldDir = newDir('eject-scaffold');
    runCli(flags, { cwd: scaffoldDir });

    const managedDir = newDir('eject-managed');
    runCli([ ...flags, '--managed', '--static-publisher-working-dir', './compute-js/static-publisher' ], { cwd: managedDir });
    runCli([ 'eject' ], { cwd: managedDir, env: EJECT_ENV });

    const scaffolded = readAppFiles(path.resolve(scaffoldDir, 'compute-js'));
    const ejected = readAppFiles(path.resolve(managedDir, 'compute-js'));
    assert.deepEqual(Object.keys(ejected).sort(), Object.keys(scaffolded).sort());
    for (const file of Object.keys(scaffolded)) {
      assert.equal(ejected[file], scaffolded[file], file);
    }
    assert.equal(fs.existsSync(path.resolve(managedDir, 'static-publish.project.js')), false, 'the project file is deleted');
  });

  test('refuses a directory that exists, without --force', () => {
    const dir = newDir('eject-exists');
    runCli([ '--managed', '--root-dir', './public', '--kv-store-name', 'c' ], { cwd: dir });
    fs.mkdirSync(path.resolve(dir, 'compute-js'));
    const result = runCli([ 'eject' ], { cwd: dir, env: EJECT_ENV, allowFailure: true });
    assert.equal(result.status, 2);
    assert.match(result.output, /exists\. Use --force/);
    assert.ok(fs.existsSync(path.resolve(dir, 'static-publish.project.js')));
  });

  test('stops for a function in publishContent, before it writes anything', () => {
    const dir = newDir('eject-function');
    runCli([ '--managed', '--root-dir', './public', '--kv-store-name', 'c' ], { cwd: dir });
    const projectFile = path.resolve(dir, 'static-publish.project.js');
    fs.writeFileSync(projectFile, fs.readFileSync(projectFile, 'utf-8').replace('    // assetInclusionTest: (assetKey) => true,', '    assetInclusionTest: (assetKey) => true,'));
    const result = runCli([ 'eject' ], { cwd: dir, env: EJECT_ENV, allowFailure: true });
    assert.equal(result.status, 2);
    assert.match(result.output, /cannot copy functions or regular expressions from publishContent: assetInclusionTest/);
    assert.equal(fs.existsSync(path.resolve(dir, 'compute-js')), false);
  });

  test('in an ejected app: an error', () => {
    const dir = newDir('eject-ejected');
    fs.writeFileSync(path.resolve(dir, 'static-publish.rc.js'), `export default { kvStoreName: 'x', publishId: 'default', defaultCollectionName: 'live', staticPublisherWorkingDir: './static-publisher' };`);
    const result = runCli([ 'eject' ], { cwd: dir, allowFailure: true });
    assert.equal(result.status, 2);
    assert.match(result.output, /already ejected/);
  });
});

describe('an ejected project keeps working', { skip: skipUnlessFastlyCli() }, () => {
  let dir;
  let server;

  before(async () => {
    dir = makeTempDir('eject-serve');
    writeFixture(dir);
    runCli([ '--managed', '--root-dir', './public', '--kv-store-name', 'e2e-content' ], { cwd: dir });
    const projectFile = path.resolve(dir, 'static-publish.project.js');
    fs.writeFileSync(projectFile, fs.readFileSync(projectFile, 'utf-8').replace('    // hiddenItems: [],', `    hiddenItems: [ '/cached.html' ],`));
    runCli([ 'publish-content', '--local' ], { cwd: dir });
    runCli([ 'eject' ], { cwd: dir, env: EJECT_ENV });
  });

  after(async () => {
    await server?.stop();
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('the paths point at the same directories', () => {
    const appDir = path.resolve(dir, 'compute-js');
    assert.match(fs.readFileSync(path.resolve(appDir, 'static-publish.rc.js'), 'utf-8'), /staticPublisherWorkingDir: "\.\.\/static-publisher"/);
    assert.match(fs.readFileSync(path.resolve(appDir, 'fastly.toml'), 'utf-8'), /file = "\.\.\/static-publisher\/kvstore\.json"/);
    const config = fs.readFileSync(path.resolve(appDir, 'publish-content.config.js'), 'utf-8');
    assert.match(config, /rootDir: "\.\.\/public"/);
    assert.match(config, /hiddenItems: \[ "\/cached\.html" \]/);
    assert.doesNotMatch(fs.readFileSync(path.resolve(appDir, '.gitignore'), 'utf-8'), /static-publisher/);
  });

  test('publish-content and the app work in the ejected app', async () => {
    const appDir = path.resolve(dir, 'compute-js');
    runCli([ 'publish-content', '--local' ], { cwd: appDir });
    assert.match(runCli([ 'collections', 'list', '--local' ], { cwd: appDir }).output, /\(1 hidden\)/);
    server = await startServe(appDir);
    const res = await rawRequest(server.baseUrl + '/', { headers: { accept: 'text/html' } });
    assert.match(res.body.toString(), /<h1>Home<\/h1>/);
    const hidden = await rawRequest(server.baseUrl + '/cached.html', { headers: { accept: 'text/html' } });
    assert.equal(hidden.status, 404);
  });
});
