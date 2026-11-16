/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import { applyKVStoreEntriesChunks, chunkSizes } from '../../build/cli/cli/util/kv-store-items.js';
import { mockConsoleLog } from './mock-console.js';

describe('chunkSizes', () => {
  test('gives the full chunk size for all chunks but the last', () => {
    assert.deepEqual(chunkSizes(25, 10), [ 10, 10, 5 ]);
  });

  test('gives a full last chunk for an exact multiple of the chunk size', () => {
    assert.deepEqual(chunkSizes(20, 10), [ 10, 10 ]);
  });

  test('gives one chunk for a size that is not larger than the chunk size', () => {
    assert.deepEqual(chunkSizes(7, 10), [ 7 ]);
  });
});

describe('applyKVStoreEntriesChunks', () => {
  const chunkSize = 64 * 1024;

  function makeItem(t, size) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cjsp-chunks-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const filePath = path.join(dir, 'file');
    const bytes = crypto.randomBytes(size);
    fs.writeFileSync(filePath, bytes);
    return { bytes, item: { key: 'k', size, filePath, metadataJson: { hash: 'h', size: String(size), numChunks: '3' } } };
  }

  test('writes each chunk completely before it returns', async (t) => {
    mockConsoleLog(t);
    const { bytes, item } = makeItem(t, chunkSize * 2 + 100);
    const entries = [ item ];
    await applyKVStoreEntriesChunks(entries, chunkSize);

    assert.deepEqual(entries.map(entry => entry.key), [ 'k', 'k_1', 'k_2' ]);
    assert.deepEqual(entries.map(entry => fs.statSync(entry.filePath).size), [ chunkSize, chunkSize, 100 ]);
    assert.deepEqual(Buffer.concat(entries.map(entry => fs.readFileSync(entry.filePath))), bytes);
  });

  test('keeps the chunks of a file that is an exact multiple of the chunk size', async (t) => {
    const messages = mockConsoleLog(t);
    const { bytes, item } = makeItem(t, chunkSize * 2);
    await applyKVStoreEntriesChunks([ { ...item } ], chunkSize);
    const entries = [ { ...item } ];
    await applyKVStoreEntriesChunks(entries, chunkSize);

    assert.match(messages().join('\n'), /Existing chunks for 'k' look good/);
    assert.deepEqual(Buffer.concat(entries.map(entry => fs.readFileSync(entry.filePath))), bytes);
  });
});
