/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { decodeAssetVariantMetadata } from '../../build/cli/models/assets/index.js';
import { parseKvStoreMetadata } from '../../build/cli/cli/storage/kv-store-provider.js';

describe('decodeAssetVariantMetadata', () => {
  test('decodes the fields', () => {
    assert.deepEqual(
      decodeAssetVariantMetadata({ contentEncoding: 'br', size: '100', hash: 'abc', numChunks: '2' }),
      { contentEncoding: 'br', size: 100, hash: 'abc', numChunks: 2 },
    );
  });

  test('reads lowercase keys (S3 metadata)', () => {
    assert.deepEqual(
      decodeAssetVariantMetadata({ size: '100', hash: 'abc', numchunks: '3' }),
      { size: 100, hash: 'abc', numChunks: 3 },
    );
  });

  test('numChunks is optional', () => {
    assert.deepEqual(decodeAssetVariantMetadata({ size: '1', hash: 'abc' }), { size: 1, hash: 'abc', numChunks: undefined });
  });

  test('gives null for metadata that is not valid', () => {
    assert.equal(decodeAssetVariantMetadata(undefined), null);
    assert.equal(decodeAssetVariantMetadata({ hash: 'abc' }), null);
    assert.equal(decodeAssetVariantMetadata({ size: '1' }), null);
    assert.equal(decodeAssetVariantMetadata({ size: '1', hash: 'abc', contentEncoding: 'deflate' }), null);
  });
});

describe('parseKvStoreMetadata', () => {
  test('converts the values to strings (metadata written by v7 has numbers)', () => {
    assert.deepEqual(
      parseKvStoreMetadata('{"size":100,"hash":"abc","numChunks":2,"flag":true,"nested":{}}'),
      { size: '100', hash: 'abc', numChunks: '2', flag: 'true' },
    );
  });

  test('gives null for metadata that is not a JSON object', () => {
    assert.equal(parseKvStoreMetadata('not json'), null);
    assert.equal(parseKvStoreMetadata('"text"'), null);
    assert.equal(parseKvStoreMetadata('[]'), null);
    assert.equal(parseKvStoreMetadata('null'), null);
  });
});
