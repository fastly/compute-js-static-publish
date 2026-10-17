/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Scaffolds a managed project, publishes with --local, and runs `dev`, which
// generates the app in .static-publish/app, installs it with `npm ci` from the
// template's lockfile and a `file:` link to this checkout, and runs
// `fastly compute serve`. Needs the Fastly CLI and network access for
// `npm ci`. No credentials are necessary.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import {
  CLI_PATH,
  REPO_DIR,
  makeTempDir,
  rawRequest,
  removeDir,
  runCli,
  skipUnlessFastlyCli,
  startServe,
  writeFixtureContent,
} from './helpers.js';
import { checkServedContent } from './served-content.js';

const startDev = (projectDir) => startServe(projectDir, {
  command: (addr) => [ process.execPath, [ CLI_PATH, 'dev', '--', '--addr', addr ] ],
});

describe('dev in a managed project', { skip: skipUnlessFastlyCli() }, () => {
  let dir;
  let projectDir;
  let appDir;
  let server;

  before(async () => {
    dir = makeTempDir('dev');
    projectDir = path.resolve(dir, 'site');
    writeFixtureContent(path.resolve(projectDir, 'public'));
    runCli([ '--managed', '--root-dir', './public', '--kv-store-name', 'e2e-content' ], { cwd: projectDir });
    runCli([ 'publish-content', '--local' ], { cwd: projectDir });
    appDir = path.resolve(projectDir, '.static-publish/app');
    server = await startDev(projectDir);
  });

  after(async () => {
    await server?.stop();
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('serves the content that publish-content --local wrote', async (t) => {
    // The plain app does not turn on Server-Timing.
    await checkServedContent(t, server.baseUrl, { serverTiming: false });
  });

  test('generates the app in .static-publish/app', () => {
    for (const file of [ 'package.json', 'package-lock.json', 'fastly.toml', 'static-publish.rc.js', 'src/index.js' ]) {
      assert.ok(fs.existsSync(path.resolve(appDir, file)), file);
    }
    const rc = fs.readFileSync(path.resolve(appDir, 'static-publish.rc.js'), 'utf-8');
    assert.doesNotMatch(rc, /generatedFrom|publishContent|managed/);
    const toml = fs.readFileSync(path.resolve(appDir, 'fastly.toml'), 'utf-8');
    assert.match(toml, /file = "\.\.\/\.\.\/static-publisher\/kvstore\.json"/);
  });

  test('the app uses this checkout through a file: link', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(appDir, 'package.json'), 'utf-8'));
    assert.equal(pkg.devDependencies['@fastly/compute-js-static-publish'], `file:${REPO_DIR}`);
    const link = path.resolve(appDir, 'node_modules/@fastly/compute-js-static-publish');
    assert.ok(fs.lstatSync(link).isSymbolicLink());
    assert.equal(fs.realpathSync(link), fs.realpathSync(REPO_DIR));
    assert.ok(fs.existsSync(path.resolve(appDir, 'node_modules/.bin/compute-js-static-publish')), 'the bin is linked');
  });

  test('npm ci does not change the lockfile', () => {
    const lock = JSON.parse(fs.readFileSync(path.resolve(appDir, 'package-lock.json'), 'utf-8'));
    const template = JSON.parse(fs.readFileSync(path.resolve(REPO_DIR, 'resources/templates/plain/package-lock.json'), 'utf-8'));
    assert.equal(lock.packages['node_modules/@fastly/js-compute'].version, template.packages['node_modules/@fastly/js-compute'].version);
    assert.equal(lock.packages['node_modules/@fastly/compute-js-static-publish'].link, true);
    assert.equal(fs.existsSync(path.resolve(appDir, 'node_modules/.compute-js-static-publish-install')), true);
  });

  test('a second dev does not install again, and keeps the local KV Store', async () => {
    await server.stop();
    const before = fs.readFileSync(path.resolve(projectDir, 'static-publisher/kvstore.json'), 'utf-8');
    server = await startDev(projectDir);
    assert.doesNotMatch(server.getOutput(), /npm ci/);
    assert.equal(fs.readFileSync(path.resolve(projectDir, 'static-publisher/kvstore.json'), 'utf-8'), before);
    const res = await rawRequest(server.baseUrl + '/', { headers: { accept: 'text/html' } });
    assert.match(res.body.toString(), /<h1>Home<\/h1>/);
  });
});

describe('dev outside a managed project', () => {
  test('is an error', () => {
    const emptyDir = makeTempDir('dev-ejected');
    try {
      fs.writeFileSync(path.resolve(emptyDir, 'static-publish.rc.js'), `export default { kvStoreName: 'x', publishId: 'default', defaultCollectionName: 'live', staticPublisherWorkingDir: './static-publisher' };`);
      const result = runCli([ 'dev' ], { cwd: emptyDir, allowFailure: true });
      assert.equal(result.status, 2);
      assert.match(result.output, /'dev' works only in a managed project/);
    } finally {
      removeDir(emptyDir);
    }
  });
});
