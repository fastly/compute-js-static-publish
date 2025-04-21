/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { type OptionDefinition } from 'command-line-args';

import { type KVAssetEntryMap, type KVAssetVariantMetadata, isKVAssetVariantMetadata } from '../../../models/assets/kvstore-assets.js';
import { type ContentCompressionTypes } from '../../../models/compression/index.js';
import { type PublisherServerConfigNormalized } from '../../../models/config/publisher-server-config.js';
import { type ContentTypeDef } from '../../../models/config/publish-content-config.js';
import { type IndexMetadata } from '../../../models/server/index.js';
import { calcExpirationTime } from '../../../models/time/index.js';
import { type FastlyApiContext, loadApiToken } from '../../fastly-api/api-token.js';
import { getKvStoreEntryInfo, kvStoreSubmitEntry } from '../../fastly-api/kv-store.js';
import { parseCommandLine } from '../../util/args.js';
import { mergeContentTypes, testFileContentType } from '../../util/content-types.js';
import { LoadConfigError, loadPublishContentConfigFile, loadStaticPublisherRcFile } from '../../util/config.js';
import { applyDefaults } from '../../util/data.js';
import { readServiceId } from '../../util/fastly-toml.js';
import { calculateFileSizeAndHash, enumerateFiles, getFileSize, rootRelative } from '../../util/files.js';
import {
  applyKVStoreEntriesChunks,
  doKvStoreItemsOperation,
  type KVStoreItemDesc,
} from '../../util/kv-store-items.js';
import { writeKVStoreEntriesForLocal } from '../../util/kv-store-local-server.js';
import { isNodeError } from '../../util/node.js';
import { ensureVariantFileExists, type Variants } from '../../util/variants.js';

// KV Store key format:
// <publishId>_index_<preview_id>.json
// <publishId>_settings_<preview_id>.json
// <publishId>_files_sha256_<hash>_<variant>

// split large files into 20MiB chunks
const KV_STORE_CHUNK_SIZE = 1_024 * 1_024 * 20;

function help() {
  console.log(`\

Usage:
  npx @fastly/compute-js-static-publish publish-content [options]

Description:
  Publishes static files from your root directory into the configured Fastly KV Store,
  under a named collection (e.g., "live", "staging", "preview-123").
  Automatically skips uploading content that already exists in KV Store.

Options:
  --config <config-file>           Path to a publish-content.config.js file
                                   (default: publish-content.config.js in the current directory)
  --root-dir <dir>                 Override the root directory to publish from
  --collection-name <name>         Publish under a specific collection name (defaults to value in static-publish.rc.js).
  --expires-in <duration>          Set expiration for the collection relative to now (e.g., 3d, 6h, 1w).
  --expires-at <timestamp>         Set expiration using an absolute ISO 8601 timestamp.
  --local-only                     Write content to local KV Store for testing only. No remote uploads.
  --no-local                       Skip local KV Store writes and upload only to the Fastly KV Store.
  --kv-overwrite                   When Fastly KV Store is used, always overwrite existing items in the store.                   

  --fastly-api-token <token>       Fastly API token used for KV Store access. If not provided,
                                   the tool will try:
                                     1. FASTLY_API_TOKEN environment variable
                                     2. fastly profile token (via CLI)
  -h, --help                       Show help for this command.
`);
}

