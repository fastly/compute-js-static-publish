/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Scaffolds the plain app with collection selection flags, publishes two
// collections with --local, and serves the app (its own src/index.js) with
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

const HTML = { accept: 'text/html' };

const SELECTION_FLAGS = [
  '--collection-selection', 'query:collection,sticky',
  '--collection-selection', 'cookie,maxAge=600',
  '--collection-selection', 'header:x-publisher-collection',
  '--collection-allow', 'pr-*,staging',
];

// Scaffolds and publishes 'live' and 'pr-1'. 'staging' is allowed, but not published.
async function setUp(prefix, extraFlags = []) {
  const dir = makeTempDir(prefix);
  const publicDir = path.resolve(dir, 'public');
  writeFixtureContent(publicDir);
  const computeJsDir = scaffoldApp(dir, [ '--kv-store-name', 'e2e-content', ...SELECTION_FLAGS, ...extraFlags ]);
  runCli([ 'publish-content', '--local' ], { cwd: computeJsDir });
  fs.writeFileSync(path.resolve(publicDir, 'index.html'), '<!doctype html><title>Preview</title><h1>Preview home</h1>');
  runCli([ 'publish-content', '--local', '--collection-name', 'pr-1' ], { cwd: computeJsDir });
  const server = await startServe(computeJsDir);
  return { dir, server };
}

describe('collection selection in the plain app', { skip: skipUnlessFastlyCli() }, () => {
  let dir;
  let server;
  const get = (urlPath, headers = {}) => rawRequest(server.baseUrl + urlPath, { headers: { ...HTML, ...headers } });

  before(async () => {
    ({ dir, server } = await setUp('selection'));
  });

  after(async () => {
    await server?.stop();
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('without a selection: the default collection, with no preview headers', async () => {
    const res = await get('/');
    assert.equal(res.status, 200);
    assert.match(res.body.toString(), /<h1>Home<\/h1>/);
    assert.equal(res.headers['x-robots-tag'], undefined);
    assert.doesNotMatch(res.headers['cache-control'] ?? '', /private/);
  });

  test('header: serves the selected collection as a preview', async () => {
    const res = await get('/', { 'x-publisher-collection': 'pr-1' });
    assert.equal(res.status, 200);
    assert.match(res.body.toString(), /<h1>Preview home<\/h1>/);
    assert.equal(res.headers['x-publisher-server-collection'], 'pr-1');
    assert.equal(res.headers['x-robots-tag'], 'noindex');
    assert.match(res.headers['cache-control'] ?? '', /^private\b/);
  });

  test('header: the other files of the collection, and its 404 page', async () => {
    const about = await get('/about', { 'x-publisher-collection': 'pr-1' });
    assert.match(about.body.toString(), /<h1>About<\/h1>/);
    const missing = await get('/does-not-exist', { 'x-publisher-collection': 'pr-1' });
    assert.equal(missing.status, 404);
    assert.match(missing.body.toString(), /<h1>Not found<\/h1>/);
    assert.equal(missing.headers['x-robots-tag'], 'noindex');
  });

  test('query with sticky: sets the cookie and redirects without the parameter', async () => {
    const res = await get('/about?x=1&collection=pr-1');
    assert.equal(res.status, 302);
    assert.equal(res.headers['location'], '/about?x=1');
    const setCookie = [ res.headers['set-cookie'] ].flat()[0];
    assert.match(setCookie, /^publisher-collection=pr-1; Path=\/; Max-Age=600; HttpOnly; SameSite=Lax/);

    const next = await get('/', { cookie: setCookie.split(';')[0] });
    assert.match(next.body.toString(), /<h1>Preview home<\/h1>/);
  });

  test('cookie: activate and reset', async () => {
    const activate = await get('/activate?collection=pr-1&redirectTo=/about');
    assert.equal(activate.status, 302);
    assert.equal(activate.headers['location'], '/about');
    assert.match([ activate.headers['set-cookie'] ].flat()[0], /^publisher-collection=pr-1;/);

    const reset = await get('/reset');
    assert.equal(reset.status, 302);
    assert.match([ reset.headers['set-cookie'] ].flat()[0], /^publisher-collection=; .*Max-Age=0/);
  });

  test('cookie: activate redirects only to a path on this site', async () => {
    const res = await get('/activate?collection=pr-1&redirectTo=//example.com/');
    assert.equal(res.status, 302);
    assert.equal(res.headers['location'], '/');
  });

  test('a collection that is not allowed: the default collection', async () => {
    const res = await get('/', { 'x-publisher-collection': 'feature' });
    assert.match(res.body.toString(), /<h1>Home<\/h1>/);
    assert.equal((await get('/activate?collection=feature')).status, 403);
  });

  test('onMissing not-found (default): a 404 for a collection that does not exist', async () => {
    const res = await get('/', { 'x-publisher-collection': 'staging' });
    assert.equal(res.status, 404);
    assert.equal(res.body.toString(), `Collection 'staging' not found.`);
    assert.equal(res.headers['x-robots-tag'], 'noindex');
    assert.equal(res.headers['cache-control'], 'no-store');
  });
});

describe('collection selection with onMissing: default and noindex: false', { skip: skipUnlessFastlyCli() }, () => {
  let dir;
  let server;
  const get = (urlPath, headers = {}) => rawRequest(server.baseUrl + urlPath, { headers: { ...HTML, ...headers } });

  before(async () => {
    ({ dir, server } = await setUp('selection-default', [ '--collection-on-missing', 'default', '--collection-noindex', 'false' ]));
  });

  after(async () => {
    await server?.stop();
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('a collection that does not exist: the default collection', async () => {
    const res = await get('/', { 'x-publisher-collection': 'staging' });
    assert.equal(res.status, 200);
    assert.match(res.body.toString(), /<h1>Home<\/h1>/);
    assert.equal(res.headers['x-publisher-server-collection'], 'live');
    assert.doesNotMatch(res.headers['cache-control'] ?? '', /private/);
  });

  test('a preview has no X-Robots-Tag, but is still private', async () => {
    const res = await get('/', { 'x-publisher-collection': 'pr-1' });
    assert.match(res.body.toString(), /<h1>Preview home<\/h1>/);
    assert.equal(res.headers['x-robots-tag'], undefined);
    assert.match(res.headers['cache-control'] ?? '', /^private\b/);
  });
});
