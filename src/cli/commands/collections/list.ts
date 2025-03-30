/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import commandLineArgs, { type OptionDefinition } from 'command-line-args';

import { LoadConfigError, loadStaticPublisherRcFile } from '../../util/config.js';
import { getKVStoreKeys } from '../../fastly-api/kv-store.js';
import { type FastlyApiContext, loadApiToken } from '../../fastly-api/api-token.js';

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
  }

  console.log("✅  Completed.")
}
