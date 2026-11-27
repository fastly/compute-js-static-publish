/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  chooseIndexPartCount,
  decodeIndexPartsInfo,
  encodeIndexPartsInfo,
  getIndexPartKey,
  getIndexPartNumber,
  getIndexPartsSetPrefix,
  INDEX_PARTS_MAX_COUNT,
  INDEX_PARTS_MIN_ENTRIES,
  parseIndexPartKey,
  splitAssetEntryMap,
} from '../../build/cli/models/index-parts/index.js';
import * as serverIndexParts from '../../build/server/models/index-parts/index.js';
import { decodeIndexMetadata, encodeIndexMetadata } from '../../build/cli/models/server/index.js';

const HASH = 'a'.repeat(64);

describe('getIndexPartNumber', () => {
  // The CLI and the servers that are deployed must give the same part for a
  // key. These values come from a separate implementation of FNV-1a.
  test('gives the stored part numbers', () => {
    assert.equal(getIndexPartNumber('/index.html', 64), 49);
    assert.equal(getIndexPartNumber('/docs/a/index.html', 64), 61);
    assert.equal(getIndexPartNumber('/0b7b90cd-b1af63b420408a1a6187.js', 64), 35);
    assert.equal(getIndexPartNumber('/日本語.html', 64), 2);
  });

  test('the server build gives the same numbers as the CLI build', () => {
    for (const key of [ '/index.html', '/a/b/c.css', '/日本語.html' ]) {
      for (const count of [ 1, 7, 64, 1024 ]) {
        assert.equal(serverIndexParts.getIndexPartNumber(key, count), getIndexPartNumber(key, count));
      }
    }
  });
});

describe('chooseIndexPartCount', () => {
  test('does not split a small index', () => {
    assert.equal(chooseIndexPartCount(0), 0);
    assert.equal(chooseIndexPartCount(INDEX_PARTS_MIN_ENTRIES - 1), 0);
  });

  test('uses about 400 entries for each part', () => {
    assert.equal(chooseIndexPartCount(INDEX_PARTS_MIN_ENTRIES), 5);
    assert.equal(chooseIndexPartCount(25559), 64);
  });

  test('has a maximum', () => {
    assert.equal(chooseIndexPartCount(10_000_000), INDEX_PARTS_MAX_COUNT);
  });
});

describe('splitAssetEntryMap', () => {
  test('puts each entry in its part, and keeps all entries', () => {
    const map = {};
    for (let i = 0; i < 1000; i++) {
      map[`/page-${i}.html`] = { key: `sha256:${i}`, size: i, contentType: 'text/html', lastModifiedTime: 0, variants: [] };
    }
    const parts = splitAssetEntryMap(map, 16);
    assert.equal(parts.length, 16);
    let total = 0;
    parts.forEach((part, partNumber) => {
      for (const [ key, entry ] of Object.entries(part)) {
        assert.equal(getIndexPartNumber(key, 16), partNumber);
        assert.deepEqual(entry, map[key]);
        total++;
      }
    });
    assert.equal(total, 1000);
  });
});

describe('index part keys', () => {
  test('makes and parses a key', () => {
    const info = { count: 64, hash: HASH };
    const key = getIndexPartKey('default', info, 12);
    assert.equal(key, `default_parts_${HASH}_64_12`);
    assert.ok(key.startsWith(getIndexPartsSetPrefix('default', info)));
    assert.deepEqual(parseIndexPartKey('default', key), { hash: HASH, count: 64, partNumber: 12 });
  });

  test('does not use the prefixes that older versions of clean read', () => {
    const key = getIndexPartKey('default', { count: 64, hash: HASH }, 0);
    assert.ok(!key.startsWith('default_index_'));
    assert.ok(!key.startsWith('default_files_'));
    assert.ok(!key.startsWith('default_settings_'));
  });

  test('does not parse a key with another format', () => {
    assert.equal(parseIndexPartKey('default', `default_parts_${HASH}_64`), null);
    assert.equal(parseIndexPartKey('default', `default_parts_xyz_64_1`), null);
    assert.equal(parseIndexPartKey('other', getIndexPartKey('default', { count: 1, hash: HASH }, 0)), null);
  });
});

describe('index parts metadata', () => {
  test('encodes and decodes', () => {
    assert.equal(encodeIndexPartsInfo({ count: 64, hash: HASH }), `64:${HASH}`);
    assert.deepEqual(decodeIndexPartsInfo(`64:${HASH}`), { count: 64, hash: HASH });
  });

  test('ignores a value that is not valid', () => {
    assert.equal(decodeIndexPartsInfo(undefined), null);
    assert.equal(decodeIndexPartsInfo(`0:${HASH}`), null);
    assert.equal(decodeIndexPartsInfo(`${INDEX_PARTS_MAX_COUNT + 1}:${HASH}`), null);
    assert.equal(decodeIndexPartsInfo(`64:abc`), null);
    assert.equal(decodeIndexPartsInfo('64'), null);
  });

  test('is a field of the index metadata', () => {
    const encoded = encodeIndexMetadata({ publishedTime: 1, indexParts: { count: 64, hash: HASH } });
    assert.equal(encoded.indexParts, `64:${HASH}`);
    assert.deepEqual(decodeIndexMetadata(encoded).indexParts, { count: 64, hash: HASH });
  });

  test('reads the lowercase key of S3 metadata', () => {
    assert.deepEqual(decodeIndexMetadata({ indexparts: `64:${HASH}` }).indexParts, { count: 64, hash: HASH });
  });

  test('an older CLI keeps the field as an unknown field', () => {
    // An older CLI does not know indexParts, so it keeps it in otherFields,
    // and writes it again unchanged (for example in collections promote).
    const encoded = encodeIndexMetadata({ publishedTime: 1, otherFields: { indexParts: `64:${HASH}` } });
    assert.deepEqual(decodeIndexMetadata(encoded).indexParts, { count: 64, hash: HASH });
  });
});
