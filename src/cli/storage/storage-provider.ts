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

  purgeSurrogateKey(surrogateKey: string): Promise<void>;
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
