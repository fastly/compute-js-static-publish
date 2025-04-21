/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { type OptionDefinition } from 'command-line-args';

import { type IndexMetadata } from '../../../../models/server/index.js';
import { calcExpirationTime } from '../../../../models/time/index.js';
import { LoadConfigError, loadStaticPublisherRcFile } from '../../../util/config.js';
import {
  getKvStoreEntry,
  kvStoreSubmitEntry,
} from '../../../fastly-api/kv-store.js';
import { type FastlyApiContext, loadApiToken } from '../../../fastly-api/api-token.js';
import { parseCommandLine } from '../../../util/args.js';

function help() {
  console.log(`\

Usage:
  npx @fastly/compute-js-static-publish collections promote \\
    --collection-name <name> \\
    --to <name> \\
    [options]

Description:
  Copies an existing collection (content + config) to a new collection name.

Options:
  --collection-name <name>         (Required) The name of the collection to promote
  --to <name>                      (Required) The name of the new (target) collection to create or overwrite
  --expires-in <duration>          Set new expiration relative to now (e.g., 7d, 1h).
  --expires-at <timestamp>         Set new expiration using an absolute ISO 8601 timestamp.

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
    { name: 'to', type: String },
    { name: 'expires-in', type: String },
    { name: 'expires-at', type: String },
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
    ['to']: toCollectionNameValue,
    ['expires-in']: expiresIn,
    ['expires-at']: expiresAt,
    ['fastly-api-token']: fastlyApiToken,
  } = parsed.commandLineOptions;

  if (collectionNameValue == null) {
    console.error("❌ Required argument '--collection-name' not specified.");
    process.exitCode = 1;
    return;
  }

  if (toCollectionNameValue == null) {
    console.error("❌ Required argument '--to' not specified.");
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

  let expirationTime: number | undefined;
  try {
    expirationTime = calcExpirationTime({expiresIn, expiresAt});
  } catch(err: unknown) {
    console.error(`❌ Cannot process expiration time`);
    console.error(String(err));
    process.exitCode = 1;
    return;
  }

  const publishId = staticPublisherRc.publishId;
  console.log(`  | Publish ID: ${publishId}`);

  const kvStoreName = staticPublisherRc.kvStoreName;
  console.log(`  | Using KV Store: ${kvStoreName}`);

  const defaultCollectionName = staticPublisherRc.defaultCollectionName;
  console.log(`  | Default Collection Name: ${defaultCollectionName}`);

  const sourceCollectionName = collectionNameValue;
  console.log(`✔️ Collection to copy: ${sourceCollectionName}`);

  const targetCollectionName = toCollectionNameValue;
  console.log(`✔️ Collection to promote to: ${targetCollectionName}`)

  if (expirationTime != null) {
    console.log(`✔️ Updating expiration timestamp: ${new Date(expirationTime * 1000).toISOString()}`);
  } else {
    console.log(`✔️ Not updating expiration timestamp.`);
  }
  if (targetCollectionName === defaultCollectionName && expirationTime != null) {
    console.log(`  ⚠️  NOTE: Expiration time not enforced for default collection.`);
  }

  const sourceCollectionIndexKey = `${publishId}_index_${sourceCollectionName}`;
  const targetCollectionIndexKey = `${publishId}_index_${targetCollectionName}`;

  const sourceCollectionSettingsKey = `${publishId}_settings_${collectionNameValue}`;
  const targetCollectionSettingsKey = `${publishId}_settings_${targetCollectionName}`;

  const [ indexEntryInfo, settingsEntryInfo ] = await Promise.all([
    getKvStoreEntry(fastlyApiContext, kvStoreName, sourceCollectionIndexKey),
    getKvStoreEntry(fastlyApiContext, kvStoreName, sourceCollectionSettingsKey),
  ]);
  if (!indexEntryInfo) {
    throw new Error(`Error querying index for '${collectionNameValue}' in KV Store`);
  }
  if (!settingsEntryInfo) {
    throw new Error(`Error querying settings for '${collectionNameValue}' in KV Store`);
  }

  let indexMetadata: IndexMetadata = {};
  if (indexEntryInfo.metadata != null) {
    try {
      indexMetadata = JSON.parse(indexEntryInfo.metadata) as IndexMetadata;
    } catch {
    }
  }
  if (indexMetadata.publishedTime == null) {
    indexMetadata.publishedTime = Math.floor(Date.now() / 1000);
  }
  if (expirationTime != null) {
    indexMetadata.expirationTime = expirationTime;
  }

  console.log(`Uploading to KV Store: '${targetCollectionName}'`);

  await Promise.all([
    kvStoreSubmitEntry(fastlyApiContext, kvStoreName, targetCollectionIndexKey, indexEntryInfo.response.body!, JSON.stringify(indexMetadata)),
    kvStoreSubmitEntry(fastlyApiContext, kvStoreName, targetCollectionSettingsKey, settingsEntryInfo.response.body!, undefined),
  ]);

  console.log("✅  Completed.");
}
