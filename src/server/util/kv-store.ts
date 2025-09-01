/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

/// <reference types="@fastly/js-compute" />
import { KVStore, type KVStoreEntry } from 'fastly:kv-store';
import { decodeAssetVariantMetadata } from '../../models/assets/index.js';
import { concatReadableStreams, StorageEntryImpl } from '../storage/storage-provider.js';

export async function getKVStoreEntry(
  kvStore: KVStore,
  key: string,
): Promise<KVStoreEntry | null> {

  const entry = await kvStore.get(key);
  if (entry == null) {
    return null;
  }

  const metadataText = entry.metadataText() ?? '';
  if (metadataText === '') {
    return entry;
  }

  let metadata;
  try {
    metadata = JSON.parse(metadataText);
  } catch {
    return entry;
  }

  metadata = decodeAssetVariantMetadata(metadata);
  if (metadata == null || metadata.numChunks == null || metadata.numChunks < 2) {
    return entry;
  }

  const streams = [
    entry.body,
  ];

  for (let chunkIndex = 1; chunkIndex < metadata.numChunks; chunkIndex++) {
    const chunkKey = `${key}_${chunkIndex}`;
    const chunkEntry = await kvStore.get(chunkKey);
    if (chunkEntry == null) {
      throw new Error(`Missing chunk ${chunkKey}`);
    }
    streams.push(chunkEntry?.body);
  }

  const combinedStream = concatReadableStreams(streams);

  return new StorageEntryImpl(combinedStream, metadataText);
}
