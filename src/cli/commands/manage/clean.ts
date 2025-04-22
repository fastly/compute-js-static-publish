/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import path from 'node:path';

import { type OptionDefinition } from 'command-line-args';

import { type KVAssetEntryMap } from '../../../models/assets/kvstore-assets.js';
import { type IndexMetadata } from '../../../models/server/index.js';
import { isExpired } from '../../../models/time/index.js';
import { LoadConfigError, loadStaticPublisherRcFile } from '../../util/config.js';
import { getKvStoreEntry, getKVStoreKeys, kvStoreDeleteEntry } from '../../util/kv-store.js';
import { type FastlyApiContext, loadApiToken } from '../../util/api-token.js';
import { parseCommandLine } from '../../util/args.js';
import { readServiceId } from '../../util/fastly-toml.js';
import { doKvStoreItemsOperation } from "../../util/kv-store-items.js";
import { isNodeError } from '../../util/node.js';
import {
  getLocalKvStoreEntry,
  getLocalKVStoreKeys,
  localKvStoreDeleteEntry
} from "../../util/kv-store-local-server.js";

function help() {
  console.log(`\

Usage:
  npx @fastly/compute-js-static-publish clean [options]

Description:
  Cleans up expired or unreferenced items in the Fastly KV Store.
  This includes expired collection indexes and orphaned content assets.

Options:
  --delete-expired-collections     If set, expired collection index files will be deleted.

  --dry-run                        Show what would be deleted without performing any deletions.

Global Options:
  --local                          Instead of working with the Fastly KV Store, operate on
                                   local files that will be used to simulate the KV Store
                                   with the local development environment.

  --fastly-api-token=<token>       Fastly API token for KV Store access.
                                   If not set, the tool will check:
                                     1. FASTLY_API_TOKEN environment variable
                                     2. Logged-in Fastly CLI profile

  -h, --help                       Show this help message and exit.
`);
}

