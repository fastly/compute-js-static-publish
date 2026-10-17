/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isKvStoreConfigRc, isS3StorageConfigRc } from '../../build/cli/models/config/static-publish-rc.js';

const base = { publishId: 'default', defaultCollectionName: 'live', staticPublisherWorkingDir: './static-publisher' };

describe('isKvStoreConfigRc', () => {
  test('accepts the v8 format', () => {
    assert.equal(isKvStoreConfigRc({ ...base, storageMode: 'kv-store', kvStore: { kvStoreName: 'content' } }), true);
  });

  test('accepts the v7 format', () => {
    assert.equal(isKvStoreConfigRc({ ...base, kvStoreName: 'content' }), true);
  });

  test('rejects other configurations', () => {
    assert.equal(isKvStoreConfigRc({ ...base, storageMode: 'kv-store' }), false);
    assert.equal(isKvStoreConfigRc({ ...base, storageMode: 's3', kvStoreName: 'content' }), false);
    assert.equal(isKvStoreConfigRc(null), false);
  });
});

describe('isS3StorageConfigRc', () => {
  test('accepts a valid configuration', () => {
    assert.equal(isS3StorageConfigRc({ ...base, storageMode: 's3', s3: { region: 'us-east-1', bucket: 'b' } }), true);
    assert.equal(isS3StorageConfigRc({
      ...base,
      storageMode: 's3',
      s3: { region: 'us-east-1', bucket: 'b', endpoint: 'https://example.com', fastlyBackendName: 'storage' },
    }), true);
  });

  test('rejects other configurations', () => {
    assert.equal(isS3StorageConfigRc({ ...base, storageMode: 's3', s3: { region: 'us-east-1' } }), false);
    assert.equal(isS3StorageConfigRc({ ...base, storageMode: 's3', s3: { region: 'us-east-1', bucket: 'b', endpoint: 1 } }), false);
    assert.equal(isS3StorageConfigRc({ ...base, kvStoreName: 'content' }), false);
  });
});
