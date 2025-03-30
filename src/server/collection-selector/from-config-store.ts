/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { ConfigStore } from 'fastly:config-store';

export function fromConfigStore(configStoreName: string, key: string) {

  try {
    const configStore = new ConfigStore(configStoreName);
    return configStore.get(key);
  } catch {
    // If there is no config store
    return null;
  }

}
