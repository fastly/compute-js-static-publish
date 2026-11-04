/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isValidCollectionName } from '../../build/cli/models/collections/index.js';
import { CookieCollectionSelector } from '../../build/server/server/collection-selector/from-cookie.js';

describe('isValidCollectionName', () => {
  test('accepts DNS labels', () => {
    for (const name of [ 'live', 'staging', 'pr-42', 'a', '0', 'a-b-c', 'a'.repeat(63), `a${'-'.repeat(61)}a` ]) {
      assert.equal(isValidCollectionName(name), true, name);
    }
  });

  test('refuses names that are not DNS labels', () => {
    for (const name of [ '', 'a'.repeat(64), '-a', 'a-', '-', 'Live', 'PR-42', 'feature_x', 'v1.2', 'a/b', 'é' ]) {
      assert.equal(isValidCollectionName(name), false, JSON.stringify(name));
    }
  });

  test('refuses each character that breaks a cookie', () => {
    const controls = Array.from({ length: 0x20 }, (_, i) => String.fromCharCode(i)).concat('\x7f');
    for (const ch of [ ';', ',', '=', ' ', '\t', '"', "'", '\\', ...controls ]) {
      assert.equal(isValidCollectionName(`a${ch}b`), false, JSON.stringify(ch));
    }
  });
});

describe('CookieCollectionSelector', () => {
  const selector = new CookieCollectionSelector();

  test('sets the cookie for a valid name', () => {
    const response = selector.applySelector(new Request('https://example.com/activate?collection=pr-42'));
    assert.equal(response.status, 302);
    assert.match(response.headers.get('Set-Cookie'), /^publisher-collection=pr-42;/);
  });

  test('sets no cookie for a name that is not valid', () => {
    for (const name of [ 'feature_x', 'a;Domain=example.org', 'a b' ]) {
      const url = `https://example.com/activate?collection=${encodeURIComponent(name)}`;
      const response = selector.applySelector(new Request(url));
      assert.equal(response.status, 400, name);
      assert.equal(response.headers.get('Set-Cookie'), null, name);
    }
  });
});