export async function action(actionArgs: string[]) {

  const optionDefinitions: OptionDefinition[] = [
    { name: 'verbose', type: Boolean },

    { name: 'delete-expired-collections', type: Boolean },
    { name: 'dry-run', type: Boolean },

    { name: 'local', type: Boolean },
    { name: 'fastly-api-token', type: String, },
  ];

  const parsed = parseCommandLine(actionArgs, optionDefinitions);
  if (parsed.needHelp) {
    if (parsed.error != null) {
      console.error(String(parsed.error));
      console.error();
      process.exitCode = 1;
    }

    help();
    return;
  }

  const {
    verbose,
    ['delete-expired-collections']: deleteExpiredCollections,
    ['dry-run']: dryRun,
    local: localMode,
    ['fastly-api-token']: fastlyApiToken,
  } = parsed.commandLineOptions;

  // compute-js-static-publisher cli is always run from the Compute application directory
  // in other words, the directory that contains `fastly.toml`.
  const computeAppDir = path.resolve();

  // Check to see if we have a service ID listed in `fastly.toml`.
  // If we do NOT, then we do not use the KV Store.
  let serviceId: string | undefined;
  try {
    serviceId = readServiceId(path.resolve(computeAppDir, './fastly.toml'));
  } catch(err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      console.warn(`❌ ERROR: can't find 'fastly.toml'.`);
      process.exitCode = 1;
      return;
    }

    console.warn(`❌ ERROR: can't read or parse 'fastly.toml'.`);
    process.exitCode = 1;
    return;
  }

  console.log(`🧹 Cleaning KV Store entries...`);

  // Verify targets
  let fastlyApiContext: FastlyApiContext | undefined = undefined;
  if (localMode) {
    console.log(`  Working on local simulated KV Store...`);
  } else {
    if (serviceId === null) {
      console.log(`❌️ 'service_id' not set in 'fastly.toml' - Deploy your Compute app to Fastly before publishing.`);
      process.exitCode = 1;
      return;
    }
    const apiTokenResult = loadApiToken({ commandLine: fastlyApiToken });
    if (apiTokenResult == null) {
      console.error("❌ Fastly API Token not provided.");
      console.error("Set the FASTLY_API_TOKEN environment variable to an API token that has write access to the KV Store.");
      process.exitCode = 1;
      return;
    }
    fastlyApiContext = { apiToken: apiTokenResult.apiToken };
    console.log(`✔️ Fastly API Token: ${fastlyApiContext.apiToken.slice(0, 4)}${'*'.repeat(fastlyApiContext.apiToken.length-4)} from '${apiTokenResult.source}'`);
    console.log(`  Working on the Fastly KV Store...`);
  }

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
  console.log(`  | Publish ID: ${publishId}`);

  const kvStoreName = staticPublisherRc.kvStoreName;
  console.log(`  | Using KV Store: ${kvStoreName}`);

  const defaultCollectionName = staticPublisherRc.defaultCollectionName;
  console.log(`  | Default Collection Name: ${defaultCollectionName}`);

  const staticPublisherWorkingDir = staticPublisherRc.staticPublisherWorkingDir;
  console.log(`  | Static publisher working directory: ${staticPublisherWorkingDir}`);

  const storeFile = path.resolve(staticPublisherWorkingDir, `./kvstore.json`);

  // ### KVStore Keys to delete
  const kvKeysToDelete = new Set<string>();

  // ### List all indexes ###
  const indexesPrefix = publishId + '_index_';
  let indexKeys;
  if (localMode) {
    indexKeys = await getLocalKVStoreKeys(
      storeFile,
      indexesPrefix,
    );
  } else {
    indexKeys = await getKVStoreKeys(
      fastlyApiContext!,
      kvStoreName,
      indexesPrefix,
    );
  }
  if (indexKeys == null) {
    throw new Error(`Can't query indexes in KV Store`);
  }

  // ### Go through the index files, make lists
  const foundCollections = indexKeys.map(x => x.slice(indexesPrefix.length));

  // All collection names that we are keeping
  const liveCollections = new Set<string>();

  // All asset keys (hashes) that we are keeping
  const assetsIdsInUse = new Set<string>();

  console.log('Processing collections:');
  await doKvStoreItemsOperation(
    foundCollections.map(collection => ({
      key: indexesPrefix + collection,
      collection,
    })),
    async({collection}, indexKey) => {
      console.log(`Collection: ${collection}`);

      let kvAssetsIndexResponse;
      if (localMode) {
        kvAssetsIndexResponse = await getLocalKvStoreEntry(
          storeFile,
          indexKey,
        );
      } else {
        kvAssetsIndexResponse = await getKvStoreEntry(
          fastlyApiContext!,
          kvStoreName,
          indexKey,
        );
      }
      if (!kvAssetsIndexResponse) {
        throw new Error(`Can't load KV Store entry ${indexesPrefix + collection}`);
      }

      let indexMetadata: IndexMetadata = {};
      if (kvAssetsIndexResponse.metadata != null) {
        try {
          indexMetadata = JSON.parse(kvAssetsIndexResponse.metadata) as IndexMetadata;
        } catch {
        }
      }

      let isLive = true;
      if (indexMetadata.expirationTime == null) {
        console.log(' Collection has no expiration time set');
      } else {
        console.log(' ⏰ Expiration: ' + new Date(indexMetadata.expirationTime * 1000));
        if (collection === defaultCollectionName) {
          console.log(`  ✅  Expiration time not enforced for default collection.`);
        } else if (isExpired(indexMetadata.expirationTime)) {
          if (!deleteExpiredCollections) {
            console.log(`  ⚠️  Use --delete-expired-collections to delete expired collections.`);
          } else {
            console.log(`  🗑️  Marking expired collection for deletion.`);
            kvKeysToDelete.add(indexKey);
            isLive = false;

          }
        }
      }
      if (!isLive) {
        return;
      }

      liveCollections.add(collection);
      const kvAssetsIndex = (await kvAssetsIndexResponse.response.json()) as KVAssetEntryMap;
      for (const [_assetKey, assetEntry] of Object.entries(kvAssetsIndex)) {
        if (assetEntry.key.startsWith('sha256:')) {
          assetsIdsInUse.add(`sha256_${assetEntry.key.slice('sha256:'.length)}`);
        }
      }
    }
  )
  console.log('');

  // ### List all settings ###
  console.log('Enumerating settings:');
  const settingsPrefix = publishId + '_settings_';
  let settingsKeys;
  if (localMode) {
    settingsKeys = await getLocalKVStoreKeys(
      storeFile,
      settingsPrefix,
    );
  } else {
    settingsKeys = await getKVStoreKeys(
      fastlyApiContext!,
      kvStoreName,
      settingsPrefix,
    );
  }
  if (settingsKeys == null) {
    throw new Error(`Can't query settings in KV Store`);
  }

  // If a settings object is found that doesn't match a live collection name then
  // mark it for deletion
  const foundSettingsCollections = settingsKeys.map(key => ({ key, name: key.slice(settingsPrefix.length) }));
  for (const foundSettings of foundSettingsCollections) {
    console.log(`Settings: ${foundSettings.name}`);
    if (!liveCollections.has(foundSettings.name)) {
      console.log(`  🗑️  Does not match a live index, marking for deletion.`);
      kvKeysToDelete.add(foundSettings.key);
    }
  }
  console.log('');

  // ### Obtain the assets in the KV Store and find the ones that are not in use
  console.log('Enumerating assets:');
  const assetPrefix = publishId + '_files_';
  let assetKeys;
  if (localMode) {
    assetKeys = await getLocalKVStoreKeys(
      storeFile,
      assetPrefix,
    );
  } else {
    assetKeys = await getKVStoreKeys(
      fastlyApiContext!,
      kvStoreName,
      assetPrefix,
    );
  }
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
      console.log(` ${assetId}: in use`);
    } else {
      kvKeysToDelete.add(assetKey);
      console.log(` ${assetId}: not in use - ✅ marking for deletion`);
    }
  }
  console.log('');

  // ### Delete items that have been flagged
  const items = [...kvKeysToDelete].map(key => ({key}));
  await doKvStoreItemsOperation(
    items,
    async(_, key) => {
      if (dryRun) {
        console.log(`[DRY RUN] Deleting item: ${key}`);
      } else {
        console.log(`Deleting item from KV Store: ${key}`);
        if (localMode) {
          await localKvStoreDeleteEntry(
            storeFile,
            key,
          );
        } else {
          await kvStoreDeleteEntry(
            fastlyApiContext!,
            kvStoreName,
            key,
          );
        }
      }
    }
  );

  console.log('✅  Completed.')
}