export async function action(actionArgs: string[]) {

  const optionDefinitions: OptionDefinition[] = [
    { name: 'verbose', type: Boolean, },

    { name: 'config', type: String },

    // The 'root' directory for the publishing.
    // All assets are expected to exist under this root. Required.
    // For backwards compatibility, if this value is not provided,
    // then the value of 'public-dir' is used.
    { name: 'root-dir', type: String, },

    // Collection name to be used for this publishing.
    { name: 'collection-name', type: String, },

    { name: 'expires-in', type: String },
    { name: 'expires-at', type: String },

    { name: 'local-only', type: Boolean },
    { name: 'no-local', type: Boolean },
    { name: 'kv-overwrite', type: Boolean },

    // Fastly API Token to use for this publishing.
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
    ['config']: configFilePathValue,
    ['root-dir']: rootDir,
    ['collection-name']: collectionNameValue,
    ['expires-in']: expiresIn,
    ['expires-at']: expiresAt,
    ['local-only']: localOnlyMode,
    ['no-local']: noLocalMode,
    ['kv-overwrite']: overwriteKvStoreItems,
    ['fastly-api-token']: fastlyApiToken,
  } = parsed.commandLineOptions;

  // no-local and local-only are mutually exclusive
  if (noLocalMode && localOnlyMode) {
    console.error("❌ '--no-local' and '--local-only' are mutually exclusive.");
    process.exitCode = 1;
    return;
  }

  // compute-js-static-publisher cli is always run from the Compute application directory
  // in other words, the directory that contains `fastly.toml`.
  const computeAppDir = path.resolve();

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

  // Create local files unless 'no-local' is set
  let createLocalFiles = false;
  if (noLocalMode) {
    console.log(`ℹ️ 'No local mode' - skipping creation of files for local simulated KV Store`);
  } else {
    createLocalFiles = true;
  }

  // Use the KV Store unless 'local-only' is set
  let useKvStore = false;
  if (serviceId == null) {
    console.log(`ℹ️ 'service_id' not set in 'fastly.toml' - skipping creation of files for Fastly KV Store`);
  } else if (localOnlyMode) {
    console.log(`ℹ️ 'Local only mode' - skipping creation of files for Fastly KV Store`);
  } else {
    useKvStore = true;
  }

  const segments: string[] = [];
  if (createLocalFiles) {
    segments.push('for local simulated KV Store');
  }
  if (useKvStore) {
    segments.push('to the Fastly KV Store');
  }

  console.log(`🚀 Publishing content ${segments.join(' and ')}...`);

  let fastlyApiContext: FastlyApiContext | undefined = undefined;
  if (useKvStore) {
    const apiTokenResult = loadApiToken({ commandLine: fastlyApiToken });
    if (apiTokenResult == null) {
      console.error("❌ Fastly API Token not provided.");
      console.error("Set the FASTLY_API_TOKEN environment variable to an API token that has write access to the KV Store.");
      process.exitCode = 1;
      return;
    }
    fastlyApiContext = { apiToken: apiTokenResult.apiToken };
    console.log(`✔️ Fastly API Token: ${fastlyApiContext.apiToken.slice(0, 4)}${'*'.repeat(fastlyApiContext.apiToken.length-4)} from '${apiTokenResult.source}'`);
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

  let expirationTime: number | undefined;
  try {
    expirationTime = calcExpirationTime({expiresIn, expiresAt});
  } catch(err: unknown) {
    console.error(`❌ Cannot process expiration time`);
    console.error(String(err));
    process.exitCode = 1;
    return;
  }

  console.log(`✔️ Public directory '${rootRelative(publicDirRoot)}'.`);

  const publishId = staticPublisherRc.publishId;
  console.log(`  | Publish ID: ${publishId}`);

  const kvStoreName = staticPublisherRc.kvStoreName;
  console.log(`  | Using KV Store: ${kvStoreName}`);

  const defaultCollectionName = staticPublisherRc.defaultCollectionName;
  console.log(`  | Default Collection Name: ${defaultCollectionName}`);

  // The Static Content Root Dir, which will hold loaders and content generated by this publishing.
  const staticPublisherWorkingDir = publishContentConfig.staticPublisherWorkingDir;

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

  if (expirationTime != null) {
    console.log(`✔️ Publishing with expiration timestamp: ${new Date(expirationTime * 1000).toISOString()}`);
  } else {
    console.log(`✔️ Publishing with no expiration timestamp.`);
  }
  if (collectionName === defaultCollectionName && expirationTime != null) {
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

  // Create "KV Store content" sub dir if it doesn't exist already.
  // This will be used to hold a copy of files to prepare for upload to the KV Store
  // and for serving using the local development server.
  const staticPublisherKvStoreContent = `${staticPublisherWorkingDir}/kv-store-content`;
  fs.mkdirSync(staticPublisherKvStoreContent, { recursive: true });

  // A list of items in the KV Store at the end of the publishing.
  // Includes items that already exist as well.  'write' signifies
  // that the item is to be written
  const kvStoreItemDescriptions: KVStoreItemDesc[] = [];

  // Assets included in the publishing, keyed by asset key
  const kvAssetsIndex: KVAssetEntryMap = {};

  // All the metadata of the variants we know about during this publishing, keyed on the base version's hash.
  type VariantMetadataEntry = KVAssetVariantMetadata & {
    existsInKvStore: boolean,
  };
  type VariantMetadataMap = Map<Variants, VariantMetadataEntry>;
  const baseHashToVariantMetadatasMap = new Map<string, VariantMetadataMap>();

  // #### Iterate files
  for (const file of files) {
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
    if (publishContentConfig.kvStoreAssetInclusionTest != null) {

      includeAsset = publishContentConfig.kvStoreAssetInclusionTest(assetKey, contentType);

    } else {
      // If no test is set, then default to inclusion
      includeAsset = true;
    }

    if (!includeAsset) {
      continue;
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
    for (const variant of variants) {
      let variantKey = `${publishId}_files_sha256_${baseHash}`;
      let variantFilename = `${baseHash}`;
      if (variant !== 'original') {
        variantKey = `${variantKey}_${variant}`;
        variantFilename = `${variantFilename}_${variant}`;
      }

      const variantFilePath = path.resolve(staticPublisherKvStoreContent, variantFilename);

      let variantMetadata = variantMetadatas.get(variant);
      if (variantMetadata != null) {

        console.log(` 🏃‍♂️ Asset "${variantKey}" is identical to an item we already know about, reusing existing copy.`);

      } else {

        let kvStoreItemMetadata: KVAssetVariantMetadata | null = null;

        if (useKvStore && !overwriteKvStoreItems) {
          const items = [{
            key: variantKey,
          }];

          await doKvStoreItemsOperation(
            items,
            async(_, variantKey) => {
              // fastlyApiContext is non-null if useKvStore is true
              const kvStoreEntryInfo = await getKvStoreEntryInfo(fastlyApiContext!, kvStoreName, variantKey);
              if (!kvStoreEntryInfo) {
                return;
              }
              let itemMetadata;
              if (kvStoreEntryInfo.metadata != null) {
                try {
                  itemMetadata = JSON.parse(kvStoreEntryInfo.metadata);
                } catch {
                  // if the metadata does not parse successfully as JSON,
                  // treat it as though it didn't exist.
                }
              }
              if (isKVAssetVariantMetadata(itemMetadata)) {
                let exists = false;
                if (itemMetadata.size <= KV_STORE_CHUNK_SIZE) {
                  // For an item equal to or smaller than the chunk size, if it exists
                  // and its metadata asserts no chunk count, then we assume it exists.
                  if (itemMetadata.numChunks === undefined) {
                    exists = true;
                  }
                } else {
                  // For chunked objects, if the first chunk exists, and its metadata asserts
                  // the same number of chunks based on size, then we assume it exists (for now).
                  // In the future we might actually check for the existence and sizes of
                  // every chunk in the KV Store.
                  const expectedNumChunks = Math.ceil(itemMetadata.size / KV_STORE_CHUNK_SIZE);
                  if (itemMetadata.numChunks === expectedNumChunks) {
                    exists = true;
                  }
                }
                if (exists) {
                  kvStoreItemMetadata = {
                    contentEncoding: itemMetadata.contentEncoding,
                    size: itemMetadata.size,
                    hash: itemMetadata.hash,
                    numChunks: itemMetadata.numChunks,
                  };
                }
              }
            }
          );
        }

        if ((kvStoreItemMetadata as KVAssetVariantMetadata | null) != null) {

          console.log(` ・ Asset found in KV Store with key "${variantKey}".`);
          // And we already know its hash and size.

          variantMetadata = {
            contentEncoding: kvStoreItemMetadata!.contentEncoding,
            size: kvStoreItemMetadata!.size,
            hash: kvStoreItemMetadata!.hash,
            numChunks: kvStoreItemMetadata!.numChunks,
            existsInKvStore: true,
          };

        } else {

          await ensureVariantFileExists(
            variantFilePath,
            variant,
            file,
          );
          if (useKvStore) {
            console.log(` ・ Flagging asset for upload to KV Store with key "${variantKey}".`);
          }

          let contentEncoding, hash, size;
          if (variant === 'original') {
            contentEncoding = undefined;
            hash = baseHash;
            size = baseSize;
          } else {
            contentEncoding = variant;
            ({hash, size} = await calculateFileSizeAndHash(variantFilePath));
          }

          const numChunks = Math.ceil(size / KV_STORE_CHUNK_SIZE);

          variantMetadata = {
            contentEncoding,
            size,
            hash,
            numChunks: numChunks > 1 ? numChunks : undefined,
            existsInKvStore: false,
          };
        }

        variantMetadatas.set(variant, variantMetadata);

        kvStoreItemDescriptions.push({
          write: !variantMetadata.existsInKvStore,
          size: variantMetadata.size,
          key: variantKey,
          filePath: variantFilePath,
          metadataJson: {
            contentEncoding: variantMetadata.contentEncoding,
            size: variantMetadata.size,
            hash: variantMetadata.hash,
            numChunks: variantMetadata.numChunks,
          },
        });

        if (createLocalFiles) {
          // Although we already know the size and hash of the file, the local server
          // needs a copy of the file so we create it if it doesn't exist.
          // This may happen for example if files were uploaded to the KV Store in a previous
          // publishing, but local static content files have been removed since.
          await ensureVariantFileExists(
            variantFilePath,
            variant,
            file,
          );
          console.log(` ・ Prepping asset for local KV Store with key "${variantKey}".`);
        }
      }

      // Only keep variants whose file size actually ends up smaller than
      // what we started with.
      if (variant !== 'original' && variantMetadata.size < baseSize) {
        variantsToKeep.push(variant);
      }
    }

    kvAssetsIndex[assetKey] = {
      key: `sha256:${baseHash}`,
      size: baseSize,
      contentType: contentTypeTestResult.contentType,
      lastModifiedTime,
      variants: variantsToKeep,
    };

  }
  console.log(`✅  Scan complete.`)

  // #### INDEX FILE
  console.log(`🗂️ Creating Index...`);
  const indexFileName = `index_${collectionName}.json`;
  const indexFileKey = `${publishId}_index_${collectionName}`;

  const indexFilePath = path.resolve(staticPublisherKvStoreContent, indexFileName);
  fs.writeFileSync(indexFilePath, JSON.stringify(kvAssetsIndex));

  const indexFileSize = getFileSize(indexFilePath);

  const indexMetadata: IndexMetadata = {
    publishedTime: Math.floor(Date.now() / 1000),
    expirationTime,
  };

  kvStoreItemDescriptions.push({
    write: true,
    size: indexFileSize,
    key: indexFileKey,
    filePath: indexFilePath,
    metadataJson: indexMetadata,
  });
  console.log(`✅  Index has been saved.`)

  // #### SERVER SETTINGS
  // These are saved to KV Store
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
    const spaAsset = kvAssetsIndex[spaFile];
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
    const notFoundPageAsset = kvAssetsIndex[notFoundPageFile];
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

  const settingsFileName = `settings_${collectionName}.json`;
  const settingsFileKey = `${publishId}_settings_${collectionName}`;

  const settingsFilePath = path.resolve(staticPublisherKvStoreContent, settingsFileName);
  fs.writeFileSync(settingsFilePath, JSON.stringify(serverSettings));
  const settingsFileSize = getFileSize(settingsFilePath);

  kvStoreItemDescriptions.push({
    write: true,
    size: settingsFileSize,
    key: settingsFileKey,
    filePath: settingsFilePath,
  });
  console.log(`✅  Settings have been saved.`);

  console.log(`🍪 Chunking large files...`);
  await applyKVStoreEntriesChunks(kvStoreItemDescriptions, KV_STORE_CHUNK_SIZE);
  console.log(`✅  Large files have been chunked.`);

  if (useKvStore) {
    console.log(`📤 Uploading entries to KV Store.`);
    // fastlyApiContext is non-null if useKvStore is true
    await doKvStoreItemsOperation(
      kvStoreItemDescriptions.filter(x => x.write),
      async ({ filePath, metadataJson }, key) => {
        const fileBytes = fs.readFileSync(filePath);
        await kvStoreSubmitEntry(fastlyApiContext!, kvStoreName, key, fileBytes, metadataJson != null ? JSON.stringify(metadataJson) : undefined);
        console.log(` 🌐 Submitted asset "${rootRelative(filePath)}" to KV Store with key "${key}".`)
      }
    );
    console.log(`✅  Uploaded entries to KV Store.`);
  }
  if (createLocalFiles) {
    console.log(`📝 Writing local server KV Store entries.`);
    const storeFile = path.resolve(staticPublisherWorkingDir, `./kvstore.json`);
    writeKVStoreEntriesForLocal(storeFile, computeAppDir, kvStoreItemDescriptions);
    console.log(`✅  Wrote KV Store entries for local server.`);
  }

  console.log(`🎉 Completed.`);

}
