/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

export { type StaticPublishRc } from '../models/config/static-publish-rc.js';
export { type StaticPublishProject } from '../models/config/static-publish-project.js';
export { type PublishContentConfig } from '../models/config/publish-content-config.js';
export * as collectionSelector from './collection-selector/index.js';
export {
  type ResolveCollectionResult,
  resolveCollection,
} from './collection-selection/index.js';
export {
  type CollectionSelection,
  type CollectionSelectionSource,
  previewUrl,
  validateCollectionSelection,
} from '../models/config/collection-selection.js';
export {
  CookieCollectionSelector,
  type CookieCollectionSelectorOpts,
} from './collection-selector/from-cookie.js';
export {
  type StorageProvider,
  type StorageProviderBuilder,
  type StorageEntry,
  registerStorageProviderBuilder,
} from './storage/storage-provider.js';
export {
  setSecretStoreForS3Credentials,
  setSecretStoreKeyForS3AccessKeyId,
  setSecretStoreKeyForS3SecretAccessKey,
  setS3CredentialsBuilder,
} from './storage/s3-storage-provider.js';
export {
  type GetMatchingAssetOptions,
  type ServeFallbackOptions,
  type ServeRequestOptions,
  PublisherServer,
} from './publisher-server/index.js';

// Register storage builder providers
import { registerStorageProviderBuilder } from './storage/storage-provider.js';
import * as kvStoreProvider from './storage/kv-store-provider.js';
import * as s3StorageProvider from './storage/s3-storage-provider.js';

registerStorageProviderBuilder(kvStoreProvider.buildStoreProvider);
registerStorageProviderBuilder(s3StorageProvider.buildStoreProvider);
