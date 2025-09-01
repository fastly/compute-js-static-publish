/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

export { type StaticPublishRc } from '../models/config/static-publish-rc.js';
export { type PublishContentConfig } from '../models/config/publish-content-config.js';
export * as collectionSelector from './collection-selector/index.js';
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
export { PublisherServer } from './publisher-server/index.js';

// Register storage builder providers
import { registerStorageProviderBuilder } from './storage/storage-provider.js';
import * as kvStoreProvider from './storage/kv-store-provider.js';

registerStorageProviderBuilder(kvStoreProvider.buildStoreProvider);
