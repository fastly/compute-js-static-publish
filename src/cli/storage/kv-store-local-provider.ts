/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  type AssetVariantMetadata,
} from '../../models/assets/index.js';
import {
  type StaticPublishRc,
  isKvStoreConfigRc,
} from '../../models/config/static-publish-rc.js';
import {
  getKvStoreConfigFromRc,
} from '../../models/config/kv-store-config.js';
import {
  applyKVStoreEntriesChunks,
  KV_STORE_CHUNK_SIZE,
} from '../util/kv-store-items.js';
import {
  getLocalKvStoreEntry,
  getLocalKVStoreKeys,
  localKvStoreDeleteEntry,
  localKvStoreSubmitEntry,
  writeKVStoreEntriesForLocal,
} from '../util/kv-store-local-server.js';
import { concurrentParallel } from '../util/retryable.js';
import {
  type StorageEntry,
  type StorageProvider,
  type StorageProviderBuilder,
  type StorageProviderBuilderContext,
  type StorageProviderBatch,
} from './storage-provider.js';
import {
  kvStoreEntryToStorageEntry,
} from './kv-store-provider.js';

export const buildStoreProvider: StorageProviderBuilder = (
  config: StaticPublishRc,
  context: StorageProviderBuilderContext,
) => {
  if (isKvStoreConfigRc(config) && context.localMode) {
    console.log(`  Working on local simulated KV Store...`);
  } else {
    return null;
  }

  const { kvStoreName } = getKvStoreConfigFromRc(config);
  console.log(`  | Using KV Store: ${kvStoreName}`);

  const storeFile = path.resolve(config.staticPublisherWorkingDir, `./kvstore.json`);
  return new KvStoreLocalProvider(
    storeFile,
    context.computeAppDir,
  );
};

export class KvStoreLocalProvider implements StorageProvider {
  constructor(
    storeFile: string,
    computeAppDir: string,
  ) {
    this.storeFile = storeFile;
    this.computeAppDir = computeAppDir;
  }

  readonly storeFile: string;
  readonly computeAppDir: string;

  async getStorageKeys(prefix?: string): Promise<string[] | null> {

    return await getLocalKVStoreKeys(
      this.storeFile,
      prefix
    );
  }

  async getStorageEntry(key: string): Promise<StorageEntry | null> {

    const kvStoreEntry = await getLocalKvStoreEntry(
      this.storeFile,
      key,
    );

    if (kvStoreEntry == null) {
      return null;
    }

    return kvStoreEntryToStorageEntry(kvStoreEntry);
  }

  async getStorageEntryInfo(key: string): Promise<StorageEntry | null> {

    const kvStoreEntry = await getLocalKvStoreEntry(
      this.storeFile,
      key,
      true,
    );

    if (kvStoreEntry == null) {
      return null;
    }

    return kvStoreEntryToStorageEntry(kvStoreEntry);
  }

  async submitStorageEntry(
    key: string,
    filePath: string,
    data: ReadableStream<Uint8Array> | Uint8Array | string | null | undefined,
    metadata?: Record<string, string>,
  ): Promise<void> {

    let fileData;
    if (data == null) {
      fileData = new Uint8Array(0);
    } else if (data instanceof ReadableStream) {
      fileData = Buffer.from(await new Response(data).arrayBuffer());
    } else if (typeof data === 'string') {
      fileData = new TextEncoder().encode(data);
    } else {
      fileData = data;
    }
    fs.writeFileSync(filePath, fileData);

    await localKvStoreSubmitEntry(
      this.storeFile,
      key,
      path.relative(this.computeAppDir, filePath),
      metadata != null ? JSON.stringify(metadata) : undefined,
    );
  }

  async deleteStorageEntry(key: string): Promise<void> {

    await localKvStoreDeleteEntry(
      this.storeFile,
      key,
    );

  }

  async applyBatch(batch: StorageProviderBatch): Promise<void> {

    console.log(`🍪 Chunking large files...`);
    await applyKVStoreEntriesChunks(
      batch.storageProviderBatchEntries,
      KV_STORE_CHUNK_SIZE,
    );
    console.log(`✅  Large files have been chunked.`);

    console.log(`📝 Writing local server KV Store entries.`);
    writeKVStoreEntriesForLocal(
      this.storeFile,
      this.computeAppDir,
      batch.storageProviderBatchEntries
    );
    console.log(`✅  Wrote KV Store entries for local server.`);

  }

  async doConcurrentParallel<TObject extends { key: string }>(
    objects: TObject[],
    fn: (obj: TObject, key: string, index: number) => Promise<void>,
    maxConcurrent?: number,
  ): Promise<void> {

    await concurrentParallel(
      objects,
      fn,
      () => null,
      maxConcurrent,
    );

  }

  calculateNumChunks(size: number): number {
    return Math.ceil(size / KV_STORE_CHUNK_SIZE);
  }

  async getExistingAssetVariant(_variantKey: string): Promise<AssetVariantMetadata | null> {
    // The purpose of this function is to use a HEAD request against storage
    // to save time by checking for an existing item. This is not applicable for local.
    return null;
  }

  async purgeSurrogateKey(_surrogateKey: string): Promise<void> {
  }
}
