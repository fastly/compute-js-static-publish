/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import fs from 'node:fs';
import path from 'node:path';

import { type StorageProviderBatchEntry } from '../storage/storage-provider.js';
import { type KvStoreEntryInfo } from './kv-store.js';

type KVStoreLocalServerEntry = ({ data: string, } | { file: string }) & { metadata?:string };
type KVStoreLocalServerData = Record<string, KVStoreLocalServerEntry>;

export async function getLocalKVStoreKeys(
  storeFile: string,
  prefix?: string,
) {

  let store: KVStoreLocalServerData;
  try {
    // If the local KV store file exists, we have to add to it.
    const storeFileJson = fs.readFileSync(storeFile, 'utf-8')
    store = JSON.parse(storeFileJson);
  } catch {
    store = {};
  }

  let keys = Object.keys(store);

  if (prefix != null) {
    keys = keys.filter(key => key.startsWith(prefix));
  }

  return keys;

}

export async function getLocalKvStoreEntry(
  storeFile: string,
  key: string,
  metadataOnly?: boolean,
): Promise<KvStoreEntryInfo | null> {

  let store: KVStoreLocalServerData;
  try {
    // If the local KV store file exists, we have to add to it.
    const storeFileJson = fs.readFileSync(storeFile, 'utf-8')
    store = JSON.parse(storeFileJson);
  } catch {
    store = {};
  }

  const obj = store[key];
  if (obj == null) {
    return null;
  }

  let response;
  if (metadataOnly) {
    response = new Response(null);
  } else if ('data' in obj) {
    response = new Response(obj.data);
  } else {
    const fileData = fs.readFileSync(obj.file);
    response = new Response(fileData);
  }
  return {
    metadata: obj.metadata ?? null,
    generation: null,
    response,
  };

}

export async function localKvStoreSubmitEntry(
  storeFile: string,
  key: string,
  file: string,
  metadata: string | undefined,
) {

  let store: KVStoreLocalServerData;
  try {
    // If the local KV store file exists, we have to add to it.
    const storeFileJson = fs.readFileSync(storeFile, 'utf-8')
    store = JSON.parse(storeFileJson);
  } catch {
    store = {};
  }

  store[key] = {
    file,
    metadata,
  };

  fs.writeFileSync(storeFile, JSON.stringify(store));

}

export async function localKvStoreDeleteEntry(
  storeFile: string,
  key: string,
) {

  let store: KVStoreLocalServerData;
  try {
    // If the local KV store file exists, we have to add to it.
    const storeFileJson = fs.readFileSync(storeFile, 'utf-8')
    store = JSON.parse(storeFileJson);
  } catch {
    store = {};
  }

  delete store[key];

  fs.writeFileSync(storeFile, JSON.stringify(store));

}

export function writeKVStoreEntriesForLocal(
  storeFile: string,
  computeAppDir: string,
  kvStoreItemDescriptions: StorageProviderBatchEntry[],
) {

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
