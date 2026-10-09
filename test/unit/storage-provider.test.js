/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getStorageKeysByHexPrefix } from '../../build/cli/cli/storage/storage-provider.js';

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
