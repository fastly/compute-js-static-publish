/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { CookieCollectionSelector } from '../../build/server/server/collection-selector/from-cookie.js';

const selector = new CookieCollectionSelector();

function activate(query) {
  return selector.applySelector(new Request(`https://example.com/activate?${query}`));
}

function reset(query) {
  return selector.applySelector(new Request(`https://example.com/reset?${query}`));
}

describe('CookieCollectionSelector redirectTo', () => {
  test('keeps a path on the same site', () => {
    for (const [ value, expected ] of [
      [ '/', '/' ],
      [ '/docs/', '/docs/' ],
      [ '/docs/page?x=1#top', '/docs/page?x=1#top' ],
    ]) {
      assert.equal(activate(`collection=pr-42&redirectTo=${encodeURIComponent(value)}`).headers.get('Location'), expected, value);
      assert.equal(reset(`redirectTo=${encodeURIComponent(value)}`).headers.get('Location'), expected, value);
    }
  });

  test('uses / for a target that is not a path on the same site', () => {
    for (const value of [
      'https://evil.example/',
      'http://example.com.evil.example/',
      '//evil.example/',
      '/\\evil.example/',
      '/\t/evil.example/',
      '/\n/evil.example/',
      'javascript:alert(1)',
      'evil.example',
      '',
    ]) {
      assert.equal(activate(`collection=pr-42&redirectTo=${encodeURIComponent(value)}`).headers.get('Location'), '/', JSON.stringify(value));
      assert.equal(reset(`redirectTo=${encodeURIComponent(value)}`).headers.get('Location'), '/', JSON.stringify(value));
    }
  });

  test('uses / when there is no redirectTo', () => {
    assert.equal(activate('collection=pr-42').headers.get('Location'), '/');
    assert.equal(reset('').headers.get('Location'), '/');
  });
});

describe('CookieCollectionSelector collection value', () => {
  test('sets the cookie for a valid collection name', () => {
    for (const name of [ 'pr-42', 'live', 'a' ]) {
      const response = activate(`collection=${encodeURIComponent(name)}`);
      assert.equal(response.status, 302, name);
      assert.match(response.headers.get('Set-Cookie'), new RegExp(`^publisher-collection=${name};`), name);
    }
  });

  test('sets no cookie for a value with characters that are not allowed in a cookie', () => {
    for (const name of [ 'a;Domain=example.org', 'a b', 'a,b', 'a"b', 'a\\b', 'a\tb' ]) {
      const response = activate(`collection=${encodeURIComponent(name)}`);
      assert.equal(response.status, 400, JSON.stringify(name));
      assert.equal(response.headers.get('Set-Cookie'), null, JSON.stringify(name));
    }
  });

  test('sets no cookie for a value that is not a valid collection name', () => {
    for (const name of [ 'feature_x', 'Live', '-a', 'a'.repeat(64) ]) {
      const response = activate(`collection=${encodeURIComponent(name)}`);
      assert.equal(response.status, 400, name);
      assert.equal(response.headers.get('Set-Cookie'), null, name);
    }
  });
});
