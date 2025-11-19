/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import path from 'node:path';

import { type OptionDefinition } from 'command-line-args';

import { type AssetEntryMap } from '../../../models/assets/index.js';
import { decodeIndexMetadata } from '../../../models/server/index.js';
import { isExpired } from '../../../models/time/index.js';
import { parseCommandLine } from '../../util/args.js';
import { LoadConfigError, loadStaticPublisherRcFile } from '../../util/config.js';
import { loadStorageProviderFromStaticPublishRc } from '../../storage/storage-provider.js';

function help() {
  console.log(`\

Usage:
  npx @fastly/compute-js-static-publish clean [options]

Description:
  Cleans up expired or unreferenced items in storage.
  This can include expired collection indexes and orphaned content assets.

Options:
  --delete-expired-collections     If set, expired collection index files will be deleted.

  --dry-run                        Show what would be deleted without performing any deletions.

KV Store Options:
  --local                          Instead of working with the Fastly KV Store, operate on
                                   local files that will be used to simulate the KV Store
                                   with the local development environment.

  --fastly-api-token=<token>       Fastly API token for KV Store access.
                                   If not set, the tool will check:
                                     1. FASTLY_API_TOKEN environment variable
                                     2. The default profile in the Fastly CLI

S3 Storage Options (BETA):
  --aws-access-key-id=<key>        AWS Access Key ID and Secret Access Key used to
  --aws-secret-access-key=<key>    interface with S3.
                                   If not set, the tool will check:
                                     1. AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY
                                        environment variables
                                     2. The aws credentials file, see below  

  --aws-profile=<profile>          Profile within the aws credentials file.
                                   If not set, the tool will check:
                                     1. AWS_PROFILE environment variable
                                     2. The default profile, if set

Global Options:
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

    { name: 'aws-profile', type: String, },
    { name: 'aws-access-key-id', type: String, },
    { name: 'aws-secret-access-key', type: String, },
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
    ['aws-profile']: awsProfile,
    ['aws-access-key-id']: awsAccessKeyId,
    ['aws-secret-access-key']: awsSecretAccessKey,
  } = parsed.commandLineOptions;

  // compute-js-static-publisher cli is always run from the Compute application directory
  // in other words, the directory that contains `fastly.toml`.
  const computeAppDir = path.resolve();

  console.log(`🧹 Cleaning storage entries...`);

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

  const defaultCollectionName = staticPublisherRc.defaultCollectionName;
  console.log(`  | Default Collection Name: ${defaultCollectionName}`);

  const staticPublisherWorkingDir = staticPublisherRc.staticPublisherWorkingDir;
  console.log(`  | Static publisher working directory: ${staticPublisherWorkingDir}`);

  // Storage Provider
  let storageProvider;
  try {
    storageProvider = await loadStorageProviderFromStaticPublishRc(staticPublisherRc, {
      computeAppDir,
      localMode,
      fastlyApiToken,
      awsProfile,
      awsAccessKeyId,
      awsSecretAccessKey,
    });
  } catch (err: unknown) {
    console.error(`❌ Could not instantiate store provider`);
    console.error(String(err));
    process.exitCode = 1;
    return;
  }

  // ### Asset keys to delete
  const assetKeysToDelete = new Set<string>();

  // ### List all indexes ###
  const indexesPrefix = publishId + '_index_';
  const indexKeys = await storageProvider.getStorageKeys(indexesPrefix);
  if (indexKeys == null) {
    throw new Error(`Can't query indexes in storage`);
  }

  // ### Go through the index files, make lists
  const foundCollections = indexKeys.map(x => x.slice(indexesPrefix.length));

  // All collection names that we are keeping
  const liveCollections = new Set<string>();

  // All asset keys (hashes) that we are keeping
  const assetsIdsInUse = new Set<string>();

  console.log('Processing collections:');
  await storageProvider.doConcurrentParallel(
    foundCollections.map(collection => ({
      key: indexesPrefix + collection,
      collection,
    })),
    async({collection}, indexKey) => {
      console.log(`Collection: ${collection}`);

      const indexEntryInfo = await storageProvider.getStorageEntry(indexKey);
      if (!indexEntryInfo) {
        throw new Error(`Can't load storage entry ${indexesPrefix + collection}`);
      }
      let indexMetadata = decodeIndexMetadata(indexEntryInfo.metadata) ?? {};
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
            assetKeysToDelete.add(indexKey);
            isLive = false;

          }
        }
      }
      if (!isLive) {
        return;
      }

      liveCollections.add(collection);
      const kvAssetsIndex = (await new Response(indexEntryInfo.data).json()) as AssetEntryMap;
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
  const settingsKeys = await storageProvider.getStorageKeys(settingsPrefix);
  if (settingsKeys == null) {
    throw new Error(`Can't query settings in storage`);
  }

  // If a settings object is found that doesn't match a live collection name then
  // mark it for deletion
  const foundSettingsCollections = settingsKeys.map(key => ({ key, name: key.slice(settingsPrefix.length) }));
  for (const foundSettings of foundSettingsCollections) {
    console.log(`Settings: ${foundSettings.name}`);
    if (!liveCollections.has(foundSettings.name)) {
      console.log(`  🗑️  Does not match a live index, marking for deletion.`);
      assetKeysToDelete.add(foundSettings.key);
    }
  }
  console.log('');

  // ### Obtain the assets in storage and find the ones that are not in use
  console.log('Enumerating assets:');
  const assetPrefix = publishId + '_files_';
  const assetKeys = await storageProvider.getStorageKeys(assetPrefix);
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
      assetKeysToDelete.add(assetKey);
      console.log(` ${assetId}: not in use - ✅ marking for deletion`);
    }
  }
  console.log('');

  // ### Delete items that have been flagged
  const items = [...assetKeysToDelete].map(key => ({key}));
  await storageProvider.doConcurrentParallel(
    items,
    async(_, key) => {
      if (dryRun) {
        console.log(`[DRY RUN] Deleting item: ${key}`);
      } else {
        console.log(`Deleting key from storage: ${key}`);
        await storageProvider.deleteStorageEntry(key);
      }
    }
  );

  console.log('✅  Completed.')
}
