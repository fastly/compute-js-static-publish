/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveServeStaticPathname } from '../../build/server/hono/path.js';

const c = {};

test('uses the request path with the default root', () => {
  assert.equal(resolveServeStaticPathname('/docs/index.html', c, {}), '/docs/index.html');
  assert.equal(resolveServeStaticPathname('/', c, {}), '/');
});

test('resolves the request path against root', () => {
  assert.equal(resolveServeStaticPathname('/a.html', c, { root: 'docs' }), '/docs/a.html');
  assert.equal(resolveServeStaticPathname('/a.html', c, { root: './docs/' }), '/docs/a.html');
});

test('uses path in place of the request path', () => {
  assert.equal(resolveServeStaticPathname('/anything', c, { path: './favicon.ico' }), '/favicon.ico');
  assert.equal(resolveServeStaticPathname('/anything', c, { path: '/favicon.ico', root: 'img' }), '/img/favicon.ico');
});

test('rewrites the request path before root', () => {
  const options = { root: 'docs', rewriteRequestPath: (path, ctx) => {
    assert.equal(ctx, c);
    return path.replace(/^\/assets/, '');
  } };
  assert.equal(resolveServeStaticPathname('/assets/a.html', c, options), '/docs/a.html');
});

test('does not resolve a path outside the root', () => {
  assert.equal(resolveServeStaticPathname('/../secret.html', c, { root: 'docs' }), null);
  assert.equal(resolveServeStaticPathname('/a/../../secret.html', c, { root: 'docs' }), null);
  assert.equal(resolveServeStaticPathname('/a/../b.html', c, { root: 'docs' }), '/docs/b.html');
});

test('returns a decoded path', () => {
  assert.equal(resolveServeStaticPathname('/a b/ü.html', c, {}), '/a b/ü.html');
});

test('keeps %, ?, and # in a segment', () => {
  assert.equal(resolveServeStaticPathname('/100%.html', c, {}), '/100%.html');
  assert.equal(resolveServeStaticPathname('/a?b/c#d.html', c, { root: 'x y' }), '/x y/a?b/c#d.html');
});
