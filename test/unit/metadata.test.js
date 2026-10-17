/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { decodeAssetVariantMetadata } from '../../build/cli/models/assets/index.js';
import { parseKvStoreMetadata } from '../../build/cli/cli/storage/kv-store-provider.js';
import {
  decodeIndexMetadata,
  encodeIndexMetadata,
  getUnsupportedIndexFeatures,
  SUPPORTED_INDEX_FEATURES,
} from '../../build/cli/models/server/index.js';

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

describe('decodeIndexMetadata and encodeIndexMetadata', () => {
  test('decode the fields', () => {
    assert.deepEqual(
      decodeIndexMetadata({ publishedTime: '100', expirationTime: '200', requires: 'a, b,,c' }),
      { publishedTime: 100, expirationTime: 200, requires: [ 'a', 'b', 'c' ], otherFields: undefined },
    );
  });

  test('read lowercase keys (S3 metadata)', () => {
    assert.deepEqual(
      decodeIndexMetadata({ publishedtime: '100', expirationtime: '200', requires: 'a' }),
      { publishedTime: 100, expirationTime: 200, requires: [ 'a' ], otherFields: undefined },
    );
  });

  test('an empty requires is the same as no requires', () => {
    assert.equal(decodeIndexMetadata({ requires: '' }).requires, undefined);
    assert.deepEqual(encodeIndexMetadata({ publishedTime: 100, requires: [] }), { publishedTime: '100' });
  });

  test('keep the fields that this version does not know', () => {
    const decoded = decodeIndexMetadata({ publishedTime: '100', requires: 'a', newField: 'x', newfield2: 'y' });
    assert.deepEqual(decoded.otherFields, { newField: 'x', newfield2: 'y' });
    assert.deepEqual(
      encodeIndexMetadata(decoded),
      { publishedTime: '100', requires: 'a', newField: 'x', newfield2: 'y' },
    );
  });

  test('a known field replaces an unknown field with the same name', () => {
    assert.deepEqual(
      encodeIndexMetadata({ publishedTime: 100, otherFields: { publishedTime: '1' } }),
      { publishedTime: '100' },
    );
  });

  test('gives null for no metadata', () => {
    assert.equal(decodeIndexMetadata(undefined), null);
  });

  test('encode separates the features with commas', () => {
    assert.deepEqual(
      encodeIndexMetadata({ requires: [ 'hidden', 'brotli-dictionary' ] }),
      { requires: 'hidden,brotli-dictionary' },
    );
  });

  test('encode throws if a feature name contains a comma', () => {
    assert.throws(() => encodeIndexMetadata({ requires: [ 'a,b' ] }), /must not contain a comma/);
  });
});

describe('getUnsupportedIndexFeatures', () => {
  test('this version supports hidden files', () => {
    assert.deepEqual(SUPPORTED_INDEX_FEATURES, [ 'hidden' ]);
    assert.deepEqual(getUnsupportedIndexFeatures({ requires: [ 'hidden' ] }), []);
    assert.deepEqual(getUnsupportedIndexFeatures({ requires: [ 'hidden', 'future-feature' ] }), [ 'future-feature' ]);
  });

  test('a server without hidden does not serve a collection that requires it', () => {
    assert.deepEqual(getUnsupportedIndexFeatures({ requires: [ 'hidden' ] }, []), [ 'hidden' ]);
  });

  test('gives the features that are not supported', () => {
    assert.deepEqual(getUnsupportedIndexFeatures({ requires: [ 'a', 'b' ] }, [ 'a' ]), [ 'b' ]);
    assert.deepEqual(getUnsupportedIndexFeatures({ requires: [ 'a' ] }, [ 'a' ]), []);
  });

  test('gives an empty list if requires is not set', () => {
    assert.deepEqual(getUnsupportedIndexFeatures({}), []);
  });
});
