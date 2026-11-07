/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import {
  type StaticPublishRc,
} from '../../models/config/static-publish-rc.js';

export interface StorageEntry {
  data?: ReadableStream<Uint8Array>;
  metadata?: Record<string, string>;
  providerMetadata?: Record<string, string>;
  // The size of the stored value, in bytes, if the provider gives it.
  size?: number;
}

export interface StorageProvider {
  getStorageKeys(prefix?: string): Promise<string[] | null>;
  getStorageEntryInfo(key: string): Promise<StorageEntry | null>;
  getStorageEntry(key: string): Promise<StorageEntry | null>;
  submitStorageEntry(
    key: string,
    filePath: string,
    data: ReadableStream<Uint8Array> | Uint8Array | string | null | undefined,
    metadata?: Record<string, string>,
  ): Promise<void>;
  deleteStorageEntry(key: string): Promise<void>;
  applyBatch(batch: StorageProviderBatch, options?: ApplyBatchOptions): Promise<void>;
  doConcurrentParallel<TObject extends { key: string }>(
    objects: TObject[],
    fn: (obj: TObject, key: string, index: number) => Promise<void>,
    maxConcurrent?: number,
    throwOnError?: boolean,
  ): Promise<void>;
  calculateNumChunks(size: number): number;
  // The size of each chunk of a file of `size` bytes.
  calculateChunkSizes(size: number): number[];
}

export type StorageProviderBatchEntry = {
  size: number,
  key: string,
  filePath: string,
  metadataJson?: Record<string, string>,
};

export type ApplyBatchOptions = {
  // Keys that are already in storage. applyBatch() does not write entries
  // with these keys. It checks after it splits large files into chunks.
  existingKeys?: Set<string>,
  // Verbose mode.
  // Log a line for each entry or batch. Else, log only the progress.
  verbose?: boolean,
};

export class StorageProviderBatch {
  constructor() {
    this.storageProviderBatchEntries = [];
  }
  storageProviderBatchEntries: StorageProviderBatchEntry[];
  add(entry: StorageProviderBatchEntry) {
    this.storageProviderBatchEntries.push(entry);
  }
}

export type StorageProviderBuilderContext = {
  computeAppDir: string,
  localMode?: boolean,
  fastlyApiToken?: string,
  s3AccessKeyId?: string,
  s3SecretAccessKey?: string,
  // The number of objects that the S3 provider uploads at the same time.
  s3UploadConcurrency?: number,
};
export type StorageProviderBuilder =
  (config: StaticPublishRc, context: StorageProviderBuilderContext) => (Promise<StorageProvider | null> | StorageProvider | null);

// Lists the keys that start with `prefix` followed by a lowercase hex digit.
// Use it for a prefix that a hex hash follows, such as `<publishId>_files_sha256_`.
// A listing gets its keys one page at a time, and each page needs the previous
// page. Thus this function runs one listing for each of the 16 hex digits at the
// same time. The total time is approximately the time of the largest part.
// Returns null only if all the listings return null.
export async function getStorageKeysByHexPrefix(storageProvider: StorageProvider, prefix: string): Promise<string[] | null> {
  const parts = await Promise.all(
    '0123456789abcdef'.split('').map((digit) => storageProvider.getStorageKeys(prefix + digit)),
  );
  if (parts.every((part) => part == null)) {
    return null;
  }
  return parts.flatMap((part) => part ?? []);
}

const _storageProviderBuilders: StorageProviderBuilder[] = [];
export function registerStorageProviderBuilder(builder: StorageProviderBuilder) {
  _storageProviderBuilders.push(builder);
}

export async function loadStorageProviderFromStaticPublishRc(config: StaticPublishRc, context: StorageProviderBuilderContext) {
  let storeProvider;
  for (const builder of _storageProviderBuilders) {
    storeProvider = await builder(config, context);
    if (storeProvider != null) {
      return storeProvider;
    }
  }
  throw new Error('Static Publisher Error: Invalid static-publish.rc.js, storage mode not recognized, or could not instantiate store provider.');
}

// Returns true if storage has the variant with the key `variantKey`, which has
// `size` bytes in `numChunks` chunks. For a variant in more than one chunk, it
// also compares the stored size of each chunk with its expected size. It removes
// a chunk that has a different size, or that is not in storage now, from
// existingKeys, so that applyBatch() uploads the chunk again.
export async function isVariantInStorage(
  storageProvider: StorageProvider,
  existingKeys: Set<string>,
  variantKey: string,
  size: number,
  numChunks: number,
): Promise<boolean> {
  const chunkKeys = Array.from({ length: numChunks }, (_, chunkIndex) =>
    chunkIndex === 0 ? variantKey : `${variantKey}_${chunkIndex}`
  );
  if (!chunkKeys.every(key => existingKeys.has(key))) {
    return false;
  }
  if (numChunks === 1) {
    return true;
  }

  const expectedSizes = storageProvider.calculateChunkSizes(size);
  const entries = await Promise.all(chunkKeys.map(key => storageProvider.getStorageEntryInfo(key)));
  let found = true;
  for (const [ chunkIndex, key ] of chunkKeys.entries()) {
    const entry = entries[chunkIndex];
    if (entry == null) {
      existingKeys.delete(key);
      found = false;
      continue;
    }
    const storedSize = entry.size;
    if (storedSize != null && storedSize !== expectedSizes[chunkIndex]) {
      console.log(`  ‼️ Chunk "${key}" in storage has ${storedSize} bytes, but it must have ${expectedSizes[chunkIndex]} bytes. It will be uploaded again.`);
      existingKeys.delete(key);
      found = false;
    }
  }
  return found;
}
