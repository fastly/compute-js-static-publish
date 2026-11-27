/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import type { AssetEntryMap } from '../assets/index.js';

// Index parts: publish-content splits a large index into parts, and stores each
// part in its own entry. Then the server reads and parses only the part that
// has the asset key of a request, not the whole index. The full index is still
// stored, and an index part is only a copy of some of its entries. Thus a
// server that does not know index parts serves the same content.
//
// The key of a part is
//   <publishId>_parts_<hash>_<count>_<number>
// where <hash> is the SHA-256 (hex) of the text of the full index, <count> is
// the number of parts, and <number> is from 0 to <count> - 1. The key does not
// have the collection name, so a promote that copies the index metadata to
// another collection points to the same parts. The prefix is not '_index_' or
// '_files_', so that an older 'clean' does not read or delete the parts.
//
// The metadata of the full index has the field 'indexParts', with the value
// '<count>:<hash>'.
//
// The part of an asset key comes from getIndexPartNumber(). The CLI and the
// server must give the same result, so do not change this function. To use a
// different function, use a different metadata field.

export type IndexPartsInfo = {
  count: number,
  hash: string,
};

// Indexes with fewer entries than this are not split. Such an index is small
// enough to parse on each request.
export const INDEX_PARTS_MIN_ENTRIES = 2000;

// The target number of entries in one part.
export const INDEX_PARTS_ENTRIES_PER_PART = 400;

// The largest number of parts.
export const INDEX_PARTS_MAX_COUNT = 1024;

export function getIndexPartsPrefix(publishId: string) {
  return `${publishId}_parts_`;
}

// The prefix of the keys of all parts of one index.
export function getIndexPartsSetPrefix(publishId: string, info: IndexPartsInfo) {
  return `${getIndexPartsPrefix(publishId)}${info.hash}_${info.count}_`;
}

export function getIndexPartKey(publishId: string, info: IndexPartsInfo, partNumber: number) {
  return `${getIndexPartsSetPrefix(publishId, info)}${partNumber}`;
}

// Gets the hash and the count from a key that starts with getIndexPartsPrefix(),
// or null if the key does not have this format.
export function parseIndexPartKey(publishId: string, key: string): (IndexPartsInfo & { partNumber: number }) | null {
  const prefix = getIndexPartsPrefix(publishId);
  if (!key.startsWith(prefix)) {
    return null;
  }
  const match = /^([0-9a-f]{64})_(\d+)_(\d+)$/.exec(key.slice(prefix.length));
  if (match == null) {
    return null;
  }
  return { hash: match[1], count: Number(match[2]), partNumber: Number(match[3]) };
}

// The number of parts for an index with entryCount entries, or 0 if the index
// is not split.
export function chooseIndexPartCount(entryCount: number) {
  if (entryCount < INDEX_PARTS_MIN_ENTRIES) {
    return 0;
  }
  return Math.min(INDEX_PARTS_MAX_COUNT, Math.ceil(entryCount / INDEX_PARTS_ENTRIES_PER_PART));
}

// The part that has assetKey: FNV-1a (32 bits) of the UTF-16 code units of
// assetKey, modulo count.
export function getIndexPartNumber(assetKey: string, count: number) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < assetKey.length; i++) {
    hash ^= assetKey.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % count;
}

export function splitAssetEntryMap(assetEntryMap: AssetEntryMap, count: number): AssetEntryMap[] {
  const parts: AssetEntryMap[] = Array.from({ length: count }, () => ({}));
  for (const [ assetKey, assetEntry ] of Object.entries(assetEntryMap)) {
    parts[getIndexPartNumber(assetKey, count)][assetKey] = assetEntry;
  }
  return parts;
}

export function encodeIndexPartsInfo(info: IndexPartsInfo) {
  return `${info.count}:${info.hash}`;
}

export function decodeIndexPartsInfo(value: string | undefined | null): IndexPartsInfo | null {
  if (value == null) {
    return null;
  }
  const match = /^(\d+):([0-9a-f]{64})$/.exec(String(value).trim());
  if (match == null) {
    return null;
  }
  const count = Number(match[1]);
  if (count < 1 || count > INDEX_PARTS_MAX_COUNT) {
    return null;
  }
  return { count, hash: match[2] };
}
