/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import fs from 'node:fs';
import path from 'node:path';

import { type KVStoreItemDesc } from './kv-store-items.js';

export function writeKVStoreEntriesForLocal(storeFile: string, computeAppDir: string, kvStoreItemDescriptions: KVStoreItemDesc[]) {

  type KVStoreLocalServerEntry = ({ data: string, } | { file: string }) & { metadata?:string };
  type KVStoreLocalServerData = Record<string, KVStoreLocalServerEntry>;

  let store: KVStoreLocalServerData;
  try {
    // If the local KV store file exists, we have to add to it.
    const storeFileJson = fs.readFileSync(storeFile, 'utf-8')
    store = JSON.parse(storeFileJson);
  } catch {
    store = {};
  }

  for (const kvStoreItemDescription of kvStoreItemDescriptions) {
    store[kvStoreItemDescription.key] = {
      file: path.relative(computeAppDir, kvStoreItemDescription.filePath),
      metadata: kvStoreItemDescription.metadataJson != null ? JSON.stringify(kvStoreItemDescription.metadataJson) : undefined,
    };
  }

  // Delete any keys that point to items that do not exist in the file system
  const keysToDelete = new Set<string>();
  for (const [key, value] of Object.entries(store)) {
    if (!("file" in value) || fs.existsSync(path.resolve(computeAppDir, value.file))) {
      continue;
    }
    keysToDelete.add(key);
  }
  for (const key of keysToDelete) {
    delete store[key];
  }

  fs.writeFileSync(storeFile, JSON.stringify(store));

}
