/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Checks the options of serveRequest(), and serveFallback(), with and without
// the response cache. Needs the Fastly CLI and network access for
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

// The request headers select the options:
// - x-active: the collection for setActiveCollectionName().
// - x-collection: the collectionName option ('default' sends null).
// - x-pathname: the pathname option.
// - x-no-fallback: fallback: false. With x-serve-fallback, then call serveFallback().
// - x-only-fallback: call only serveFallback().
// - x-no-health-check: healthCheck: false.
// - x-use-cache: use a server that has the response cache.
const TEST_APP_INDEX = `\
/// <reference types="@fastly/js-compute" />
import { PublisherServer } from '@fastly/compute-js-static-publish';
import rc from '../static-publish.rc.js';

function createServer(responseCache) {
  const server = PublisherServer.fromStaticPublishRc(rc);
  server.setServerTimingRequestHeader('x-server-timing');
  server.setResponseCache(responseCache);
  return server;
}
const publisherServer = createServer(null);
const cachedPublisherServer = createServer({ maxAge: 60 });

addEventListener('fetch', (event) => event.respondWith(handleRequest(event)));
async function handleRequest(event) {
  const request = event.request;
  const h = (name) => request.headers.get(name);
  const server = h('x-use-cache') === '1' ? cachedPublisherServer : publisherServer;
  server.setActiveCollectionName(h('x-active'));

  const collectionName = h('x-collection') === 'default' ? null : (h('x-collection') ?? undefined);
  try {
    let response;
    if (h('x-only-fallback') === '1') {
      response = await server.serveFallback(request, { collectionName });
    } else {
      response = await server.serveRequest(request, {
        collectionName,
        pathname: h('x-pathname') ?? undefined,
        fallback: h('x-no-fallback') !== '1',
        healthCheck: h('x-no-health-check') !== '1',
      });
      if (response == null && h('x-serve-fallback') === '1') {
        response = await server.serveFallback(request, { collectionName });
      }
    }
    if (response != null) {
      return response;
    }
    return new Response('Not found (app)', { status: 404 });
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
}
`;

const HTML = { accept: 'text/html' };

