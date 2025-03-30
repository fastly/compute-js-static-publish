/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import commandLineArgs, { type OptionDefinition } from 'command-line-args';

import { type KVAssetEntryMap, type KVAssetVariantMetadata, isKVAssetVariantMetadata } from '../../models/assets/kvstore-assets.js';
import { type ContentCompressionTypes } from '../../models/compression/index.js';
import { type PublisherServerConfigNormalized } from '../../models/config/publisher-server-config.js';
import { type ContentTypeDef } from '../../models/config/publish-content-config.js';
import { type FastlyApiContext, FetchError, loadApiToken } from '../fastly-api/api-token.js';
import { getKvStoreEntryInfo } from '../fastly-api/kv-store.js';
import { mergeContentTypes, testFileContentType } from '../util/content-types.js';
import { LoadConfigError, loadPublishContentConfigFile, loadStaticPublisherRcFile } from '../util/config.js';
import { applyDefaults } from '../util/data.js';
import { calculateFileSizeAndHash, enumerateFiles, getFileSize, rootRelative } from '../util/files.js';
import { applyKVStoreEntriesChunks, type KVStoreItemDesc, uploadFilesToKVStore } from '../util/kv-store-items.js';
import { writeKVStoreEntriesForLocal } from '../util/kv-store-local-server.js';
import { attemptWithRetries } from '../util/retryable.js';
import { ensureVariantFileExists, type Variants } from '../util/variants.js';

// KV Store key format:
// <publishId>_index_<preview_id>.json
// <publishId>_settings_<preview_id>.json
// <publishId>_files_sha256_<hash>_<variant>

// split large files into 20MiB chunks
const KV_STORE_CHUNK_SIZE = 1_024 * 1_024 * 20;

export async function action(argv: string[]) {

  const optionDefinitions: OptionDefinition[] = [
    { name: 'verbose', type: Boolean, },

    // Fastly API Token to use for this publishing.
    { name: 'fastly-api-token', type: String, },

    // Collection name to be used for this publishing.
    { name: 'collection-name', type: String, },

    // The 'root' directory for the publishing.
    // All assets are expected to exist under this root. Required.
    // For backwards compatibility, if this value is not provided,
    // then the value of 'public-dir' is used.
    { name: 'root-dir', type: String, },

    { name: 'force-upload', type: Boolean },

    { name: 'no-local', type: Boolean },

    { name: 'local-only', type: Boolean },

    { name: 'config', type: String },
  ];

  const commandLineValues = commandLineArgs(optionDefinitions, { argv });

  const {
    verbose,
    ['fastly-api-token']: fastlyApiToken,
    ['collection-name']: collectionNameValue,
    ['root-dir']: rootDir,
    ['force-upload']: forceUpload,
    ['no-local']: noLocalMode,
    ['local-only']: localOnlyMode,
    ['config']: configFilePathValue,
  } = commandLineValues;

  // no-local and local-only are mutually exclusive
  if (noLocalMode && localOnlyMode) {
    console.error("❌ '--no-local' and '--local-only' are mutually exclusive.");
    process.exitCode = 1;
    return;
  }

  // Create local files unless 'no-local' is set
  const createLocalFiles = !noLocalMode;
  // Use the KV Store unless 'local-only' is set
  const useKvStore = !localOnlyMode;

  const segments: string[] = [];
  if (createLocalFiles) {
    segments.push('for local simluated KV Store');
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

  // compute-js-static-publisher cli is always run from the Compute application directory
  // in other words, the directory that contains `fastly.toml`.
  const computeAppDir = path.resolve();

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

  console.log(`✔️ Public directory '${rootRelative(publicDirRoot)}'.`);

  const publishId = staticPublisherRc.publishId;
  console.log(`✔️ Publish ID: ${publishId}`);

  const kvStoreName = staticPublisherRc.kvStoreName;
  console.log(`✔️ Using KV Store: ${kvStoreName}`);

  const defaultCollectionName = staticPublisherRc.defaultCollectionName;
  console.log(`✔️ Default Collection Name: ${defaultCollectionName}`);

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

  // files to be included in the build/publish
  const files = enumerateFiles({
    publicDirRoot,
    excludeDirs,
    excludeDotFiles,
    includeWellKnown,
  });

  // ### Collection name that we're currently publishing
  // for example, live, staging
  const collectionName = collectionNameValue ?? process.env.PUBLISHER_COLLECTION_NAME ?? defaultCollectionName;

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

        if (useKvStore && !forceUpload) {
          await attemptWithRetries(
            async () => {
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
            },
            {
              onAttempt(attempt) {
                if (attempt > 0) {
                  console.log(`Attempt ${attempt + 1} for: ${variantKey}`);
                }
              },
              onRetry(attempt, err, delay) {
                let statusMessage = 'unknown';
                if (err instanceof FetchError) {
                  statusMessage = `HTTP ${err.status}`;
                } else if (err instanceof TypeError) {
                  statusMessage = 'transport';
                }
                console.log(`Attempt ${attempt + 1} for ${variantKey} gave retryable error (${statusMessage}), delaying ${delay} ms`);
              },
            },
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

  // Metadata can have build time, expiration date, build name
  // const indexMetadata = {};

  const indexFilePath = path.resolve(staticPublisherKvStoreContent, indexFileName);
  fs.writeFileSync(indexFilePath, JSON.stringify(kvAssetsIndex));

  const indexFileSize = getFileSize(indexFilePath);

  kvStoreItemDescriptions.push({
    write: true,
    size: indexFileSize,
    key: indexFileKey,
    filePath: indexFilePath,
    // metadata: indexMetadata,
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
  console.log(`✅  Settings have been saved.`)

  console.log(`🍪 Chunking large files...`)
  await applyKVStoreEntriesChunks(kvStoreItemDescriptions, KV_STORE_CHUNK_SIZE);
  console.log(`✅  Large files have been chunked.`)

  if (useKvStore) {
    console.log(`📤 Uploading entries to KV Store.`)
    // fastlyApiContext is non-null if useKvStore is true
    await uploadFilesToKVStore(fastlyApiContext!, kvStoreName, kvStoreItemDescriptions);
    console.log(`✅  Uploaded entries to KV Store.`)
  }
  if (createLocalFiles) {
    console.log(`📝 Writing local server KV Store entries.`)
    const storeFile = path.resolve(staticPublisherWorkingDir, `./kvstore.json`);
    writeKVStoreEntriesForLocal(storeFile, computeAppDir, kvStoreItemDescriptions);
    console.log(`✅  Wrote KV Store entries for local server.`)
  }

  console.log(`🎉 Completed.`)

}
