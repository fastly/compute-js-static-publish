/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import fs from 'node:fs';
import {
  type AssetVariantMetadata,
  decodeAssetVariantMetadata,
} from '../../models/assets/index.js';
import {
  type StaticPublishRc,
  isKvStoreConfigRc,
} from '../../models/config/static-publish-rc.js';
import {
  getKvStoreConfigFromRc,
} from '../../models/config/kv-store-config.js';
import {
  type FastlyApiContext,
  FetchError,
  loadApiToken,
} from '../util/api-token.js';
import {
  rootRelative,
} from '../util/files.js';
import {
  type KvStoreEntryInfo,
  getKvStoreEntry,
  getKVStoreKeys,
  kvStoreDeleteEntry,
  kvStoreSubmitEntry,
  getKvStoreEntryInfo,
} from '../util/kv-store.js';
import {
  applyKVStoreEntriesChunks,
  KV_STORE_CHUNK_SIZE,
} from '../util/kv-store-items.js';
import {
  concurrentParallel,
} from '../util/retryable.js';
import {
  type StorageEntry,
  type StorageProvider,
  type StorageProviderBuilder,
  type StorageProviderBuilderContext,
  type StorageProviderBatch,
} from './storage-provider.js';

export const buildStoreProvider: StorageProviderBuilder = (
  config: StaticPublishRc,
  context: StorageProviderBuilderContext,
) => {
  if (isKvStoreConfigRc(config) && !context.localMode) {
    console.log(`  Working on the Fastly KV Store...`);
  } else {
    return null;
  }

  const { kvStoreName } = getKvStoreConfigFromRc(config);
  console.log(`  | Using KV Store: ${kvStoreName}`);

  const apiTokenResult = loadApiToken({ commandLine: context.fastlyApiToken });
  if (apiTokenResult == null) {
    throw new Error("❌ Fastly API Token not provided.\nSet the FASTLY_API_TOKEN environment variable to an API token that has write access to the KV Store.");
  }
  console.log(`✔️ Fastly API Token: ${apiTokenResult.apiToken.slice(0, 4)}${'*'.repeat(apiTokenResult.apiToken.length-4)} from '${apiTokenResult.source}'`);
  return new KvStoreProvider(
    kvStoreName,
    apiTokenResult.apiToken,
  );
};

export class KvStoreProvider implements StorageProvider {
  constructor(
    storeName: string,
    fastlyApiToken: string,
  ) {
    this.fastlyApiContext = { apiToken: fastlyApiToken };
    this.kvStoreName = storeName;
  }

  fastlyApiContext: FastlyApiContext;
  kvStoreName: string;

  async getStorageKeys(prefix?: string): Promise<string[] | null> {

    return await getKVStoreKeys(
      this.fastlyApiContext,
      this.kvStoreName,
      prefix
    );

  }

  async getStorageEntry(key: string): Promise<StorageEntry | null> {

    const kvStoreEntry = await getKvStoreEntry(
      this.fastlyApiContext,
      this.kvStoreName,
      key,
    );

    if (kvStoreEntry == null) {
      return null;
    }

    return kvStoreEntryToStorageEntry(kvStoreEntry);
  }

