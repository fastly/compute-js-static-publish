/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import path from 'node:path';

import { type OptionDefinition } from 'command-line-args';

import { type FastlyApiContext, loadApiToken } from '../../../util/api-token.js';
import { parseCommandLine } from "../../../util/args.js";
import { LoadConfigError, loadStaticPublisherRcFile } from '../../../util/config.js';
import { readServiceId } from '../../../util/fastly-toml.js';
import { getKVStoreKeys, kvStoreDeleteEntry } from '../../../util/kv-store.js';
import { doKvStoreItemsOperation } from '../../../util/kv-store-items.js';
import { getLocalKVStoreKeys, localKvStoreDeleteEntry } from '../../../util/kv-store-local-server.js';
import { isNodeError } from '../../../util/node.js';

function help() {
  console.log(`\

Usage:
  npx @fastly/compute-js-static-publish collections delete --collection-name=<name> [options]

Description:
  Deletes a collection index from the KV Store. The content files will remain but will no
  longer be referenced.

  Use the 'npx @fastly/compute-js-static-publish clean' command afterward to remove content
  files that are no longer referenced by any collection.  

Required:
  --collection-name=<name>         The name of the collection to delete 

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

  const collectionName = collectionNameValue;
  if (collectionName === defaultCollectionName) {
    console.error(`❌ Cannot delete default collection: ${collectionName}`);
    process.exitCode = 1;
    return;
  }

  console.log(`✔️ Collection to delete: ${collectionName}`);

  // ### KVStore Keys to delete
  const kvKeysToDelete = new Set<string>();

  // ### List all indexes ###
  const indexesPrefix = publishId + '_index_';
  let indexKeys: string[] | null;
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

  // ### Found collections ###
  const foundCollections = indexKeys.map(key => ({ key, name: key.slice(indexesPrefix.length), }));
  if (foundCollections.length === 0) {
    console.log('No collections found.');
  } else {
    console.log(`Found collections: ${foundCollections.map(x => `'${x.name}'`).join(', ')}`);
    for (const collection of foundCollections) {
      if (collection.name === collectionName) {
        console.log(`Flagging collection '${collection.name}' for deletion: ${collection.key}`);
        kvKeysToDelete.add(collection.key);
      }
    }
  }

  // ### Delete items that have been flagged
  const items = [...kvKeysToDelete].map(key => ({key}));
  await doKvStoreItemsOperation(
    items,
    async(_, key) => {
      console.log(`Deleting key from KV Store: ${key}`);
      if (localMode) {
        await localKvStoreDeleteEntry(storeFile, key);
      } else {
        await kvStoreDeleteEntry(fastlyApiContext!, kvStoreName, key);
      }
    }
  );

  console.log("✅  Completed.")
}
