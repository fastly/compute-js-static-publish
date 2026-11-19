/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// The /hono export in a Hono app: scaffolds a plain app, installs hono, replaces
// src/index.js with a Hono app, publishes with --local, and serves the app with
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
  run,
  runCli,
  scaffoldApp,
  skipUnlessFastlyCli,
  startServe,
  writeFixtureContent,
} from './helpers.js';
import { checkResponseCache, checkServedContent } from './served-content.js';

const HTML = { accept: 'text/html' };

// The packages that a Hono app adds to the scaffolded app.
function installHono(computeJsDir) {
  run('npm', [ 'install', '--no-audit', '--no-fund', 'hono@4.13.14', '@fastly/hono-fastly-compute@0.4.0' ], { cwd: computeJsDir });
}

// A Hono app with the options of writeTestAppIndex(): a request with
// `x-use-cache: 1` uses a server that has the response cache, and Server-Timing
// is on for requests that have `x-server-timing`.
function writeHonoTestAppIndex(computeJsDir) {
  fs.writeFileSync(path.resolve(computeJsDir, 'src/index.js'), `\
/// <reference types="@fastly/js-compute" />
import { Hono } from 'hono';
import { buildFire } from '@fastly/hono-fastly-compute';
import { fromStaticPublishRc } from '@fastly/compute-js-static-publish/hono';
import rc from '../static-publish.rc.js';

function createMiddleware(responseCache) {
  const { publisherServer, serveStatic, serveFallback, staticResponse, fallbackResponse } = fromStaticPublishRc(rc);
  publisherServer.setServerTimingRequestHeader('x-server-timing');
  publisherServer.setResponseCache(responseCache);
  return {
    staticResponse,
    fallbackResponse,
    serveStatic: serveStatic(),
    serveRooted: serveStatic({ root: './docs', rewriteRequestPath: (p) => p.replace(/^\\/rooted/, '') }),
    serveFallback: serveFallback(),
  };
}
const plain = createMiddleware(null);
const cached = createMiddleware({ maxAge: 60 });
const pick = (c) => c.req.header('x-use-cache') === '1' ? cached : plain;

const app = new Hono();
app.get('/api/hello', (c) => c.json({ hello: 'world' }));
// A file and the fallback page with another status, and a header.
app.get('/about-as-404', async (c) =>
  await pick(c).staticResponse(c, { path: '/about', status: 404, headers: { 'x-extension': 'yes' } }) ?? c.text('no file', 500));
app.get('/gone', async (c) =>
  await pick(c).fallbackResponse(c, { status: 410 }) ?? c.text('no fallback', 500));
app.use('/rooted/*', (c, next) => pick(c).serveRooted(c, next));
app.use('*', (c, next) => pick(c).serveStatic(c, next));
// A route after serveStatic: a path that does not match a file comes here.
app.get('/after-static', (c) => c.text('after static'));
app.notFound((c) => pick(c).serveFallback(c));

buildFire({})(app);
`);
}

// A Hono app with collection selection.
function writeHonoSelectionAppIndex(computeJsDir) {
  fs.writeFileSync(path.resolve(computeJsDir, 'src/index.js'), `\
/// <reference types="@fastly/js-compute" />
import { Hono } from 'hono';
import { buildFire } from '@fastly/hono-fastly-compute';
import { fromStaticPublishRc } from '@fastly/compute-js-static-publish/hono';
import rc from '../static-publish.rc.js';

const { serveStatic, serveFallback, selectCollection, isCollectionAvailable } = fromStaticPublishRc(rc);

const app = new Hono();
app.use('*', selectCollection());
app.get('/api/collection', (c) => c.json({ collectionName: c.var.staticPublisher.collectionName }));
app.get('/api/available', async (c) => c.json({
  selected: await isCollectionAvailable(c),
  staging: await isCollectionAvailable(c, 'staging'),
  default: await isCollectionAvailable(c, null),
}));
app.use('*', serveStatic());
app.notFound(serveFallback());

buildFire({})(app);
`);
}

