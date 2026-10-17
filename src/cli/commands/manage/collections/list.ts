/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import path from 'node:path';

import { type OptionDefinition } from 'command-line-args';

import { type AssetEntryMap, countHiddenEntries } from '../../../../models/assets/index.js';
import { decodeIndexMetadata, getUnsupportedIndexFeatures } from '../../../../models/server/index.js';
import { isExpired } from '../../../../models/time/index.js';
import { parseCommandLine } from '../../../util/args.js';
import {
  LoadConfigError,
  configFileName,
  getComputeAppDir,
  loadStaticPublisherRcFile,
} from '../../../util/config.js';
import { loadStorageProviderFromStaticPublishRc } from '../../../storage/storage-provider.js';
import { errorCodeOf, recordError, setJsonResult } from '../../../util/cli-output.js';

function help() {
  console.log(`\

Usage:
  npx @fastly/compute-js-static-publish collections list [options]

Description:
  Lists all collections currently published in the KV Store.

KV Store Options:
  --local                          Instead of working with the Fastly KV Store, operate on
                                   local files that will be used to simulate the KV Store
                                   with the local development environment.
                                   KV Store mode only. In S3 mode, --local is an error.

  --fastly-api-token=<token>       Fastly API token for KV Store access.
                                   If not set, the tool uses the FASTLY_API_TOKEN
                                   environment variable.

S3 Storage Options (BETA):
  --s3-access-key-id=<id>          Access Key ID and Secret Access Key used to
  --s3-secret-access-key=<key>     interface with S3 or compatible storage.
                                   If not set, the tool will check the S3_ACCESS_KEY_ID
                                   and S3_SECRET_ACCESS_KEY environment variables.

Global Options:
  -h, --help                       Show this help message and exit.
`);
}

export async function action(actionArgs: string[]) {

  const optionDefinitions: OptionDefinition[] = [
    { name: 'verbose', type: Boolean },

    { name: 'local', type: Boolean },
    { name: 'fastly-api-token', type: String, },

    { name: 's3-access-key-id', type: String, },
    { name: 's3-secret-access-key', type: String, },
  ];

  const parsed = parseCommandLine(actionArgs, optionDefinitions);
  if (parsed.needHelp) {
    if (parsed.error != null) {
      console.error(String(parsed.error));
      console.error();
      recordError('usage', String(parsed.error));
    }

    help();
    return;
  }

  const {
    verbose,
    local: localMode,
    ['fastly-api-token']: fastlyApiToken,
    ['s3-access-key-id']: s3AccessKeyId,
    ['s3-secret-access-key']: s3SecretAccessKey,
  } = parsed.commandLineOptions;

  // compute-js-static-publisher cli is always run from the Compute application directory
  // in other words, the directory that contains `fastly.toml`.
  const computeAppDir = getComputeAppDir();

  console.log(`📃 Listing collections...`);

  // #### load config
  let staticPublisherRc;
  try {
    staticPublisherRc = await loadStaticPublisherRcFile();
  } catch (err) {
    console.error(`❌ Can't load ${configFileName()}`);
    console.error("Run this from a compute-js-static-publish compute-js directory.");
    if (err instanceof LoadConfigError) {
      for (const error of err.errors) {
        console.error(error);
      }
    }
    recordError('config-invalid', `Can't load ${configFileName()}.`);
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
      s3AccessKeyId,
      s3SecretAccessKey,
    });
  } catch (err: unknown) {
    console.error(`❌ Could not instantiate store provider`);
    console.error(String(err));
    recordError(errorCodeOf(err), String(err));
    return;
  }

  // ### List all indexes ###
  const indexesPrefix = publishId + '_index_';
  const indexKeys = await storageProvider.getStorageKeys(indexesPrefix);
  if (indexKeys == null) {
    throw new Error(`❌ Can't query indexes in storage`);
  }

  // ### Found collections ###
  const foundCollections = indexKeys.map(x => x.slice(indexesPrefix.length));
  // For --json.
  const collectionInfos: Record<string, unknown>[] = [];
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

      const indexEntryInfo = await storageProvider.getStorageEntry(indexKey);
      if (indexEntryInfo == null) {
        throw new Error(`❌ Can't load storage entry ${indexesPrefix + collection}`);
      }
      let indexMetadata = decodeIndexMetadata(indexEntryInfo.metadata);
      const info: Record<string, unknown> = {
        name: collection,
        isDefault: collection === defaultCollectionName,
        publishedAt: null,
        expiresAt: null,
        expired: false,
        requires: [],
        unsupported: [],
        files: null,
        hidden: null,
      };
      collectionInfos.push(info);
      if (indexMetadata == null) {
        console.log(`    No metadata found.`);
        continue;
      }
      if (indexMetadata.publishedTime != null) {
        info.publishedAt = new Date(indexMetadata.publishedTime * 1000).toISOString();
      }
      if (indexMetadata.expirationTime != null) {
        info.expiresAt = new Date(indexMetadata.expirationTime * 1000).toISOString();
        // The expiration time is not enforced for the default collection.
        info.expired = collection !== defaultCollectionName && isExpired(indexMetadata.expirationTime);
      }
      info.requires = indexMetadata.requires ?? [];
      info.unsupported = getUnsupportedIndexFeatures(indexMetadata);
      if (indexMetadata.publishedTime == null) {
        console.log('    Published  : unknown');
      } else {
        console.log(`    Published  : ${new Date(indexMetadata.publishedTime * 1000)}`);
      }
      
      try {
        const assetEntryMap = (await new Response(indexEntryInfo.data).json()) as AssetEntryMap;
        const fileCount = Object.keys(assetEntryMap).length;
        info.files = fileCount;
        info.hidden = countHiddenEntries(assetEntryMap);
        console.log(`    Files      : ${fileCount} (${countHiddenEntries(assetEntryMap)} hidden)`);
      } catch {
        console.log('    Files      : unknown (cannot read the index)');
      }

      if (indexMetadata.requires != null) {
        console.log(`    Requires   : ${indexMetadata.requires.join(', ')}`);
        const unsupportedFeatures = getUnsupportedIndexFeatures(indexMetadata);
        if (unsupportedFeatures.length > 0) {
          console.log(`      ⚠️ This version does not support ${unsupportedFeatures.join(', ')}. An application`);
          console.log(`         that is built with this version will not serve this collection.`);
        }
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

  setJsonResult({
    publishId,
    defaultCollection: defaultCollectionName,
    collections: collectionInfos,
  });
}
