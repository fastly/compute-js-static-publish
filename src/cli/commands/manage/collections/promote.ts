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
} from '../../../util/kv-store.js';
import { type FastlyApiContext, loadApiToken } from '../../../util/api-token.js';
import { parseCommandLine } from '../../../util/args.js';
import path from "node:path";
import { readServiceId } from "../../../util/fastly-toml.js";
import { isNodeError } from "../../../util/node.js";
import { getLocalKvStoreEntry, localKvStoreSubmitEntry } from "../../../util/kv-store-local-server.js";
import fs from "node:fs";

function help() {
  console.log(`\

Usage:
  npx @fastly/compute-js-static-publish collections promote
    --collection-name=<name> \\
    --to=name> \\
    [options]

Description:
  Copies an existing collection (content + config) to a new collection name.

Required:
  --collection-name=<name>         The name of the collection to promote
  --to=<name>                      The name of the new (target) collection to create or overwrite

Expiration:
  --expires-in=<duration>          Expiration duration from now.
                                   Examples: 3d, 12h, 15m, 1w

  --expires-at=<timestamp>         Absolute expiration in ISO 8601 format.
                                   Example: 2025-05-01T00:00:00Z

  --expires-never                  Prevent this collection from expiring.

                                   ⚠ These three options are mutually exclusive.
                                   Specify no more than one.  If not provided, then the
                                   existing expiration rule of the collection being
                                   promoted is used.

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
    { name: 'to', type: String },

    { name: 'expires-in', type: String },
    { name: 'expires-at', type: String },
    { name: 'expires-never', type: Boolean },

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
    to: toCollectionNameValue,
    ['expires-in']: expiresIn,
    ['expires-at']: expiresAt,
    ['expires-never']: expiresNever,
    local: localMode,
    ['fastly-api-token']: fastlyApiToken,
  } = parsed.commandLineOptions;

  // compute-js-static-publisher cli is always run from the Compute application directory
  // in other words, the directory that contains `fastly.toml`.
  const computeAppDir = path.resolve();

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

  let expirationTime: number | null | undefined;
  try {
    expirationTime = calcExpirationTime({expiresIn, expiresAt, expiresNever});
  } catch(err: unknown) {
    console.error(`❌ Cannot process expiration time`);
    console.error(String(err));
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

  console.log(`📃 Promoting collection...`);

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

  const sourceCollectionName = collectionNameValue;
  console.log(`✔️ Collection to copy: ${sourceCollectionName}`);

  const targetCollectionName = toCollectionNameValue;
  console.log(`✔️ Collection to promote to: ${targetCollectionName}`)

  if (expirationTime === undefined) {
    console.log(`✔️ Not updating expiration timestamp.`);
  } else if (expirationTime === null) {
    console.log(`✔️ Updating expiration timestamp: never`);
  } else {
    console.log(`✔️ Updating expiration timestamp: ${new Date(expirationTime * 1000).toISOString()}`);
  }
  if (targetCollectionName === defaultCollectionName && expirationTime !== undefined) {
    console.log(`  ⚠️  NOTE: Expiration time not enforced for default collection.`);
  }

  const sourceCollectionIndexKey = `${publishId}_index_${sourceCollectionName}`;
  const targetCollectionIndexKey = `${publishId}_index_${targetCollectionName}`;

  const sourceCollectionSettingsKey = `${publishId}_settings_${collectionNameValue}`;
  const targetCollectionSettingsKey = `${publishId}_settings_${targetCollectionName}`;

  let indexEntryInfo, settingsEntryInfo;
  if (localMode) {
    [ indexEntryInfo, settingsEntryInfo ] = await Promise.all([
      getLocalKvStoreEntry(storeFile, sourceCollectionIndexKey),
      getLocalKvStoreEntry(storeFile, sourceCollectionSettingsKey),
    ]);
  } else {
    [ indexEntryInfo, settingsEntryInfo ] = await Promise.all([
      getKvStoreEntry(fastlyApiContext!, kvStoreName, sourceCollectionIndexKey),
      getKvStoreEntry(fastlyApiContext!, kvStoreName, sourceCollectionSettingsKey),
    ]);
  }
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
  if (expirationTime !== undefined) {
    if (expirationTime === null) {
      delete indexMetadata.expirationTime;
    } else {
      indexMetadata.expirationTime = expirationTime;
    }
  }

  console.log(`Uploading to KV Store: '${targetCollectionName}'`);

  if (localMode) {

    const staticPublisherKvStoreContent = `${staticPublisherWorkingDir}/kv-store-content`;
    fs.mkdirSync(staticPublisherKvStoreContent, { recursive: true });

    const indexFileName = `index_${collectionNameValue}.json`;
    const indexFilePath = path.resolve(staticPublisherKvStoreContent, indexFileName);
    const indexBody = await indexEntryInfo.response.arrayBuffer();
    fs.writeFileSync(indexFilePath, Buffer.from(indexBody));
    await localKvStoreSubmitEntry(
      storeFile,
      targetCollectionIndexKey,
      path.relative(computeAppDir, indexFilePath),
      JSON.stringify(indexMetadata),
    );

    const settingsFileName = `settings_${collectionNameValue}.json`;
    const settingsFilePath = path.resolve(staticPublisherKvStoreContent, settingsFileName);
    const settingsBody = await settingsEntryInfo.response.arrayBuffer();
    fs.writeFileSync(settingsFilePath, Buffer.from(settingsBody));
    await localKvStoreSubmitEntry(
      storeFile,
      targetCollectionSettingsKey,
      path.relative(computeAppDir, settingsFilePath),
      undefined,
    );

  } else {
    await Promise.all([
      kvStoreSubmitEntry(fastlyApiContext!, kvStoreName, targetCollectionIndexKey, indexEntryInfo.response.body!, JSON.stringify(indexMetadata)),
      kvStoreSubmitEntry(fastlyApiContext!, kvStoreName, targetCollectionSettingsKey, settingsEntryInfo.response.body!, undefined),
    ]);
  }

  console.log("✅  Completed.");
}