describe('the /hono export (fastly compute serve)', { skip: skipUnlessFastlyCli() }, () => {
  let dir;
  let server;

  before(async () => {
    dir = makeTempDir('hono');
    writeFixtureContent(path.resolve(dir, 'public'));
    const computeJsDir = scaffoldApp(dir, [ '--kv-store-name', 'e2e-content' ]);
    installHono(computeJsDir);
    writeHonoTestAppIndex(computeJsDir);
    runCli([ 'publish-content', '--local' ], { cwd: computeJsDir });
    server = await startServe(computeJsDir);
  });

  after(async () => {
    await server?.stop();
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('serves the published content', async (t) => {
    await checkServedContent(t, server.baseUrl);
  });

  test('caches responses with the response cache', async (t) => {
    await checkResponseCache(t, server.baseUrl);
  });

  test('serves a route before serveStatic', async () => {
    const res = await rawRequest(server.baseUrl + '/api/hello');
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body.toString()), { hello: 'world' });
  });

  test('serves a route after serveStatic for an HTML request', async () => {
    const res = await rawRequest(server.baseUrl + '/after-static', { headers: HTML });
    assert.equal(res.status, 200);
    assert.equal(res.body.toString(), 'after static');
  });

  test('serves files under root with rewriteRequestPath', async () => {
    const res = await rawRequest(server.baseUrl + '/rooted/', { headers: HTML });
    assert.equal(res.status, 200);
    assert.match(res.body.toString(), /<h1>Docs<\/h1>/);
  });

  // serveFallback() gives null for POST, so this is also Hono's own 404 response.
  test('does not serve a file for POST', async () => {
    const res = await rawRequest(server.baseUrl + '/style.css', { method: 'POST' });
    assert.equal(res.status, 404);
    assert.equal(res.body.toString(), '404 Not Found');
  });

  test('does not answer /healthz', async () => {
    const res = await rawRequest(server.baseUrl + '/healthz', { headers: { accept: 'application/json' } });
    assert.equal(res.status, 404);
  });

  test('reads the index one time for a file lookup and the fallback', async () => {
    const res = await rawRequest(server.baseUrl + '/missing-page', { headers: { ...HTML, 'x-server-timing': '1' } });
    assert.equal(res.status, 404);
    assert.match(res.body.toString(), /<h1>Not found<\/h1>/);
    const timing = res.headers['server-timing'] ?? '';
    assert.equal(timing.match(/\bindex;dur=/g)?.length, 1, timing);
  });

  for (const [ name, cacheHeaders ] of [ [ 'without', {} ], [ 'with', { 'x-use-cache': '1' } ] ]) {
    test(`staticResponse() with status and headers, ${name} the response cache`, async () => {
      const get = (headers = {}) => rawRequest(server.baseUrl + '/about-as-404', { headers: { ...HTML, ...cacheHeaders, ...headers } });
      const res = await get();
      assert.equal(res.status, 404);
      assert.match(res.body.toString(), /<h1>About<\/h1>/);
      assert.equal(res.headers['x-extension'], 'yes');
      const etag = res.headers['etag'];
      assert.ok(etag);
      // A status other than 2xx: the preconditions are not evaluated.
      const conditional = await get({ 'if-none-match': etag });
      assert.equal(conditional.status, 404);
      assert.match(conditional.body.toString(), /<h1>About<\/h1>/);
    });

    test(`fallbackResponse() with status, ${name} the response cache`, async () => {
      const get = (headers = {}) => rawRequest(server.baseUrl + '/gone', { headers: { ...HTML, ...cacheHeaders, ...headers } });
      const res = await get();
      assert.equal(res.status, 410);
      assert.match(res.body.toString(), /<h1>Not found<\/h1>/);
      const conditional = await get({ 'if-none-match': res.headers['etag'] });
      assert.equal(conditional.status, 410);
      assert.match(conditional.body.toString(), /<h1>Not found<\/h1>/);
    });

    test(`the 404 page with a matching If-None-Match is a 404, ${name} the response cache`, async () => {
      const get = (headers = {}) => rawRequest(server.baseUrl + '/missing-etag', { headers: { ...HTML, ...cacheHeaders, ...headers } });
      const res = await get();
      assert.equal(res.status, 404);
      const conditional = await get({ 'if-none-match': res.headers['etag'] });
      assert.equal(conditional.status, 404);
      assert.match(conditional.body.toString(), /<h1>Not found<\/h1>/);
    });

    test(`a file with a matching If-None-Match is still a 304, ${name} the response cache`, async () => {
      const get = (headers = {}) => rawRequest(server.baseUrl + '/about', { headers: { ...HTML, ...cacheHeaders, ...headers } });
      const res = await get();
      assert.equal(res.status, 200);
      const conditional = await get({ 'if-none-match': res.headers['etag'] });
      assert.equal(conditional.status, 304);
    });
  }

  test('caches the fallback page with one key for all paths', async () => {
    const headers = { ...HTML, 'x-use-cache': '1', 'x-server-timing': '1' };
    await rawRequest(server.baseUrl + '/missing-a', { headers });
    const res = await rawRequest(server.baseUrl + '/missing-b', { headers });
    assert.equal(res.status, 404);
    assert.match(res.body.toString(), /<h1>Not found<\/h1>/);
    // The file lookup for /missing-b is a miss, and the fallback is a hit.
    const timing = res.headers['server-timing'] ?? '';
    assert.match(timing, /\bcache;dur=[\d.]+;desc="miss"/, timing);
    assert.match(timing, /\bcache;dur=[\d.]+;desc="hit age=\d+s"/, timing);
  });
});

