/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { type OptionDefinition } from 'command-line-args';

import { type AssetEntryMap, type AssetVariantMetadata, } from '../../../models/assets/index.js';
import { type ContentCompressionTypes } from '../../../models/compression/index.js';
import { type PublisherServerConfigNormalized } from '../../../models/config/publisher-server-config.js';
import { type ContentTypeDef } from '../../../models/config/publish-content-config.js';
import { encodeIndexMetadata, type IndexMetadata } from '../../../models/server/index.js';
import { calcExpirationTime } from '../../../models/time/index.js';
import { parseCommandLine } from '../../util/args.js';
import { mergeContentTypes, testFileContentType } from '../../util/content-types.js';
import { LoadConfigError, loadPublishContentConfigFile, loadStaticPublisherRcFile } from '../../util/config.js';
import { applyDefaults } from '../../util/data.js';
import { calculateFileSizeAndHash, enumerateFiles, rootRelative } from '../../util/files.js';
import { ensureVariantFileExists, type Variants } from '../../util/variants.js';
import {
  loadStorageProviderFromStaticPublishRc,
  StorageProviderBatch,
  type StorageProviderBatchEntry,
} from '../../storage/storage-provider.js';

// Storage key format:
// <publishId>_index_<preview_id>.json
// <publishId>_settings_<preview_id>.json
// <publishId>_files_sha256_<hash>_<variant>

function help() {
  console.log(`\

Usage:
  npx @fastly/compute-js-static-publish publish-content [--collection-name=<name>] [options]

Description:
  Publishes static files from your local root directory into a named collection,
  either in the Fastly KV Store (default) or to a local dev directory (--local).
  Files that already exist with the same hash are skipped automatically.
  
  After this process is complete, the PublisherServer object in the Compute application
  will see the updated index of files and updated server settings from the
  publish-content.config.js file.

Optional:
  --collection-name=<name>         Name of the collection to publish into.
                                   Default: value from static-publisher.rc.js (defaultCollectionName)

  --config=<file>                  Path to a publish-content.config.js file.
                                   Default: ./publish-content.config.js

  --root-dir=<dir>                 Directory to publish from. Overrides the config file setting.
                                   Default: rootDir from publish-content.config.js

  --overwrite-existing             Always overwrite existing entries in storage, even if unchanged.

Expiration:
  --expires-in=<duration>          Expiration duration from now.
                                   Examples: 3d, 12h, 15m, 1w

  --expires-at=<timestamp>         Absolute expiration in ISO 8601 format.
                                   Example: 2025-05-01T00:00:00Z

  --expires-never                  Prevent this collection from expiring.

                                   ⚠ These three options are mutually exclusive.
                                   Specify only one.

KV Store Options:
  --local                          Instead of working with the Fastly KV Store, operate on
                                   local files that will be used to simulate the KV Store
                                   with the local development environment.

  --fastly-api-token=<token>       Fastly API token for KV Store access.
                                   If not set, the tool will check:
                                     1. FASTLY_API_TOKEN environment variable
                                     2. Logged-in Fastly CLI profile

  --kv-overwrite                   Alias for --overwrite-existing.

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

Examples:
  npx @fastly/compute-js-static-publish publish-content --collection-name=preview-456
  npx @fastly/compute-js-static-publish publish-content --expires-in=7d --kv-overwrite
  npx @fastly/compute-js-static-publish publish-content --expires-never --local

`);
}

