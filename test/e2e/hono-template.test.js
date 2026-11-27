/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// The hono template: scaffolds an app with --template hono (also in a managed
// project, and with a switch from plain to hono), publishes with --local, and
// serves the app with `fastly compute serve` or `dev`. The entry file of the
// app is src/index.ts. Needs the Fastly CLI and network access for
// `npm install`. No credentials are necessary.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import {
  CLI_PATH,
  makeTempDir,
  rawRequest,
  removeDir,
  runCli,
  scaffoldApp,
  skipUnlessFastlyCli,
  startServe,
  writeFixtureContent,
} from './helpers.js';
import { checkServedContent } from './served-content.js';

const HTML = { accept: 'text/html' };

const startDev = (projectDir) => startServe(projectDir, {
  command: (addr) => [ process.execPath, [ CLI_PATH, 'dev', '--', '--addr', addr ] ],
});

describe('the hono template (fastly compute serve)', { skip: skipUnlessFastlyCli() }, () => {
  let dir;
  let computeJsDir;
  let server;
  const get = (urlPath, headers = {}) => rawRequest(server.baseUrl + urlPath, { headers: { ...HTML, ...headers } });

  before(async () => {
    dir = makeTempDir('hono-template');
    const publicDir = path.resolve(dir, 'public');
    writeFixtureContent(publicDir);
    computeJsDir = scaffoldApp(dir, [
      '--kv-store-name', 'e2e-content',
      '--template', 'hono',
      '--collection-selection', 'header:x-publisher-collection',
      '--collection-selection', 'path:/_preview/{collection}',
      '--collection-allow', 'pr-*',
    ]);
    runCli([ 'publish-content', '--local' ], { cwd: computeJsDir });
    fs.writeFileSync(path.resolve(publicDir, 'index.html'), '<!doctype html><title>Preview</title><h1>Preview home</h1>');
    runCli([ 'publish-content', '--local', '--collection-name', 'pr-1' ], { cwd: computeJsDir });
    server = await startServe(computeJsDir);
  });

  after(async () => {
    await server?.stop();
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('scaffolds a TypeScript Hono app', () => {
    assert.ok(fs.existsSync(path.resolve(computeJsDir, 'src/index.ts')));
    assert.ok(fs.existsSync(path.resolve(computeJsDir, 'tsconfig.json')));
    assert.equal(fs.existsSync(path.resolve(computeJsDir, 'src/index.js')), false);
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(computeJsDir, 'package.json'), 'utf-8'));
    assert.equal(packageJson.scripts.build, 'js-compute-runtime ./src/index.ts ./bin/main.wasm');
    assert.ok(packageJson.dependencies.hono);
    assert.ok(packageJson.dependencies['@fastly/hono-fastly-compute']);
    assert.ok(packageJson.devDependencies.typescript);
  });

  test('serves the published content', async (t) => {
    // The template does not turn on Server-Timing.
    await checkServedContent(t, server.baseUrl, { serverTiming: false });
  });

  test('a preview through a header is private', async () => {
    const res = await get('/', { 'x-publisher-collection': 'pr-1' });
    assert.match(res.body.toString(), /<h1>Preview home<\/h1>/);
    assert.equal(res.headers['x-robots-tag'], 'noindex');
    assert.match(res.headers['cache-control'] ?? '', /^private\b/);
  });

  test('a preview through a path source serves the path without the prefix', async () => {
    const res = await get('/_preview/pr-1/about');
    assert.equal(res.status, 200);
    assert.match(res.body.toString(), /<h1>About<\/h1>/);
  });

  test('the 404 page for a path that does not match', async () => {
    const res = await get('/does-not-exist');
    assert.equal(res.status, 404);
    assert.match(res.body.toString(), /<h1>Not found<\/h1>/);
  });
});

describe('the hono template in a managed project (dev)', { skip: skipUnlessFastlyCli() }, () => {
  let dir;
  let projectDir;
  let server;

  before(async () => {
    dir = makeTempDir('hono-managed');
    projectDir = path.resolve(dir, 'site');
    writeFixtureContent(path.resolve(projectDir, 'public'));
    runCli([ '--managed', '--template', 'hono', '--root-dir', './public', '--kv-store-name', 'e2e-content' ], { cwd: projectDir });
    runCli([ 'publish-content', '--local' ], { cwd: projectDir });
    server = await startDev(projectDir);
  });

  after(async () => {
    await server?.stop();
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('the project file selects the hono template', () => {
    assert.match(fs.readFileSync(path.resolve(projectDir, 'static-publish.project.js'), 'utf-8'), /^ {4}template: "hono",$/m);
    assert.ok(fs.existsSync(path.resolve(projectDir, '.static-publish/app/src/index.ts')));
  });

  test('serves the published content', async (t) => {
    await checkServedContent(t, server.baseUrl, { serverTiming: false });
  });
});

describe('a switch from plain to hono in a managed project', { skip: skipUnlessFastlyCli() }, () => {
  let dir;
  let projectDir;
  let server;
  let projectFile;
  const fingerprint = () => JSON.parse(runCli([ 'status', '--json' ], { cwd: projectDir, env: { FASTLY_API_TOKEN: '', FASTLY_SERVICE_ID: '' } }).stdout).fingerprint.current;

  before(async () => {
    dir = makeTempDir('hono-switch');
    projectDir = path.resolve(dir, 'site');
    writeFixtureContent(path.resolve(projectDir, 'public'));
    runCli([ '--managed', '--root-dir', './public', '--kv-store-name', 'e2e-content' ], { cwd: projectDir });
    runCli([ 'publish-content', '--local' ], { cwd: projectDir });
    projectFile = path.resolve(projectDir, 'static-publish.project.js');
  });

  after(async () => {
    await server?.stop();
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('the fingerprint changes, and dev serves the hono app', async (t) => {
    const before = fingerprint();
    const text = fs.readFileSync(projectFile, 'utf-8');
    assert.match(text, /^ {4}template: "plain",$/m);
    fs.writeFileSync(projectFile, text.replace(/^ {4}template: "plain",$/m, '    template: "hono",'));
    assert.notEqual(fingerprint(), before, 'a switch changes the fingerprint, so deploy deploys again');

    server = await startDev(projectDir);
    const appDir = path.resolve(projectDir, '.static-publish/app');
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(appDir, 'package.json'), 'utf-8'));
    assert.equal(packageJson.scripts.build, 'js-compute-runtime ./src/index.ts ./bin/main.wasm');
    assert.ok(fs.existsSync(path.resolve(appDir, 'node_modules/hono')), 'npm ci installed the dependencies of hono');
    await checkServedContent(t, server.baseUrl, { serverTiming: false });
  });
});