describe('selectCollection() of the /hono export (fastly compute serve)', { skip: skipUnlessFastlyCli() }, () => {
  let dir;
  let server;
  const get = (urlPath, headers = {}) => rawRequest(server.baseUrl + urlPath, { headers: { ...HTML, ...headers } });

  before(async () => {
    dir = makeTempDir('hono-selection');
    const publicDir = path.resolve(dir, 'public');
    writeFixtureContent(publicDir);
    const computeJsDir = scaffoldApp(dir, [
      '--kv-store-name', 'e2e-content',
      '--collection-selection', 'query:collection,sticky',
      '--collection-selection', 'cookie',
      '--collection-selection', 'header:x-publisher-collection',
      '--collection-selection', 'path:/_preview/{collection}',
      '--collection-allow', 'pr-*,staging',
    ]);
    installHono(computeJsDir);
    writeHonoSelectionAppIndex(computeJsDir);
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

  test('without a selection: the default collection', async () => {
    const res = await get('/');
    assert.match(res.body.toString(), /<h1>Home<\/h1>/);
    assert.equal(res.headers['x-robots-tag'], undefined);
    const api = await get('/api/collection');
    assert.deepEqual(JSON.parse(api.body.toString()), { collectionName: null });
  });

  test('header: serveStatic() uses the selected collection, as a private preview', async () => {
    const res = await get('/', { 'x-publisher-collection': 'pr-1' });
    assert.match(res.body.toString(), /<h1>Preview home<\/h1>/);
    assert.equal(res.headers['x-robots-tag'], 'noindex');
    assert.match(res.headers['cache-control'] ?? '', /^private\b/);
    const api = await get('/api/collection', { 'x-publisher-collection': 'pr-1' });
    assert.deepEqual(JSON.parse(api.body.toString()), { collectionName: 'pr-1' });
  });

  test('header: serveFallback() uses the selected collection', async () => {
    const res = await get('/does-not-exist', { 'x-publisher-collection': 'pr-1' });
    assert.equal(res.status, 404);
    assert.match(res.body.toString(), /<h1>Not found<\/h1>/);
    assert.equal(res.headers['x-robots-tag'], 'noindex');
  });

  test('path: serveStatic() looks up the path without the prefix', async () => {
    const res = await get('/_preview/pr-1/');
    assert.equal(res.status, 200);
    assert.match(res.body.toString(), /<h1>Preview home<\/h1>/);
    assert.doesNotMatch(res.headers['cache-control'] ?? '', /private/);
    const about = await get('/_preview/pr-1/about');
    assert.match(about.body.toString(), /<h1>About<\/h1>/);
  });

  test('query with sticky: selectCollection() returns the redirect', async () => {
    const res = await get('/about?collection=pr-1');
    assert.equal(res.status, 308);
    assert.equal(res.headers['location'], '/about');
    assert.match([ res.headers['set-cookie'] ].flat()[0], /^publisher-collection=pr-1;/);
  });

  test('isCollectionAvailable() checks the selected collection by default', async () => {
    const without = await get('/api/available');
    assert.deepEqual(JSON.parse(without.body.toString()), { selected: true, staging: false, default: true });
    const preview = await get('/api/available', { 'x-publisher-collection': 'pr-1' });
    assert.deepEqual(JSON.parse(preview.body.toString()), { selected: true, staging: false, default: true });
    const missing = await get('/api/available', { 'x-publisher-collection': 'staging' });
    assert.deepEqual(JSON.parse(missing.body.toString()), { selected: false, staging: false, default: true });
  });

  test('a collection that is not published: the 404 of the server', async () => {
    const res = await get('/', { 'x-publisher-collection': 'staging' });
    assert.equal(res.status, 404);
    assert.equal(res.body.toString(), `Collection 'staging' is not available. It is not published, or it expired.`);
  });
});
