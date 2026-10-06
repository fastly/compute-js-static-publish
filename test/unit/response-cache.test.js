/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  acceptEncodingCacheKeyPart,
  buildCacheFillRequest,
  buildResponseCacheKey,
  decodeCachedResponseMetadata,
  encodeCachedResponseMetadata,
  parseAcceptEncodingGroups,
} from '../../build/server/server/publisher-server/response-cache.js';

function requestWith(headers) {
  return new Request('https://example.com/path', { headers });
}

describe('parseAcceptEncodingGroups', () => {
  const allowed = [ 'br', 'gzip' ];

  test('groups the allowed encodings by q value, highest first', () => {
    assert.deepEqual(parseAcceptEncodingGroups('br;q=1, gzip;q=0.5', allowed), [ [ 'br' ], [ 'gzip' ] ]);
    assert.deepEqual(parseAcceptEncodingGroups('gzip;q=0.5, br', allowed), [ [ 'br' ], [ 'gzip' ] ]);
    assert.deepEqual(parseAcceptEncodingGroups('gzip, deflate, br', allowed), [ [ 'gzip', 'br' ] ]);
  });

  test('ignores encodings that are not allowed', () => {
    assert.deepEqual(parseAcceptEncodingGroups('deflate, identity', allowed), []);
    assert.deepEqual(parseAcceptEncodingGroups('gzip, br', [ 'gzip' ]), [ [ 'gzip' ] ]);
  });

  test('gives no groups for an empty header or no allowed encodings', () => {
    assert.deepEqual(parseAcceptEncodingGroups('', allowed), []);
    assert.deepEqual(parseAcceptEncodingGroups('br', []), []);
  });

  test('limits q values to the range 0 to 1', () => {
    assert.deepEqual(parseAcceptEncodingGroups('br;q=5, gzip;q=1', allowed), [ [ 'br', 'gzip' ] ]);
    assert.deepEqual(parseAcceptEncodingGroups('br;q=-1, gzip;q=0.1', allowed), [ [ 'gzip' ], [ 'br' ] ]);
  });
});

describe('acceptEncodingCacheKeyPart', () => {
  test('normalizes the order in a group', () => {
    assert.equal(acceptEncodingCacheKeyPart(requestWith({ 'accept-encoding': 'gzip, deflate, br' })), 'br+gzip');
    assert.equal(acceptEncodingCacheKeyPart(requestWith({ 'accept-encoding': 'br, gzip' })), 'br+gzip');
  });

  test('keeps the priority between groups', () => {
    assert.equal(acceptEncodingCacheKeyPart(requestWith({ 'accept-encoding': 'gzip;q=0.5, br' })), 'br>gzip');
  });

  test('gives identity when no encoding is accepted', () => {
    assert.equal(acceptEncodingCacheKeyPart(requestWith({})), 'identity');
    assert.equal(acceptEncodingCacheKeyPart(requestWith({ 'accept-encoding': 'deflate' })), 'identity');
  });
});

test('buildResponseCacheKey has the publish ID, collection, encodings, and path', () => {
  const key = buildResponseCacheKey('default', 'live', '/index.html', requestWith({ 'accept-encoding': 'br' }));
  assert.equal(key, 'default_response_live_br_/index.html');
});

test('buildCacheFillRequest removes conditional headers and uses GET', () => {
  const request = new Request('https://example.com/a', {
    method: 'HEAD',
    headers: {
      'if-none-match': '"abc"',
      'if-modified-since': 'Wed, 21 Oct 2015 07:28:00 GMT',
      'if-match': '"abc"',
      'if-unmodified-since': 'Wed, 21 Oct 2015 07:28:00 GMT',
      'if-range': '"abc"',
      'range': 'bytes=0-10',
      'accept-encoding': 'br',
    },
  });
  const fill = buildCacheFillRequest(request);
  assert.equal(fill.method, 'GET');
  assert.equal(fill.url, 'https://example.com/a');
  assert.deepEqual([ ...fill.headers.keys() ], [ 'accept-encoding' ]);
});

describe('cached response metadata', () => {
  function roundTrip(metadata) {
    return decodeCachedResponseMetadata(new TextEncoder().encode(encodeCachedResponseMetadata(metadata)).buffer);
  }

  test('round-trips a response', () => {
    const metadata = { status: 200, headers: [ [ 'content-type', 'text/html' ] ] };
    assert.deepEqual(roundTrip(metadata), metadata);
  });

  test('round-trips a not found result', () => {
    assert.deepEqual(roundTrip({ notFound: true }), { notFound: true });
  });

  test('gives null for data that is not valid', () => {
    assert.equal(decodeCachedResponseMetadata(new TextEncoder().encode('not json').buffer), null);
    assert.equal(decodeCachedResponseMetadata(new TextEncoder().encode('{"status":"200"}').buffer), null);
  });
});
