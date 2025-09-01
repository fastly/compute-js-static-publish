/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import {
  type StaticPublishKvStore,
} from './static-publish-rc.js';

export type KvStoreConfig = {
  kvStoreName: string,
};

export function getKvStoreConfigFromRc(rc: StaticPublishKvStore): KvStoreConfig {
  // Legacy
  if (rc.storageMode === undefined) {
    return {
      kvStoreName: rc.kvStoreName,
    };
  }

  return {
    kvStoreName: rc.kvStore.kvStoreName,
  };
}