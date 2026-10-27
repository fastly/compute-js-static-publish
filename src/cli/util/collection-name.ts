/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { COLLECTION_NAME_RULE, isValidCollectionName } from '../../models/collections/index.js';
import { type StorageProvider } from '../storage/storage-provider.js';

// Checks a collection name that a command writes to. A new collection must
// have a valid name. A collection that exists continues to work with a name
// that breaks the rule, with a warning, so that existing setups do not break.
// Returns false if the command must stop.
export async function checkCollectionNameForWrite(
  storageProvider: StorageProvider,
  publishId: string,
  collectionName: string,
): Promise<boolean> {
  if (isValidCollectionName(collectionName)) {
    return true;
  }

  const indexKey = `${publishId}_index_${collectionName}`;
  const indexEntry = await storageProvider.getStorageEntryInfo(indexKey);
  if (indexEntry != null) {
    console.warn(`⚠️ Warning: Collection name '${collectionName}' is not valid. ${COLLECTION_NAME_RULE}`);
    console.warn(`  * The collection exists, so it continues to work. Use a valid name for new collections.`);
    return true;
  }

  console.error(`❌ Collection name '${collectionName}' is not valid. ${COLLECTION_NAME_RULE}`);
  return false;
}
