/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Publishes hidden files with --local, and serves the app with
// `fastly compute serve`. Needs the Fastly CLI and network access for
// `npm install`. No credentials are necessary.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import {
  makeTempDir,
  rawRequest,
  removeDir,
  runCli,
  scaffoldApp,
  skipUnlessFastlyCli,
  startServe,
  writeFixtureContent,
} from './helpers.js';

// A request with `x-get-asset: <key>` calls getMatchingAsset(key, { includeHidden: true }).
// With `x-get-asset-boolean: <key>`, it calls getMatchingAsset(key, true), the old form.
const TEST_APP_INDEX = `\
/// <reference types="@fastly/js-compute" />
import { PublisherServer } from '@fastly/compute-js-static-publish';
import rc from '../static-publish.rc.js';

const server = PublisherServer.fromStaticPublishRc(rc);

addEventListener('fetch', (event) => event.respondWith(handleRequest(event)));
async function handleRequest(event) {
  const request = event.request;
  const key = request.headers.get('x-get-asset');
  const booleanKey = request.headers.get('x-get-asset-boolean');
  if (key != null || booleanKey != null) {
    server.beginRequest(request);
    const asset = key != null ?
      await server.getMatchingAsset(key, { includeHidden: true }) :
      await server.getMatchingAsset(booleanKey, true);
    if (asset == null) {
      return new Response('No asset (app)', { status: 404 });
    }
    return server.serveAsset(request, asset);
  }
  const response = await server.serveRequest(request);
  if (response != null) {
    return response;
  }
  return new Response('Not found (app)', { status: 404 });
}
`;

const HTML = { accept: 'text/html' };

const HIDDEN_FILES = {
  'templates/email.html': '<!doctype html><h1>Email template</h1>',
  'secret.html': '<!doctype html><h1>Secret</h1>',
  'private/index.html': '<!doctype html><h1>Private index</h1>',
  'notes.tpl': 'Notes template',
};

