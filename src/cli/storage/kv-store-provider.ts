/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import fs from 'node:fs';
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
  kvStoreSubmitBatch,
} from '../util/kv-store.js';
import {
  applyKVStoreEntriesChunks,
  packNdjsonBatches,
  ndjsonLineForBatchEntry,
  entriesToUpload,
  KV_STORE_CHUNK_SIZE,
} from '../util/kv-store-items.js';
import {
  concurrentParallel,
  makeRetryable,
} from '../util/retryable.js';
import {
  type StorageEntry,
  type StorageProvider,
  type StorageProviderBuilder,
  type StorageProviderBuilderContext,
  type StorageProviderBatch,
  type StorageProviderBatchEntry,
  type ApplyBatchOptions,
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

  async applyBatch(batch: StorageProviderBatch, options: ApplyBatchOptions = {}): Promise<void> {

    const { existingKeys } = options;

    console.log(`🍪 Chunking large files...`);
    await applyKVStoreEntriesChunks(
      batch.storageProviderBatchEntries,
      KV_STORE_CHUNK_SIZE,
    );
    console.log(`✅  Large files have been chunked.`);

    let toWrite = batch.storageProviderBatchEntries;
    if (existingKeys != null) {
      toWrite = entriesToUpload(toWrite, existingKeys);
      console.log(`  | ${batch.storageProviderBatchEntries.length - toWrite.length} chunk(s) already present in the KV Store.`);
    }

    console.log(`📤 Uploading ${toWrite.length} entries to KV Store.`);
    await this.uploadEntries(toWrite);
    console.log(`✅  Uploaded entries to KV Store.`);
  }

  async uploadEntries(entries: StorageProviderBatchEntry[]): Promise<void> {

    const { batches, oversized } = packNdjsonBatches(entries);

    await this.doConcurrentParallel(
      oversized,
      async ({filePath, metadataJson}, key) => {
        const fileBytes = fs.readFileSync(filePath);
        await kvStoreSubmitEntry(
          this.fastlyApiContext,
          this.kvStoreName,
          key,
          fileBytes,
          metadataJson != null ? JSON.stringify(metadataJson) : undefined,
        );
        console.log(` 🌐 Submitted large asset "${rootRelative(filePath)}" to KV Store with key "${key}".`)
      },
      12,
      true,
    );

    await this.doConcurrentParallel(
      batches,
      async (batch, key) => {
        const lines = batch.entries.map(ndjsonLineForBatchEntry);
        const failures = await kvStoreSubmitBatch(this.fastlyApiContext, this.kvStoreName, lines);
        if (failures.length > 0) {
          // Keep only the entries that failed. The retry submits only these entries.
          const failedKeys = new Set(failures.map(f => f.key));
          const submittedCount = batch.entries.length;
          batch.entries = batch.entries.filter(entry => failedKeys.has(entry.key));
          const shown = failures.slice(0, 5).map(f => `${f.key} (${f.code ?? 'unknown'}: ${f.reason ?? 'unknown'})`).join(', ');
          const more = failures.length > 5 ? `, and ${failures.length - 5} more` : '';
          throw makeRetryable(new Error(`${failures.length} of ${submittedCount} entries failed: ${shown}${more}`));
        }
        console.log(` 🌐 Submitted ${batch.entries.length} entries to KV Store ("${key}").`)
      },
      12,
      true,
    );
  }

  async doConcurrentParallel<TObject extends { key: string }>(
    objects: TObject[],
    fn: (obj: TObject, key: string, index: number) => Promise<void>,
    maxConcurrent: number = 12,
    throwOnError: boolean = false,
  ): Promise<void> {

    await concurrentParallel(
      objects,
      fn,
      (err) => {
        if (err instanceof FetchError) {
          return `HTTP ${err.status}`;
        } else if (err instanceof TypeError) {
          return 'transport';
        } else if (err instanceof Error) {
          return err.message;
        }
        return null;
      },
      maxConcurrent,
      throwOnError,
    );

  }

  calculateNumChunks(size: number): number {
    return Math.ceil(size / KV_STORE_CHUNK_SIZE);
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