export async function action(actionArgs: string[]) {

  const optionDefinitions: OptionDefinition[] = [
    { name: 'verbose', type: Boolean },

    { name: 'config', type: String },
    { name: 'collection-name', type: String, },
    { name: 'root-dir', type: String, },
    { name: 'overwrite-existing', type: Boolean },

    { name: 'expires-in', type: String },
    { name: 'expires-at', type: String },
    { name: 'expires-never', type: Boolean },

    { name: 'local', type: Boolean },
    { name: 'fastly-api-token', type: String, },
    { name: 'kv-overwrite', type: Boolean },

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
    config: configFilePathValue,
    ['collection-name']: collectionNameValue,
    ['root-dir']: rootDir,
    ['overwrite-existing']: _overwriteExisting,
    ['expires-in']: expiresIn,
    ['expires-at']: expiresAt,
    ['expires-never']: expiresNever,
    local: localMode,
    ['fastly-api-token']: fastlyApiToken,
    ['kv-overwrite']: _kvOverwrite,
    ['aws-profile']: awsProfile,
    ['aws-access-key-id']: awsAccessKeyId,
    ['aws-secret-access-key']: awsSecretAccessKey,
  } = parsed.commandLineOptions;

  const overwriteExisting = _overwriteExisting ?? _kvOverwrite;

  // compute-js-static-publisher cli is always run from the Compute application directory
  // in other words, the directory that contains `fastly.toml`.
  const computeAppDir = path.resolve();

  console.log(`🚀 Publishing content...`);

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

  const configFilePath = configFilePathValue ?? './publish-content.config.js';

  let publishContentConfig;
  try {
    publishContentConfig = await loadPublishContentConfigFile(configFilePath);
  } catch (err) {
    console.error(`❌ Can't load ${configFilePath}`);
    if (err instanceof LoadConfigError) {
      for (const error of err.errors) {
        console.error(error);
      }
    }
    process.exitCode = 1;
    return;
  }

  const publicDirRoot = path.resolve(rootDir != null ? rootDir : publishContentConfig.rootDir);
  if ((computeAppDir + '/').startsWith(publicDirRoot + '/')) {
    if (verbose) {
      console.log(`‼️ Public directory '${rootRelative(publicDirRoot)}' includes the Compute app directory.`);
      console.log(`This may be caused by an incorrect configuration, as this could cause Compute application source`);
      console.log(`files to be included in your published output.`);
    }
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

  console.log(`✔️ Public directory '${rootRelative(publicDirRoot)}'.`);

  const publishId = staticPublisherRc.publishId;
  console.log(`  | Publish ID: ${publishId}`);

  const defaultCollectionName = staticPublisherRc.defaultCollectionName;
  console.log(`  | Default Collection Name: ${defaultCollectionName}`);

  const staticPublisherWorkingDir = staticPublisherRc.staticPublisherWorkingDir;
  console.log(`  | Static publisher working directory: ${staticPublisherWorkingDir}`);

  // Storage Provider
  let storageProvider: any;
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

  // Load content types
  const contentTypes: ContentTypeDef[] = mergeContentTypes(publishContentConfig.contentTypes);

  // #### Collect all file paths
  console.log(`🔍 Scanning root directory ${rootRelative(publicDirRoot)}...`);

  const excludeDirs = publishContentConfig.excludeDirs;
  if (excludeDirs.length > 0) {
    console.log(`✔️ Using exclude directories: ${excludeDirs.join(', ')}`);
  } else {
    if (verbose) {
      console.log(`✔️ No exclude directories defined.`);
    }
  }

  const excludeDotFiles = publishContentConfig.excludeDotFiles;
  if (excludeDotFiles) {
    console.log(`✔️ Files/Directories starting with . are excluded.`);
  }

  const includeWellKnown = publishContentConfig.includeWellKnown;
  if (includeWellKnown) {
    console.log(`✔️ (.well-known is exempt from exclusion.)`);
  }

  // ### Collection name that we're currently publishing
  // for example, live, staging
  const collectionName = collectionNameValue ?? process.env.PUBLISHER_COLLECTION_NAME ?? defaultCollectionName;
  console.log(`✔️ Collection Name: ${collectionName}`);

  if (expirationTime == null) {
    // includes null and undefined
    console.log(`✔️ Publishing with no expiration timestamp.`);
  } else {
    console.log(`✔️ Updating expiration timestamp: ${new Date(expirationTime * 1000).toISOString()}`);
  }
  if (collectionName === defaultCollectionName && expirationTime !== undefined) {
    console.log(`  ⚠️  NOTE: Expiration time not enforced for default collection.`);
  }

  // files to be included in the build/publish
  const files = enumerateFiles({
    publicDirRoot,
    excludeDirs,
    excludeDotFiles,
    includeWellKnown,
  });

  const stats = {
    kvStore: 0,
  };

  // Create "storage content" sub dir if it doesn't exist already.
  // This will be used to hold a copy of files to prepare for upload to storage
  // and for serving using the local development server.
  const storageContentDir = `${staticPublisherWorkingDir}/storage-content`;
  fs.mkdirSync(storageContentDir, { recursive: true });

  // A list of items in storage at the end of the publishing.
  // Includes items that already exist as well.  'write' signifies
  // that the item is to be written
  const batch = new StorageProviderBatch();

  // Assets included in the publishing, keyed by asset key
  const assetsIndex: AssetEntryMap = {};

  // All the metadata of the variants we know about during this publishing, keyed on the base version's hash.
  type VariantMetadataEntry = AssetVariantMetadata & {
    existsInKvStore: boolean,
  };
  type VariantMetadataMap = Map<Variants, VariantMetadataEntry>;
  const baseHashToVariantMetadatasMap = new Map<string, VariantMetadataMap>();

  // #### Iterate files
  const filePromises = files.map(async (file) => {
    // #### asset key
    const assetKey = file.slice(publicDirRoot.length)
      // in Windows, assetKey will otherwise end up as \path\file.html
      .replace(/\\/g, '/');

    // #### decide what the Content Type will be
    let contentTypeTestResult = testFileContentType(contentTypes, assetKey);
    if (contentTypeTestResult == null) {
      contentTypeTestResult = {
        text: false,
        contentType: 'application/octet-stream',
        precompressAsset: false,
      };
      if (verbose) {
        console.log('⚠️ Notice: Unknown file type ' + assetKey + '. Treating as binary file.');
      }
    }

    const contentType = contentTypeTestResult.contentType;
    const contentCompression =
      contentTypeTestResult.precompressAsset ? publishContentConfig.contentCompression : [];

    // #### Are we going to include this file?
    let includeAsset;
    if (publishContentConfig.assetInclusionTest != null) {

      includeAsset = publishContentConfig.assetInclusionTest(assetKey, contentType);

    } else {
      // If no test is set, then default to inclusion
      includeAsset = true;
    }

    if (!includeAsset) {
      return;
    }

    // #### Base file size, hash, last modified time
    const { size: baseSize, hash: baseHash } = await calculateFileSizeAndHash(file);
    console.log(`📄 File '${rootRelative(file)}' - ${baseSize} bytes, sha256: ${baseHash}`);
    const stats = fs.statSync(file);
    const lastModifiedTime = Math.floor((stats.mtime).getTime() / 1000);

    // #### Metadata per variant
    let variantMetadatas = baseHashToVariantMetadatasMap.get(baseHash);
    if (variantMetadatas == null) {
      variantMetadatas = new Map<Variants, VariantMetadataEntry>();
      baseHashToVariantMetadatasMap.set(baseHash, variantMetadatas);
    }

    const variantsToKeep: ContentCompressionTypes[] = [];

    const variants = [
      'original',
      ...contentCompression,
    ] as const;

    const batchItems: StorageProviderBatchEntry[] = [];

    for (const variant of variants) {
      let variantKey = `${publishId}_files_sha256_${baseHash}`;
      let variantFilename = `${baseHash}`;
      if (variant !== 'original') {
        variantKey = `${variantKey}_${variant}`;
        variantFilename = `${variantFilename}_${variant}`;
      }

      const variantFilePath = path.resolve(storageContentDir, variantFilename);

      let variantMetadata = variantMetadatas.get(variant);
      if (variantMetadata != null) {

        if (verbose) {
          console.log(` 🏃‍♂️ Asset "${variantKey}" is identical to an item we already know about, reusing existing copy.`);
        }

      } else {

        if (!overwriteExisting) {
          const assetVariantMetadata = await storageProvider.getExistingAssetVariant(variantKey);
          if (assetVariantMetadata != null) {
            if (verbose) {
              console.log(` ・ Asset found in storage with key "${variantKey}".`);
            }
            // And we already know its hash and size.
            variantMetadata = Object.assign(assetVariantMetadata, { existsInKvStore: true });
          }
        }

        if (variantMetadata == null) {
          console.log(` ↦ Prepping new asset for storage: "${variantKey}"`);
          await ensureVariantFileExists(
            variantFilePath,
            variant,
            file,
            verbose,
          );

          let contentEncoding, hash, size;
          if (variant === 'original') {
            contentEncoding = undefined;
            hash = baseHash;
            size = baseSize;
          } else {
            contentEncoding = variant;
            ({hash, size} = await calculateFileSizeAndHash(variantFilePath));
          }

          const numChunks = storageProvider.calculateNumChunks(size);

          variantMetadata = {
            contentEncoding,
            size,
            hash,
            numChunks: numChunks > 1 ? numChunks : undefined,
            existsInKvStore: false,
          };
        }

        variantMetadatas.set(variant, variantMetadata);

        const metadataJson: Record<string, string> = {
          size: String(variantMetadata.size),
          hash: variantMetadata.hash,
        };
        if (variantMetadata.contentEncoding != null) {
          metadataJson.contentEncoding = variantMetadata.contentEncoding;
        }
        if (variantMetadata.numChunks != null) {
          metadataJson.numChunks = String(variantMetadata.numChunks);
        }

        batchItems.push({
          write: !variantMetadata.existsInKvStore,
          size: variantMetadata.size,
          key: variantKey,
          filePath: variantFilePath,
          metadataJson,
        });
      }

      // Only keep variants whose file size actually ends up smaller than
      // what we started with.
      if (variant !== 'original' && variantMetadata.size < baseSize) {
        variantsToKeep.push(variant);
      }
    }

    return {
      assetKey,
      asset: {
        key: `sha256:${baseHash}`,
        size: baseSize,
        contentType: contentTypeTestResult.contentType,
        lastModifiedTime,
        variants: variantsToKeep,
      },
      batchItems,
    };
  });

  const fileResults = await Promise.all(filePromises);

  for (const result of fileResults) {
    if (result == null) {
      continue;
    }
    assetsIndex[result.assetKey] = result.asset;
    for (const batchItem of result.batchItems) {
      batch.add(batchItem);
    }
  }
  console.log(`✅  Scan complete.`);

  await storageProvider.applyBatch(batch);

  // #### INDEX FILE
  console.log(`🗂️ Saving Index...`);

  const indexFileKey = `${publishId}_index_${collectionName}`;
  const indexMetadata: IndexMetadata = {
    publishedTime: Math.floor(Date.now() / 1000),
    expirationTime: expirationTime ?? undefined,
  };

  const indexFileName = `index_${collectionName}.json`;
  const indexFilePath = path.resolve(storageContentDir, indexFileName);
  await storageProvider.submitStorageEntry(
    indexFileKey,
    indexFilePath,
    JSON.stringify(assetsIndex),
    encodeIndexMetadata(indexMetadata),
  );
  console.log(`✅  Index has been saved.`);

  // #### SERVER SETTINGS
  // These are saved to storage
  console.log(`⚙️ Saving server settings...`);

  const server = applyDefaults<PublisherServerConfigNormalized>(publishContentConfig.server, {
    publicDirPrefix: '',
    staticItems: [],
    allowedEncodings: [ 'br', 'gzip' ],
    spaFile: null,
    notFoundPageFile: null,
    autoExt: [],
    autoIndex: [],
  });

  let publicDirPrefix = server.publicDirPrefix;
  console.log(` ✔️ Server public dir prefix '${publicDirPrefix}'.`);

  let staticItems = server.staticItems;

  let allowedEncodings = server.allowedEncodings;

  let spaFile = server.spaFile;

  if(spaFile != null) {
    console.log(` ✔️ Application SPA file '${spaFile}'.`);
    const spaAsset = assetsIndex[spaFile];
    if(spaAsset == null || spaAsset.contentType !== 'text/html') {
      if (verbose) {
        console.log(` ⚠️ Notice: '${spaFile}' does not exist or is not of type 'text/html'. Ignoring.`);
      }
      spaFile = null;
    }
  } else {
    if (verbose) {
      console.log(` ✔️ Application is not a SPA.`);
    }
  }

  let notFoundPageFile = server.notFoundPageFile;
  if(notFoundPageFile != null) {
    console.log(` ✔️ Application 'not found (404)' file '${notFoundPageFile}'.`);
    const notFoundPageAsset = assetsIndex[notFoundPageFile];
    if(notFoundPageAsset == null || notFoundPageAsset.contentType !== 'text/html') {
      if (verbose) {
        console.log(` ⚠️ Notice: '${notFoundPageFile}' does not exist or is not of type 'text/html'. Ignoring.`);
      }
      notFoundPageFile = null;
    }
  } else {
    if (verbose) {
      console.log(` ✔️ Application specifies no 'not found (404)' page.`);
    }
  }

  let autoIndex: string[] = server.autoIndex;
  let autoExt: string[] = server.autoExt;

  const serverSettings: PublisherServerConfigNormalized = {
    publicDirPrefix,
    staticItems,
    allowedEncodings,
    spaFile,
    notFoundPageFile,
    autoExt,
    autoIndex,
  };

  const settingsFileKey = `${publishId}_settings_${collectionName}`;
  const settingsFileName = `settings_${collectionName}.json`;
  const settingsFilePath = path.resolve(storageContentDir, settingsFileName);
  await storageProvider.submitStorageEntry(
    settingsFileKey,
    settingsFilePath,
    JSON.stringify(serverSettings),
  );

  console.log(`✅  Settings have been saved.`);

  console.log(`🎉 Completed.`);

}
