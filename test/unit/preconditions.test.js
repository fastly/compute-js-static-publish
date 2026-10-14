/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  checkIfModifiedSince,
  getIfModifiedSinceHeader,
} from '../../build/server/server/publisher-server/serve-preconditions/if-modified-since.js';
import {
  checkIfNoneMatch,
  getIfNoneMatchHeader,
} from '../../build/server/server/publisher-server/serve-preconditions/if-none-match.js';

function requestWith(headers) {
  return new Request('https://example.com/', { headers });
}

describe('If-None-Match', () => {
  test('parses a list of entity tags', () => {
    assert.deepEqual(getIfNoneMatchHeader(requestWith({ 'if-none-match': '"a", "b" ,"c"' })), [ '"a"', '"b"', '"c"' ]);
    assert.deepEqual(getIfNoneMatchHeader(requestWith({})), []);
  });

  test('the condition is false if a tag matches, or for *', () => {
    assert.equal(checkIfNoneMatch('"b"', [ '"a"', '"b"' ]), false);
    assert.equal(checkIfNoneMatch('"b"', [ '*' ]), false);
  });

  test('the condition is true if no tag matches', () => {
    assert.equal(checkIfNoneMatch('"c"', [ '"a"', '"b"' ]), true);
    assert.equal(checkIfNoneMatch('"c"', []), true);
  });
});

describe('If-Modified-Since', () => {
  test('parses an HTTP date into seconds', () => {
    assert.equal(getIfModifiedSinceHeader(requestWith({ 'if-modified-since': 'Wed, 21 Oct 2015 07:28:00 GMT' })), 1445412480);
  });

  test('ignores a value that is not a date', () => {
    assert.equal(getIfModifiedSinceHeader(requestWith({ 'if-modified-since': 'yesterday' })), null);
    assert.equal(getIfModifiedSinceHeader(requestWith({})), null);
  });

  test('the condition is true only if the file is newer', () => {
    assert.equal(checkIfModifiedSince(1000, 999), true);
    assert.equal(checkIfModifiedSince(1000, 1000), false);
    assert.equal(checkIfModifiedSince(1000, 1001), false);
  });
});
