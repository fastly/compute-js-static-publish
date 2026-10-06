/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import {
  isKvStoreConfigRc,
  type StaticPublishRc,
} from '../../models/config/static-publish-rc.js';
import { getKvStoreConfigFromRc } from '../../models/config/kv-store-config.js';
import {
  type StorageProvider,
  type StorageProviderBuilder,
} from './storage-provider.js';

import { KVStore } from 'fastly:kv-store';
import { getKVStoreEntry } from '../util/kv-store.js';

export const buildStoreProvider: StorageProviderBuilder = (config: StaticPublishRc) => {
  if (!isKvStoreConfigRc(config)) {
    return null;
  }
  const kvStoreConfig = getKvStoreConfigFromRc(config);
  return new KvStoreProvider(kvStoreConfig.kvStoreName);
};

export class KvStoreProvider implements StorageProvider {
  constructor(kvStoreName: string) {
    this.kvStoreName = kvStoreName;
  }

  readonly kvStoreName: string;

  async getEntry(key: string) {
    const kvStore = new KVStore(this.kvStoreName);
    return await getKVStoreEntry(kvStore, key);
  }
}
