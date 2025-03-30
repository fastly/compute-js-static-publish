/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import commandLineArgs, { type OptionDefinition } from 'command-line-args';

import { type KVAssetEntryMap } from '../../models/assets/kvstore-assets.js';
import { LoadConfigError, loadStaticPublisherRcFile } from '../util/config.js';
import { getKvStoreEntry, getKVStoreKeys, kvStoreDeleteFile } from '../fastly-api/kv-store.js';
import { type FastlyApiContext, loadApiToken } from '../fastly-api/api-token.js';

export async function action(argv: string[]) {

  const optionDefinitions: OptionDefinition[] = [
    { name: 'verbose', type: Boolean },
    { name: 'fastly-api-token', type: String, },
  ];

  const commandLineValues = commandLineArgs(optionDefinitions, { argv });
  const {
    verbose,
    ['fastly-api-token']: fastlyApiToken,
  } = commandLineValues;

  const apiTokenResult = loadApiToken({ commandLine: fastlyApiToken });
  if (apiTokenResult == null) {
    console.error("❌ Fastly API Token not provided.");
    console.error("Set the FASTLY_API_TOKEN environment variable to an API token that has write access to the KV Store.");
    process.exitCode = 1;
    return;
  }
  const fastlyApiContext = { apiToken: apiTokenResult.apiToken } satisfies FastlyApiContext;
  console.log(`✔️ Fastly API Token: ${fastlyApiContext.apiToken.slice(0, 4)}${'*'.repeat(fastlyApiContext.apiToken.length-4)} from '${apiTokenResult.source}'`);

  // #### load config
  let staticPublisherRc;
  try {
    staticPublisherRc = await loadStaticPublisherRcFile();
  } catch (err) {
    console.error("❌ Can't load static-publish.rc.js");
    console.error("Run this from a compute-js-static-publish compute-js directory.");
    if (err instanceof LoadConfigError) {
      for (const error of err.errors) {
        console.error(error);
      }
    }
    process.exitCode = 1;
    return;
  }

  const publishId = staticPublisherRc.publishId;
  console.log(`✔️ Publish ID: ${publishId}`);

  const kvStoreName = staticPublisherRc.kvStoreName;
  console.log(`✔️ Using KV Store: ${kvStoreName}`);

  const defaultCollectionName = staticPublisherRc.defaultCollectionName;
  console.log(`✔️ Default Collection Name: ${defaultCollectionName}`);

  // ### KVStore Keys to delete
  const kvKeysToDelete = new Set<string>();

  // ### List all indexes ###
  const indexesPrefix = publishId + '_index_';
  const indexKeys = await getKVStoreKeys(
    fastlyApiContext,
    kvStoreName,
    indexesPrefix,
  );
  if (indexKeys == null) {
    throw new Error(`Can't query indexes in KV Store`);
  }

  // ### Found collections ###
  const foundCollections = indexKeys.map(x => x.slice(indexesPrefix.length));
  console.log('Found collections');
  for (const collection of foundCollections) {
    console.log(collection);
  }

  // TODO ### Determine which ones are not expired, based on an expiration meta
  const liveCollections = foundCollections;

  // ### List all settings ###
  const settingsPrefix = publishId + '_index_';
  const settingsKeys = await getKVStoreKeys(
    fastlyApiContext,
    kvStoreName,
    settingsPrefix,
  );
  if (settingsKeys == null) {
    throw new Error(`Can't query settings in KV Store`);
  }

  // If a settings object is found that doesn't match a live collection name then
  // mark it for deletion
  const foundSettingsCollections = settingsKeys.map(key => ({ key, name: key.slice(settingsPrefix.length) }));
  for (const foundSettings of foundSettingsCollections) {
    if (!foundCollections.includes(foundSettings.name)) {
      kvKeysToDelete.add(foundSettings.key);
    }
  }

  // ### Go through the index files and make a list of all keys (hashes) that we are keeping
  const assetsIdsInUse = new Set<string>();
  for (const collection of liveCollections) {

    // TODO deal with when the index file is > 20MB
    const kvAssetsIndexResponse = await getKvStoreEntry(
      fastlyApiContext,
      kvStoreName,
      indexesPrefix + collection
    );
    if (!kvAssetsIndexResponse) {
      throw new Error(`Can't load KV Store entry ${indexesPrefix + collection}`);
    }
    const kvAssetsIndex = (await kvAssetsIndexResponse.response.json()) as KVAssetEntryMap;
    for (const [_assetKey, assetEntry] of Object.entries(kvAssetsIndex)) {
      if (assetEntry.key.startsWith('sha256:')) {
        assetsIdsInUse.add(`sha256_${assetEntry.key.slice('sha256:'.length)}`);
      }
    }
  }

  // ### Obtain the assets in the KV Store and find the ones that are not in use
  const assetPrefix = publishId + '_files_';
  const assetKeys = await getKVStoreKeys(
    fastlyApiContext,
    kvStoreName,
    assetPrefix,
  );
  if (assetKeys == null) {
    throw new Error(`Can't query assets in KV Store`);
  }

  for (const assetKey of assetKeys) {
    let assetId = assetKey.slice(assetPrefix.length);
    if (assetId.startsWith('sha256_')) {
      assetId = assetId.slice(0, 'sha256_'.length + 64);
    } else {
      // If we don't know what the prefix is, we ignore it
      continue;
    }

    if (assetsIdsInUse.has(assetId)) {
      console.log('Asset ID ' + assetId + ' in use');
    } else {
      kvKeysToDelete.add(assetKey);
      console.log('Asset ID ' + assetId + ' not in use');
    }
  }

  // ### Delete items that have been flagged
  for (const key of kvKeysToDelete) {
    console.log("Deleting item: " + key);
    await kvStoreDeleteFile(fastlyApiContext, kvStoreName, key);
  }

  console.log("✅  Completed.")
}