  async getStorageEntryInfo(key: string): Promise<StorageEntry | null> {

    const kvStoreEntry = await getKvStoreEntry(
      this.fastlyApiContext,
      this.kvStoreName,
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
    _filePath: string,
    data: ReadableStream<Uint8Array> | Uint8Array | string | null | undefined,
    metadata?: Record<string, string>
  ): Promise<void> {

    await kvStoreSubmitEntry(
      this.fastlyApiContext,
      this.kvStoreName,
      key,
      data ?? new Uint8Array(0),
      metadata != null ? JSON.stringify(metadata) : undefined,
    );

  }

  async deleteStorageEntry(key: string): Promise<void> {

    await kvStoreDeleteEntry(
      this.fastlyApiContext,
      this.kvStoreName,
      key
    );

  }

  async applyBatch(batch: StorageProviderBatch): Promise<void> {

    console.log(`🍪 Chunking large files...`);
    await applyKVStoreEntriesChunks(
      batch.storageProviderBatchEntries,
      KV_STORE_CHUNK_SIZE,
    );
    console.log(`✅  Large files have been chunked.`);

    console.log(`📤 Uploading entries to KV Store.`);
    // fastlyApiContext is non-null if useKvStore is true
    await this.doConcurrentParallel(
      batch.storageProviderBatchEntries.filter(x => x.write),
      async ({filePath, metadataJson}, key) => {
        const fileBytes = fs.readFileSync(filePath);
        await kvStoreSubmitEntry(
          this.fastlyApiContext,
          this.kvStoreName,
          key,
          fileBytes,
          metadataJson != null ? JSON.stringify(metadataJson) : undefined,
        );
        console.log(` 🌐 Submitted asset "${rootRelative(filePath)}" to KV Store with key "${key}".`)
      }
    );
    console.log(`✅  Uploaded entries to KV Store.`);
  }

  async doConcurrentParallel<TObject extends { key: string }>(
    objects: TObject[],
    fn: (obj: TObject, key: string, index: number) => Promise<void>,
    maxConcurrent: number = 12,
  ): Promise<void> {

    await concurrentParallel(
      objects,
      fn,
      (err) => {
        if (err instanceof FetchError) {
          return `HTTP ${err.status}`;
        } else if (err instanceof TypeError) {
          return 'transport';
        }
        return null;
      },
      maxConcurrent,
    );

  }

  calculateNumChunks(size: number): number {
    return Math.ceil(size / KV_STORE_CHUNK_SIZE);
  }

  async getExistingAssetVariant(variantKey: string): Promise<AssetVariantMetadata | null> {

    let kvStoreItemMetadata: AssetVariantMetadata | null = null;

    const items = [{
      key: variantKey,
    }];

    await this.doConcurrentParallel(
      items,
      async (_, variantKey) => {
        // fastlyApiContext is non-null if useKvStore is true
        const kvStoreEntryInfo = await getKvStoreEntryInfo(
          this.fastlyApiContext,
          this.kvStoreName,
          variantKey,
        );
        if (!kvStoreEntryInfo) {
          return;
        }
        let itemMetadata;
        if (kvStoreEntryInfo.metadata != null) {
          try {
            itemMetadata = JSON.parse(kvStoreEntryInfo.metadata);
          } catch {
            // if the metadata does not parse successfully as JSON,
            // treat it as though it didn't exist.
          }
          itemMetadata = decodeAssetVariantMetadata(itemMetadata);
        }
        if (itemMetadata != null) {
          let exists = false;
          if (itemMetadata.size <= KV_STORE_CHUNK_SIZE) {
            // For an item equal to or smaller than the chunk size, if it exists
            // and its metadata asserts no chunk count, then we assume it exists.
            if (itemMetadata.numChunks === undefined) {
              exists = true;
            }
          } else {
            // For chunked objects, if the first chunk exists, and its metadata asserts
            // the same number of chunks based on size, then we assume it exists (for now).
            // In the future we might actually check for the existence and sizes of
            // every chunk in the KV Store.
            const expectedNumChunks = Math.ceil(itemMetadata.size / KV_STORE_CHUNK_SIZE);
            if (itemMetadata.numChunks === expectedNumChunks) {
              exists = true;
            }
          }
          if (exists) {
            kvStoreItemMetadata = {
              contentEncoding: itemMetadata.contentEncoding,
              size: itemMetadata.size,
              hash: itemMetadata.hash,
              numChunks: itemMetadata.numChunks,
            };
          }
        }
      }
    );
    return kvStoreItemMetadata;

  }

  async purgeSurrogateKey(_surrogateKey: string): Promise<void> {
  }
}

export function kvStoreEntryToStorageEntry(
  kvStoreEntry: KvStoreEntryInfo
) {

  const storageEntry: StorageEntry = {};
  if (kvStoreEntry.response.body != null) {
    storageEntry.data = kvStoreEntry.response.body;
  }

  if (kvStoreEntry.metadata != null) {
    const metadata = parseKvStoreMetadata(kvStoreEntry.metadata);
    if (metadata != null) {
      storageEntry.metadata = metadata;
    }
  }

  if (kvStoreEntry.generation != null) {
    storageEntry.providerMetadata = {
      generation: kvStoreEntry.generation,
    };
  }

  return storageEntry;

}

export function parseKvStoreMetadata(metadata: string) {
  let metadataObject = undefined;
  try {
    metadataObject = JSON.parse(metadata);
  } catch {
    // fail if the metadata does not parse successfully as JSON
    return null;
  }

  if (
    metadataObject == null ||
    typeof metadataObject !== 'object' ||
    Array.isArray(metadataObject)
  ) {
    // fail if the metadata parses to string or something other than an object
    return null;
  }

  // Convert any existing non-string values to string during read
  const resultObject: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadataObject)) {

    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      resultObject[key] = String(value);
    }

  }

  return resultObject;
}
