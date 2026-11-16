/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getStorageKeysByHexPrefix, isVariantInStorage } from '../../build/cli/cli/storage/storage-provider.js';
import { chunkSizes } from '../../build/cli/cli/util/kv-store-items.js';
import { mockConsoleLog } from './mock-console.js';

function fakeProvider(keys, { failPrefixes = [] } = {}) {
  const prefixes = [];
  return {
    prefixes,
    async getStorageKeys(prefix) {
      prefixes.push(prefix);
      if (failPrefixes === 'all' || failPrefixes.includes(prefix)) {
        return null;
      }
      return keys.filter(key => key.startsWith(prefix));
    },
  };
}

test('lists the keys in 16 parts, one for each hex digit', async () => {
  const keys = [ 'p_0aa', 'p_5bb', 'p_fcc', 'q_0dd' ];
  const provider = fakeProvider(keys);
  const result = await getStorageKeysByHexPrefix(provider, 'p_');
  assert.deepEqual(result.sort(), [ 'p_0aa', 'p_5bb', 'p_fcc' ]);
  assert.deepEqual(provider.prefixes.sort(), '0123456789abcdef'.split('').map(digit => 'p_' + digit));
});

test('gives null only if all the listings give null', async () => {
  assert.equal(await getStorageKeysByHexPrefix(fakeProvider([], { failPrefixes: 'all' }), 'p_'), null);
  assert.deepEqual(await getStorageKeysByHexPrefix(fakeProvider([ 'p_1a' ], { failPrefixes: [ 'p_0' ] }), 'p_'), [ 'p_1a' ]);
});

// A provider with chunks of 10 bytes. storedSizes maps a key to the size that
// getStorageEntryInfo() gives for it.
function fakeChunkProvider(storedSizes) {
  const infoKeys = [];
  return {
    infoKeys,
    calculateChunkSizes: (size) => chunkSizes(size, 10),
    async getStorageEntryInfo(key) {
      infoKeys.push(key);
      return key in storedSizes ? { size: storedSizes[key] } : null;
    },
  };
}

test('isVariantInStorage: a variant in one chunk is found by its key only', async () => {
  const provider = fakeChunkProvider({});
  assert.equal(await isVariantInStorage(provider, new Set([ 'v' ]), 'v', 5, 1), true);
  assert.equal(await isVariantInStorage(provider, new Set([ 'w' ]), 'v', 5, 1), false);
  assert.deepEqual(provider.infoKeys, []);
});

test('isVariantInStorage: a chunked variant needs all its keys', async () => {
  const provider = fakeChunkProvider({});
  assert.equal(await isVariantInStorage(provider, new Set([ 'v', 'v_1' ]), 'v', 25, 3), false);
  assert.deepEqual(provider.infoKeys, []);
});

test('isVariantInStorage: a chunked variant is found if each chunk has its size', async () => {
  const provider = fakeChunkProvider({ v: 10, v_1: 10, v_2: 5 });
  assert.equal(await isVariantInStorage(provider, new Set([ 'v', 'v_1', 'v_2' ]), 'v', 25, 3), true);
  assert.deepEqual(provider.infoKeys.sort(), [ 'v', 'v_1', 'v_2' ]);
});

test('isVariantInStorage: removes a chunk that has a different size from existingKeys', async (t) => {
  const messages = mockConsoleLog(t);
  const provider = fakeChunkProvider({ v: 10, v_1: 7, v_2: 5 });
  const existingKeys = new Set([ 'v', 'v_1', 'v_2' ]);
  assert.equal(await isVariantInStorage(provider, existingKeys, 'v', 25, 3), false);
  assert.deepEqual([ ...existingKeys ].sort(), [ 'v', 'v_2' ]);
  assert.match(messages().join('\n'), /Chunk "v_1" in storage has 7 bytes, but it must have 10 bytes/);
});

test('isVariantInStorage: removes a chunk that is not in storage now from existingKeys', async () => {
  const provider = fakeChunkProvider({ v: 10 });
  const existingKeys = new Set([ 'v', 'v_1' ]);
  assert.equal(await isVariantInStorage(provider, existingKeys, 'v', 20, 2), false);
  assert.deepEqual([ ...existingKeys ], [ 'v' ]);
});

test('isVariantInStorage: a chunk with no stored size is found', async () => {
  const provider = fakeChunkProvider({ v: 10 });
  provider.getStorageEntryInfo = async () => ({});
  assert.equal(await isVariantInStorage(provider, new Set([ 'v', 'v_1' ]), 'v', 20, 2), true);
});
