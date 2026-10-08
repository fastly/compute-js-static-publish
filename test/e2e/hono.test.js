/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Scaffolds a KV Store app with --template hono, publishes with --local, and
// serves the app with `fastly compute serve`. Needs the Fastly CLI and network
// access for `npm install`. No credentials are necessary.

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
import { checkResponseCache, checkServedContent } from './served-content.js';

const HTML = { accept: 'text/html' };

// Replaces src/index.js with a Hono app like the template, with the options of
// writeTestAppIndex(): a request with `x-use-cache: 1` uses a server that has the
// response cache, and Server-Timing is on for requests that have `x-server-timing`.
function writeHonoTestAppIndex(computeJsDir) {
  fs.writeFileSync(path.resolve(computeJsDir, 'src/index.js'), `\
/// <reference types="@fastly/js-compute" />
import { Hono } from 'hono';
import { buildFire } from '@fastly/hono-fastly-compute';
import { fromStaticPublishRc } from '@fastly/compute-js-static-publish/hono';
import rc from '../static-publish.rc.js';

function createMiddleware(responseCache) {
  const { publisherServer, serveStatic, serveFallback } = fromStaticPublishRc(rc);
  publisherServer.setServerTimingRequestHeader('x-server-timing');
  publisherServer.setResponseCache(responseCache);
  return {
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
app.use('/rooted/*', (c, next) => pick(c).serveRooted(c, next));
app.use('*', (c, next) => pick(c).serveStatic(c, next));
// A route after serveStatic: a path that does not match a file comes here.
app.get('/after-static', (c) => c.text('after static'));
app.notFound((c) => pick(c).serveFallback(c));

buildFire({})(app);
`);
}

describe('hono template (fastly compute serve)', { skip: skipUnlessFastlyCli() }, () => {
  let dir;
  let computeJsDir;
  let scaffoldedIndexJs;
  let scaffoldedPackageJson;
  let server;

  before(async () => {
    dir = makeTempDir('hono');
    writeFixtureContent(path.resolve(dir, 'public'));
    computeJsDir = scaffoldApp(dir, [ '--kv-store-name', 'e2e-content', '--template', 'hono' ]);
    scaffoldedIndexJs = fs.readFileSync(path.resolve(computeJsDir, 'src/index.js'), 'utf-8');
    scaffoldedPackageJson = JSON.parse(fs.readFileSync(path.resolve(computeJsDir, 'package.json'), 'utf-8'));
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

  test('scaffolds a Hono app', () => {
    assert.ok(scaffoldedPackageJson.dependencies.hono, 'package.json has hono');
    assert.ok(scaffoldedPackageJson.dependencies['@fastly/hono-fastly-compute'], 'package.json has @fastly/hono-fastly-compute');
    assert.match(scaffoldedIndexJs, /from '@fastly\/compute-js-static-publish\/hono'/);
    assert.match(scaffoldedIndexJs, /app\.notFound\(serveFallback\(\)\)/);
    assert.match(scaffoldedIndexJs, /^fire\(app\);$/m);
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