describe('serveRequest() options and serveFallback()', { skip: skipUnlessFastlyCli() }, () => {
  let dir;
  let computeJsDir;
  let server;

  const get = (urlPath, headers = {}, method = 'GET') => rawRequest(server.baseUrl + urlPath, { method, headers });

  before(async () => {
    dir = makeTempDir('serve-options');
    const publicDir = path.resolve(dir, 'public');
    writeFixtureContent(publicDir);
    computeJsDir = scaffoldApp(dir, [ '--kv-store-name', 'e2e-content' ]);
    fs.writeFileSync(path.resolve(computeJsDir, 'src/index.js'), TEST_APP_INDEX);
    runCli([ 'publish-content', '--local' ], { cwd: computeJsDir });

    // A second collection with other content.
    fs.writeFileSync(path.resolve(publicDir, 'index.html'), '<!doctype html><title>Preview</title><h1>Preview home</h1>');
    fs.writeFileSync(path.resolve(publicDir, '404.html'), '<!doctype html><title>Preview</title><h1>Preview not found</h1>');
    runCli([ 'publish-content', '--local', '--collection-name', 'preview' ], { cwd: computeJsDir });

    server = await startServe(computeJsDir);
  });

  after(async () => {
    await server?.stop();
    if (dir != null) {
      removeDir(dir);
    }
  });

  describe('collectionName', () => {
    test('serves the collection for this call only', async () => {
      const preview = await get('/', { ...HTML, 'x-collection': 'preview' });
      assert.equal(preview.status, 200);
      assert.match(preview.body.toString(), /<h1>Preview home<\/h1>/);
      assert.equal(preview.headers['x-publisher-server-collection'], 'preview');

      const live = await get('/', HTML);
      assert.match(live.body.toString(), /<h1>Home<\/h1>/);
    });

    test('null selects the default collection, not the active collection', async () => {
      const active = await get('/', { ...HTML, 'x-active': 'preview' });
      assert.match(active.body.toString(), /<h1>Preview home<\/h1>/);

      const res = await get('/', { ...HTML, 'x-active': 'preview', 'x-collection': 'default' });
      assert.match(res.body.toString(), /<h1>Home<\/h1>/);
      assert.equal(res.headers['x-publisher-server-collection'], 'live');
    });

    test('a collection that does not exist gives no response', async () => {
      const res = await get('/', { ...HTML, 'x-collection': 'missing' });
      assert.equal(res.status, 500);
      assert.match(res.body.toString(), /Settings not found/);
    });
  });

  describe('pathname', () => {
    test('looks up the path in place of the URL path', async () => {
      const res = await get('/other/path', { ...HTML, 'x-pathname': '/about.html' });
      assert.equal(res.status, 200);
      assert.match(res.body.toString(), /<h1>About<\/h1>/);
    });

    test('uses autoExt and autoIndex', async () => {
      const about = await get('/x', { ...HTML, 'x-pathname': '/about' });
      assert.match(about.body.toString(), /<h1>About<\/h1>/);
      const docs = await get('/x', { ...HTML, 'x-pathname': '/docs/' });
      assert.match(docs.body.toString(), /<h1>Docs<\/h1>/);
    });

    test('must start with a slash', async () => {
      const res = await get('/', { ...HTML, 'x-pathname': 'about.html' });
      assert.equal(res.status, 500);
      assert.match(res.body.toString(), /TypeError: pathname must start with '\/'/);
    });
  });

  describe('fallback', () => {
    test('true (the default) serves the 404 page', async () => {
      const res = await get('/does-not-exist', HTML);
      assert.equal(res.status, 404);
      assert.match(res.body.toString(), /<h1>Not found<\/h1>/);
    });

    test('false gives no response when no file matches', async () => {
      const res = await get('/does-not-exist', { ...HTML, 'x-no-fallback': '1' });
      assert.equal(res.status, 404);
      assert.equal(res.body.toString(), 'Not found (app)');
    });

    test('false still serves a file that matches', async () => {
      const res = await get('/about', { ...HTML, 'x-no-fallback': '1' });
      assert.equal(res.status, 200);
      assert.match(res.body.toString(), /<h1>About<\/h1>/);
    });
  });

  describe('healthCheck', () => {
    test('true (the default) answers /healthz', async () => {
      const res = await get('/healthz');
      assert.equal(res.status, 200);
      assert.equal(res.body.toString(), 'OK');
    });

    test('false does not answer /healthz', async () => {
      const res = await get('/healthz', { 'x-no-health-check': '1', 'x-no-fallback': '1' });
      assert.equal(res.status, 404);
      assert.equal(res.body.toString(), 'Not found (app)');
    });
  });

  describe('serveFallback()', () => {
    test('serves the 404 page after serveRequest() with fallback: false', async () => {
      const res = await get('/does-not-exist', { ...HTML, 'x-no-fallback': '1', 'x-serve-fallback': '1' });
      assert.equal(res.status, 404);
      assert.match(res.body.toString(), /<h1>Not found<\/h1>/);
    });

    test('uses the collectionName option', async () => {
      const res = await get('/does-not-exist', { ...HTML, 'x-only-fallback': '1', 'x-collection': 'preview' });
      assert.equal(res.status, 404);
      assert.match(res.body.toString(), /<h1>Preview not found<\/h1>/);
    });

    test('gives no response for a method other than GET and HEAD', async () => {
      const res = await get('/does-not-exist', { ...HTML, 'x-only-fallback': '1' }, 'POST');
      assert.equal(res.body.toString(), 'Not found (app)');
    });
  });

  describe('with the response cache', () => {
    const CACHE = { 'x-use-cache': '1', 'x-server-timing': '1' };

    test('fallback: false and the default have different cache keys', async () => {
      // Use paths that no other test requests, so that the first request is a miss.
      const noFallback = await get('/missing-1', { ...HTML, ...CACHE, 'x-no-fallback': '1' });
      assert.equal(noFallback.body.toString(), 'Not found (app)');
      const withFallback = await get('/missing-1', { ...HTML, ...CACHE });
      assert.equal(withFallback.status, 404);
      assert.match(withFallback.body.toString(), /<h1>Not found<\/h1>/);

      const withFallback2 = await get('/missing-2', { ...HTML, ...CACHE });
      assert.match(withFallback2.body.toString(), /<h1>Not found<\/h1>/);
      const noFallback2 = await get('/missing-2', { ...HTML, ...CACHE, 'x-no-fallback': '1' });
      assert.equal(noFallback2.body.toString(), 'Not found (app)');
    });

    test('serveFallback() uses one cache key for all paths', async () => {
      const first = await get('/missing-3', { ...HTML, ...CACHE, 'x-only-fallback': '1' });
      assert.equal(first.status, 404);
      assert.match(first.body.toString(), /<h1>Not found<\/h1>/);
      assert.match(first.headers['server-timing'] ?? '', /\bcache;dur=[\d.]+;desc="miss"/);

      const second = await get('/missing-4', { ...HTML, ...CACHE, 'x-only-fallback': '1' });
      assert.equal(second.status, 404);
      assert.match(second.body.toString(), /<h1>Not found<\/h1>/);
      assert.match(second.headers['server-timing'] ?? '', /\bcache;dur=[\d.]+;desc="hit age=\d+s"/);
    });

    test('the cache key has the collection', async () => {
      const preview = await get('/', { ...HTML, ...CACHE, 'x-collection': 'preview' });
      assert.match(preview.body.toString(), /<h1>Preview home<\/h1>/);
      const live = await get('/', { ...HTML, ...CACHE });
      assert.match(live.body.toString(), /<h1>Home<\/h1>/);
      const previewAgain = await get('/', { ...HTML, ...CACHE, 'x-collection': 'preview' });
      assert.match(previewAgain.body.toString(), /<h1>Preview home<\/h1>/);
      assert.match(previewAgain.headers['server-timing'] ?? '', /\bcache;dur=[\d.]+;desc="hit age=\d+s"/);
    });

    test('the pathname option is the cache key', async () => {
      const first = await get('/a', { ...HTML, ...CACHE, 'x-pathname': '/about.html' });
      assert.match(first.body.toString(), /<h1>About<\/h1>/);
      const second = await get('/b', { ...HTML, ...CACHE, 'x-pathname': '/about.html' });
      assert.match(second.body.toString(), /<h1>About<\/h1>/);
      assert.match(second.headers['server-timing'] ?? '', /\bcache;dur=[\d.]+;desc="hit age=\d+s"/);
    });
  });
});
