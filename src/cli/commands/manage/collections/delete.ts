/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import path from 'node:path';

import { type OptionDefinition } from 'command-line-args';

import { parseCommandLine } from '../../../util/args.js';
import { LoadConfigError, loadStaticPublisherRcFile } from '../../../util/config.js';
import { loadStorageProviderFromStaticPublishRc } from '../../../storage/storage-provider.js';

function help() {
  console.log(`\

Usage:
  npx @fastly/compute-js-static-publish collections delete --collection-name=<name> [options]

Description:
  Deletes a collection index from storage. The content files will remain as they may still
  be referenced by other collection indexes.

  Use the 'npx @fastly/compute-js-static-publish clean' command afterward to remove content
  files that are no longer referenced by any collection.  

Required:
  --collection-name=<name>         The name of the collection to delete 

KV Store Options:
  --local                          Instead of working with the Fastly KV Store, operate on
                                   local files that will be used to simulate the KV Store
                                   with the local development environment.

  --fastly-api-token=<token>       Fastly API token for KV Store access.
                                   If not set, the tool will check:
                                     1. FASTLY_API_TOKEN environment variable
                                     2. Logged-in Fastly CLI profile

Global Options:
  -h, --help                       Show this help message and exit.
`);
}

export async function action(actionArgs: string[]) {

  const optionDefinitions: OptionDefinition[] = [
    { name: 'verbose', type: Boolean },

    { name: 'collection-name', type: String },

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
    ['collection-name']: collectionNameValue,
    ['fastly-api-token']: fastlyApiToken,
    local: localMode,
  } = parsed.commandLineOptions;

  // compute-js-static-publisher cli is always run from the Compute application directory
  // in other words, the directory that contains `fastly.toml`.
  const computeAppDir = path.resolve();

  if (collectionNameValue == null) {
    console.error("❌ Required argument '--collection-name' not specified.");
    process.exitCode = 1;
    return;
  }

  console.log(`🧹 Deleting storage collection...`);

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
    storageProvider = loadStorageProviderFromStaticPublishRc(staticPublisherRc, {
      computeAppDir,
      localMode,
      fastlyApiToken,
    });
  } catch (err: unknown) {
    console.error(`❌ Could not instantiate store provider`);
    console.error(String(err));
    process.exitCode = 1;
    return;
  }

  const collectionName = collectionNameValue;
  if (collectionName === defaultCollectionName) {
    console.error(`❌ Cannot delete default collection: ${collectionName}`);
    process.exitCode = 1;
    return;
  }

  console.log(`✔️ Collection to delete: ${collectionName}`);

  // ### Asset Keys to delete
  const assetKeysToDelete = new Set<string>();

  // ### List all indexes ###
  const indexesPrefix = publishId + '_index_';
  const indexKeys = await storageProvider.getStorageKeys(indexesPrefix);
  if (indexKeys == null) {
    throw new Error(`Can't query indexes in storage`);
  }

  // ### Found collections ###
  const foundCollections = indexKeys.map(key => ({ key, name: key.slice(indexesPrefix.length), }));
  if (foundCollections.length === 0) {
    console.log('No collections found.');
  } else {
    console.log(`Found collections: ${foundCollections.map(x => `'${x.name}'`).join(', ')}`);
    for (const collection of foundCollections) {
      if (collection.name === collectionName) {
        console.log(`Flagging collection '${collection.name}' for deletion: ${collection.key}`);
        assetKeysToDelete.add(collection.key);
      }
    }
  }

  // ### Delete items that have been flagged
  const items = [...assetKeysToDelete].map(key => ({key}));
  await storageProvider.doConcurrentParallel(
    items,
    async(_, key) => {
      console.log(`Deleting key from storage: ${key}`);
      await storageProvider.deleteStorageEntry(key);
    }
  )

  console.log("✅  Completed.")
}
