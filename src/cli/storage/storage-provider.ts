/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import {
  type AssetVariantMetadata,
} from '../../models/assets/index.js';
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
  applyBatch(batch: StorageProviderBatch): Promise<void>;
  doConcurrentParallel<TObject extends { key: string }>(
    objects: TObject[],
    fn: (obj: TObject, key: string, index: number) => Promise<void>,
    maxConcurrent?: number,
  ): Promise<void>;
  calculateNumChunks(size: number): number;

  getExistingAssetVariant(variantKey: string): Promise<AssetVariantMetadata | null>;
}

export type StorageProviderBatchEntry = {
  write: boolean,
  size: number,
  key: string,
  filePath: string,
  metadataJson?: Record<string, string>,
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
  awsProfile?: string,
  awsAccessKeyId?: string,
  awsSecretAccessKey?: string,
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
