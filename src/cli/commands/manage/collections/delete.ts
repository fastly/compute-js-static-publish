/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { type OptionDefinition } from 'command-line-args';

import { LoadConfigError, loadStaticPublisherRcFile } from '../../../util/config.js';
import { getKVStoreKeys, kvStoreDeleteEntry } from '../../../fastly-api/kv-store.js';
import { type FastlyApiContext, loadApiToken } from '../../../fastly-api/api-token.js';
import { parseCommandLine } from "../../../util/args.js";
import { doKvStoreItemsOperation } from "../../../util/kv-store-items.js";

function help() {
  console.log(`\

Usage:
  npx @fastly/compute-js-static-publish collections delete \\
    --collection-name <name> \\
    [options]

Description:
  Deletes a collection index from the KV Store. The content files will remain but will no longer be referenced.

Options:
  --collection-name <name>         (Required) The name of the collection to delete 

  --fastly-api-token <token>       Fastly API token used for KV Store access. If not provided,
                                   the tool will try:
                                     1. FASTLY_API_TOKEN environment variable
                                     2. fastly profile token (via CLI)
  -h, --help                       Show help for this command.
`);
}

export async function action(actionArgs: string[]) {

  const optionDefinitions: OptionDefinition[] = [
    { name: 'verbose', type: Boolean },
    { name: 'collection-name', type: String },
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
    ['fastly-api-token']: fastlyApiToken,
    ['collection-name']: collectionNameValue,
  } = parsed.commandLineOptions;

  if (collectionNameValue == null) {
    console.error("❌ Required argument '--collection-name' not specified.");
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
  console.log(`  | Publish ID: ${publishId}`);

  const kvStoreName = staticPublisherRc.kvStoreName;
  console.log(`  | Using KV Store: ${kvStoreName}`);

  const defaultCollectionName = staticPublisherRc.defaultCollectionName;
  console.log(`  | Default Collection Name: ${defaultCollectionName}`);

  const collectionName = collectionNameValue;
  if (collectionName === defaultCollectionName) {
    console.error(`❌ Cannot delete default collection: ${collectionName}`);
    process.exitCode = 1;
    return;
  }

  console.log(`✔️ Collection to delete: ${collectionName}`);

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
      await kvStoreDeleteEntry(fastlyApiContext, kvStoreName, key);
    }
  );

  console.log("✅  Completed.")
}
