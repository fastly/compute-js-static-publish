/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import fs from 'node:fs';
import path from 'node:path';

import { type OptionDefinition } from 'command-line-args';

import { decodeIndexMetadata, encodeIndexMetadata } from '../../../../models/server/index.js';
import { calcExpirationTime } from '../../../../models/time/index.js';
import { LoadConfigError, loadStaticPublisherRcFile } from '../../../util/config.js';
import { parseCommandLine } from '../../../util/args.js';
import { loadStorageProviderFromStaticPublishRc } from '../../../storage/storage-provider.js';

function help() {
  console.log(`\

Usage:
  npx @fastly/compute-js-static-publish collections update-expiration \\
    --collection-name=<name> \\
    [options]

Description:
  Sets or updates the expiration time of an existing collection.

Required:
  --collection-name=<name>         The name of the collection to modify

Expiration:
  --expires-in=<duration>          Expiration duration from now.
                                   Examples: 3d, 12h, 15m, 1w

  --expires-at=<timestamp>         Absolute expiration in ISO 8601 format.
                                   Example: 2025-05-01T00:00:00Z

  --expires-never                  Prevent this collection from expiring.

                                   ⚠ These three options are mutually exclusive.
                                   Specify exactly one.

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

    { name: 'collection-name', type: String, },

    { name: 'expires-in', type: String },
    { name: 'expires-at', type: String },
    { name: 'expires-never', type: Boolean },

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
    ['collection-name']: collectionNameValue,
    ['expires-in']: expiresIn,
    ['expires-at']: expiresAt,
    ['expires-never']: expiresNever,
    local: localMode,
    ['fastly-api-token']: fastlyApiToken,
    ['aws-profile']: awsProfile,
    ['aws-access-key-id']: awsAccessKeyId,
    ['aws-secret-access-key']: awsSecretAccessKey,
  } = parsed.commandLineOptions;

  // compute-js-static-publisher cli is always run from the Compute application directory
  // in other words, the directory that contains `fastly.toml`.
  const computeAppDir = path.resolve();

  if (collectionNameValue == null) {
    console.error("❌ Required argument '--collection-name' not specified.");
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
  if (expirationTime === undefined) {
    console.error("❌ Exactly one of '--expires-in', '--expires-at', or '--expires-never' is required.");
    process.exitCode = 1;
    return;
  }

  console.log(`📃 Promoting collection...`);

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

  const collectionName = collectionNameValue;
  console.log(`✔️ Collection to update: ${collectionName}`);

  if (expirationTime !== null) {
    console.log(`✔️ Updating expiration timestamp: ${new Date(expirationTime * 1000).toISOString()}`);
  } else {
    console.log(`✔️ Updating expiration timestamp: never`);
  }
  if (collectionName === defaultCollectionName && expirationTime != null) {
    console.log(`  ⚠️  NOTE: Expiration time not enforced for default collection.`);
  }

  const collectionIndexKey = `${publishId}_index_${collectionName}`;
  const indexEntryInfo = await storageProvider.getStorageEntry(collectionIndexKey);
  if (!indexEntryInfo) {
    throw new Error(`Error querying index for '${collectionNameValue}' in storage`);
  }

  let indexMetadata = decodeIndexMetadata(indexEntryInfo.metadata) ?? {};
  if (indexMetadata.publishedTime == null) {
    indexMetadata.publishedTime = Math.floor(Date.now() / 1000);
  }
  if (expirationTime === null) {
    delete indexMetadata.expirationTime;
  } else {
    indexMetadata.expirationTime = expirationTime;
  }

  console.log(`Uploading to storage: '${collectionName}'`);

  const storageContentDir = `${staticPublisherWorkingDir}/storage-content`;
  fs.mkdirSync(storageContentDir, { recursive: true });

  const indexFileName = `index_${collectionNameValue}.json`;
  const indexFilePath = path.resolve(storageContentDir, indexFileName);
  await storageProvider.submitStorageEntry(
    collectionIndexKey,
    indexFilePath,
    indexEntryInfo.data,
    encodeIndexMetadata(indexMetadata),
  );

  console.log("✅  Completed.");
}
