/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Checks that a running app serves the content of writeFixtureContent().

import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import { LARGE_TEXT, rawRequest } from './helpers.js';

const HTML = { accept: 'text/html' };

// Content that v7 published has the v7 content types. The v7 scaffolder sets
// autoExt to [] (it loses the default), and the original src/index.js of a v7
// app does not turn on Server-Timing. Set the options to false to skip these
// checks.
export async function checkServedContent(t, baseUrl, { autoExt = true, contentTypes = true, serverTiming = true } = {}) {

  await t.test('serves index.html for /', async () => {
    const res = await rawRequest(baseUrl + '/', { headers: HTML });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /^text\/html/);
    assert.match(res.body.toString(), /<h1>Home<\/h1>/);
  });

  await t.test('adds an extension from autoExt', { skip: !autoExt }, async () => {
    const res = await rawRequest(baseUrl + '/about', { headers: HTML });
    assert.equal(res.status, 200);
    assert.match(res.body.toString(), /<h1>About<\/h1>/);
  });

  await t.test('serves an index file from autoIndex', async () => {
    const res = await rawRequest(baseUrl + '/docs/', { headers: HTML });
    assert.equal(res.status, 200);
    assert.match(res.body.toString(), /<h1>Docs<\/h1>/);
  });

  await t.test('serves the 404 page for a missing path', async () => {
    const res = await rawRequest(baseUrl + '/does-not-exist', { headers: HTML });
    assert.equal(res.status, 404);
    assert.match(res.body.toString(), /<h1>Not found<\/h1>/);
  });

  await t.test('serves the brotli variant', async () => {
    const res = await rawRequest(baseUrl + '/style.css', { headers: { 'accept-encoding': 'br' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-encoding'], 'br');
    assert.equal(zlib.brotliDecompressSync(res.body).toString(), LARGE_TEXT);
  });

  await t.test('serves the gzip variant', async () => {
    const res = await rawRequest(baseUrl + '/style.css', { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-encoding'], 'gzip');
    assert.equal(zlib.gunzipSync(res.body).toString(), LARGE_TEXT);
  });

  await t.test('serves the original without Accept-Encoding', async () => {
    const res = await rawRequest(baseUrl + '/style.css');
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-encoding'], undefined);
    assert.match(res.headers['content-type'], /^text\/css/);
    assert.equal(res.body.toString(), LARGE_TEXT);
  });

  await t.test('sets content types for tiff, avif, and wasm', { skip: !contentTypes }, async () => {
    for (const [ file, contentType ] of [
      [ '/image.tiff', 'image/tiff' ],
      [ '/image.avif', 'image/avif' ],
      [ '/module.wasm', 'application/wasm' ],
    ]) {
      const res = await rawRequest(baseUrl + file);
      assert.equal(res.status, 200, file);
      assert.equal(res.headers['content-type'], contentType, file);
    }
  });

  await t.test('answers If-None-Match with 304 and keeps the headers', async () => {
    const full = await rawRequest(baseUrl + '/style.css');
    const etag = full.headers['etag'];
    assert.ok(etag, 'the response has an ETag');
    const res = await rawRequest(baseUrl + '/style.css', { headers: { 'if-none-match': etag } });
    assert.equal(res.status, 304);
    assert.equal(res.body.length, 0);
    assert.equal(res.headers['etag'], etag);
    assert.equal(res.headers['cache-control'], full.headers['cache-control']);
    assert.equal(res.headers['vary'], full.headers['vary']);
  });

  await t.test('answers If-Modified-Since with 304', async () => {
    const full = await rawRequest(baseUrl + '/style.css');
    const lastModified = full.headers['last-modified'];
    assert.ok(lastModified, 'the response has Last-Modified');
    const res = await rawRequest(baseUrl + '/style.css', { headers: { 'if-modified-since': lastModified } });
    assert.equal(res.status, 304);
  });

  await t.test('adds Server-Timing only when the request has the header', { skip: !serverTiming }, async () => {
    const without = await rawRequest(baseUrl + '/style.css');
    assert.equal(without.headers['server-timing'], undefined);
    const res = await rawRequest(baseUrl + '/style.css', { headers: { 'x-server-timing': '1' } });
    assert.match(res.headers['server-timing'] ?? '', /\basset;dur=/);
  });
}

// Checks the response cache. The app from writeTestAppIndex() uses the cache
// for requests that have `x-use-cache: 1`.
export async function checkResponseCache(t, baseUrl) {
  const headers = { 'x-use-cache': '1', 'x-server-timing': '1', 'accept-encoding': 'br' };

  // Use a file that no other test requests, so that the first request is a miss.
  const first = await rawRequest(baseUrl + '/cached.html', { headers: { ...headers, ...HTML } });
  assert.equal(first.status, 200);
  assert.match(first.headers['server-timing'] ?? '', /\bcache;dur=[\d.]+;desc="miss"/);

  const second = await rawRequest(baseUrl + '/cached.html', { headers: { ...headers, ...HTML } });
  assert.equal(second.status, 200);
  assert.match(second.headers['server-timing'] ?? '', /\bcache;dur=[\d.]+;desc="hit age=\d+s"/);
  assert.deepEqual(second.body, first.body);

  // A conditional request is answered from the cached response.
  const etag = second.headers['etag'];
  assert.ok(etag, 'the cached response has an ETag');
  const conditional = await rawRequest(baseUrl + '/cached.html', { headers: { ...headers, ...HTML, 'if-none-match': etag } });
  assert.equal(conditional.status, 304);
  assert.equal(conditional.headers['etag'], etag);
}