describe('hidden files', { skip: skipUnlessFastlyCli() }, () => {
  let dir;
  let computeJsDir;
  let kvStoreJsonPath;
  let server;
  let publishOutput;

  const readKvStoreJson = () => JSON.parse(fs.readFileSync(kvStoreJsonPath, 'utf-8'));
  // The local KV Store keeps the data of an entry in a file.
  const readEntryJson = (key) => JSON.parse(fs.readFileSync(path.resolve(computeJsDir, readKvStoreJson()[key].file), 'utf-8'));

  before(async () => {
    dir = makeTempDir('hidden');
    const publicDir = path.resolve(dir, 'public');
    writeFixtureContent(publicDir);
    for (const [ name, content ] of Object.entries(HIDDEN_FILES)) {
      fs.mkdirSync(path.dirname(path.resolve(publicDir, name)), { recursive: true });
      fs.writeFileSync(path.resolve(publicDir, name), content);
    }
    // A file whose name starts with 'hidden:' is not hidden. Its key is '/hidden:x.html'.
    fs.writeFileSync(path.resolve(publicDir, 'hidden:x.html'), '<!doctype html><h1>Not hidden</h1>');

    computeJsDir = scaffoldApp(dir, [ '--kv-store-name', 'e2e-content' ]);
    fs.writeFileSync(path.resolve(computeJsDir, 'src/index.js'), TEST_APP_INDEX);

    const configPath = path.resolve(computeJsDir, 'publish-content.config.js');
    const config = fs.readFileSync(configPath, 'utf-8').replace(
      /^ {2}rootDir: .*$/m,
      `$&
  hiddenItems: [ '/templates/', '/secret.html', '/private/', '/404.html' ],
  assetInclusionTest: (key) => key.endsWith('.tpl') ? { hidden: true } : true,`,
    );
    assert.match(config, /hiddenItems/);
    fs.writeFileSync(configPath, config);

    ({ output: publishOutput } = runCli([ 'publish-content', '--local' ], { cwd: computeJsDir }));
    kvStoreJsonPath = path.resolve(computeJsDir, 'static-publisher/kvstore.json');
    server = await startServe(computeJsDir);
  });

  after(async () => {
    await server?.stop();
    if (dir != null) {
      removeDir(dir);
    }
  });

  describe('publish', () => {
    test('writes hidden: keys into the index', () => {
      const index = readEntryJson('default_index_live');
      const keys = Object.keys(index);
      for (const key of [ '/templates/email.html', '/secret.html', '/private/index.html', '/404.html', '/notes.tpl' ]) {
        assert.ok(keys.includes(`hidden:${key}`), `hidden:${key}`);
        assert.ok(!keys.includes(key), key);
      }
      assert.ok(keys.includes('/index.html'));
      assert.ok(keys.includes('/hidden:x.html'));
    });

    test('the index metadata requires hidden', () => {
      const metadata = JSON.parse(readKvStoreJson()['default_index_live'].metadata);
      assert.equal(metadata.requires, 'hidden');
    });

    test('the summary shows the number of hidden files', () => {
      assert.match(publishOutput, /file\(s\) in the index, 5 of them hidden\./);
    });

    test('keeps a hidden 404 page in the settings', () => {
      const settings = readEntryJson('default_settings_live');
      assert.equal(settings.notFoundPageFile, '/404.html');
    });

    test('collections list shows the number of hidden files', () => {
      const { output } = runCli([ 'collections', 'list', '--local' ], { cwd: computeJsDir });
      assert.match(output, /Files {6}: \d+ \(5 hidden\)/);
    });
  });

  describe('serveRequest()', () => {
    test('does not serve a hidden file', async () => {
      for (const urlPath of [ '/templates/email.html', '/secret.html', '/private/index.html', '/notes.tpl' ]) {
        const res = await rawRequest(server.baseUrl + urlPath, { headers: HTML });
        assert.equal(res.status, 404, urlPath);
        assert.match(res.body.toString(), /<h1>Not found<\/h1>/, urlPath);
      }
    });

    test('does not serve a hidden file with autoExt or autoIndex', async () => {
      for (const urlPath of [ '/secret', '/private/', '/private' ]) {
        const res = await rawRequest(server.baseUrl + urlPath, { headers: HTML });
        assert.equal(res.status, 404, urlPath);
        assert.doesNotMatch(res.body.toString(), /Secret|Private/, urlPath);
      }
    });

    test('serves a hidden 404 page as the fallback, and not for its own path', async () => {
      const res = await rawRequest(server.baseUrl + '/404.html', { headers: HTML });
      assert.equal(res.status, 404);
      assert.match(res.body.toString(), /<h1>Not found<\/h1>/);
    });

    test('serves a file named hidden:x', async () => {
      const res = await rawRequest(server.baseUrl + '/hidden:x.html', { headers: HTML });
      assert.equal(res.status, 200);
      assert.match(res.body.toString(), /<h1>Not hidden<\/h1>/);
    });

    test('serves the files that are not hidden', async () => {
      const res = await rawRequest(server.baseUrl + '/', { headers: HTML });
      assert.equal(res.status, 200);
      assert.match(res.body.toString(), /<h1>Home<\/h1>/);
    });
  });

  describe('getMatchingAsset()', () => {
    test('finds a hidden file with includeHidden', async () => {
      const res = await rawRequest(server.baseUrl + '/', { headers: { 'x-get-asset': '/templates/email.html' } });
      assert.equal(res.status, 200);
      assert.match(res.body.toString(), /<h1>Email template<\/h1>/);
    });

    test('does not find a hidden file with the boolean form', async () => {
      const res = await rawRequest(server.baseUrl + '/', { headers: { 'x-get-asset-boolean': '/secret' } });
      assert.equal(res.body.toString(), 'No asset (app)');
      const visible = await rawRequest(server.baseUrl + '/', { headers: { 'x-get-asset-boolean': '/about' } });
      assert.match(visible.body.toString(), /<h1>About<\/h1>/);
    });

    test('does not look up a hidden: key directly', async () => {
      const res = await rawRequest(server.baseUrl + '/', { headers: { 'x-get-asset': 'hidden:/secret.html' } });
      assert.equal(res.body.toString(), 'No asset (app)');
    });
  });

  describe('collections', () => {
    test('promote keeps the hidden files and requires', () => {
      runCli([ 'collections', 'promote', '--collection-name', 'live', '--to', 'copy', '--local' ], { cwd: computeJsDir });
      assert.equal(JSON.parse(readKvStoreJson()['default_index_copy'].metadata).requires, 'hidden');
      assert.ok(Object.keys(readEntryJson('default_index_copy')).includes('hidden:/secret.html'));
    });

    test('clean keeps the content of hidden files', () => {
      const index = readEntryJson('default_index_live');
      const hash = index['hidden:/secret.html'].key.slice('sha256:'.length);
      runCli([ 'clean', '--local' ], { cwd: computeJsDir });
      assert.ok(Object.keys(readKvStoreJson()).includes(`default_files_sha256_${hash}`));
    });
  });
});
