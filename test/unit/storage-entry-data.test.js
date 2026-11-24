/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { storageEntryDataToBytes } from '../../build/cli/cli/storage/storage-provider.js';
import { KvStoreProvider } from '../../build/cli/cli/storage/kv-store-provider.js';

describe('storageEntryDataToBytes', () => {
  test('reads a stream into bytes', async () => {
    const bytes = await storageEntryDataToBytes(new Response('{"a":1}').body);
    assert.ok(bytes instanceof Uint8Array);
    assert.equal(new TextDecoder().decode(bytes), '{"a":1}');
  });

  test('encodes a string as UTF-8', async () => {
    assert.deepEqual(await storageEntryDataToBytes('é'), new Uint8Array([ 0xc3, 0xa9 ]));
  });

  test('gives the same bytes for a Uint8Array', async () => {
    const data = new Uint8Array([ 1, 2, 3 ]);
    assert.equal(await storageEntryDataToBytes(data), data);
  });

  test('gives no bytes for null or undefined', async () => {
    assert.equal((await storageEntryDataToBytes(null)).length, 0);
    assert.equal((await storageEntryDataToBytes(undefined)).length, 0);
  });
});

describe('KvStoreProvider.submitStorageEntry', () => {
  test('uploads the bytes of a stream with a PUT', async (t) => {
    const puts = [];
    t.mock.method(globalThis, 'fetch', async (request) => {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/resources/stores/kv') {
        return Response.json({ data: [ { id: 'store-id', name: 'store' } ], meta: {} });
      }
      puts.push({ request, body: await request.text() });
      return new Response('');
    });

    const provider = new KvStoreProvider('store', 'token-for-unit-test');
    await provider.submitStorageEntry('default_index_live', '/unused', new Response('{"/a.txt":{}}').body, { publishedTime: '1' });

    assert.equal(puts.length, 1);
    const [ { request, body } ] = puts;
    assert.equal(request.method, 'PUT');
    assert.equal(new URL(request.url).pathname, '/resources/stores/kv/store-id/keys/default_index_live');
    assert.equal(request.headers.get('metadata'), '{"publishedTime":"1"}');
    assert.equal(body, '{"/a.txt":{}}');
  });
});
