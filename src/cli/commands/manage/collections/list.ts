/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { type OptionDefinition } from 'command-line-args';

import { LoadConfigError, loadStaticPublisherRcFile } from '../../../util/config.js';
import { getKvStoreEntry, getKVStoreKeys } from '../../../fastly-api/kv-store.js';
import { type FastlyApiContext, loadApiToken } from '../../../fastly-api/api-token.js';
import { parseCommandLine } from '../../../util/args.js';
import type { IndexMetadata } from "../../../../models/server/index.js";
import { isExpired } from "../../../../models/time/index.js";

function help() {
  console.log(`\

Usage:
  npx @fastly/compute-js-static-publish collections list [options]

Description:
  Lists all collections currently published in the KV Store.

Options:
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
  } = parsed.commandLineOptions;

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

  // ### List all indexes ###
  const indexesPrefix = publishId + '_index_';
  const indexKeys = await getKVStoreKeys(
    fastlyApiContext,
    kvStoreName,
    indexesPrefix,
  );
  if (indexKeys == null) {
    throw new Error(`❌ Can't query indexes in KV Store`);
  }

  // ### Found collections ###
  const foundCollections = indexKeys.map(x => x.slice(indexesPrefix.length));
  if (foundCollections.length === 0) {
    console.log('No collections found.');
  } else {
    console.log(`Found collections:`);
    for (const collection of foundCollections) {
      if (collection === defaultCollectionName) {
        console.log(`  ${collection} *DEFAULT*`);
      } else {
        console.log(`  ${collection}`);
      }
      const indexKey = indexesPrefix + collection;
      const kvAssetsIndexResponse = await getKvStoreEntry(
        fastlyApiContext,
        kvStoreName,
        indexKey,
      );
      if (!kvAssetsIndexResponse) {
        throw new Error(`❌ Can't load KV Store entry ${indexesPrefix + collection}`);
      }
      let indexMetadata: IndexMetadata | undefined;
      if (kvAssetsIndexResponse.metadata != null) {
        try {
          indexMetadata = JSON.parse(kvAssetsIndexResponse.metadata) as IndexMetadata;
        } catch {
        }
      }
      if (indexMetadata == null) {
        console.log(`    No metadata found.`);
        continue;
      }
      if (indexMetadata.publishedTime == null) {
        console.log('    Published  : unknown');
      } else {
        console.log(`    Published  : ${new Date(indexMetadata.publishedTime * 1000)}`);
      }
      
      if (indexMetadata.expirationTime == null) {
        console.log('    Expiration : not set');
      } else {
        console.log(`    Expiration : ${new Date(indexMetadata.expirationTime * 1000)}`);
        if (collection === defaultCollectionName) {
          console.log(`      ✅  Expiration time not enforced for default collection.`);
        } else if (isExpired(indexMetadata.expirationTime)) {
          console.log(`      ⚠️ EXPIRED - Use 'clean --delete-expired-collections' to`);
          console.log(`                   remove expired collections.`);
        }
      }
    }
  }

  console.log("✅  Completed.")
}
