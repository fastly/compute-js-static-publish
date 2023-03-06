// This program builds static resources out of the files in the
// public folder to be served.
// e.g., with create-react-app, this would be the ./build directory.

// Outputs:

// statics-metadata.js
// deploymentId: string - deployment ID
// contentAssetMetadataMap: Map<string, ContentAssetMetadata> - mapping of asset keys to their metadata
//   - key: filename relative to public dir (e.g., /foo/index.html)
//   - value:
//     - size (to be implemented soon): number - File size in bytes
//     - contentType: string - MIME type
//     - timestamp (to be implemented soon): last modified time as unix time
//     - etag (to be implemented soon): string - Etag
//     - text: boolean - whether this is a text file

// statics.js
// imports statics-metadata.js and adds utilities to load the files
// contentAssetMap: Map<string, ContentAsset>
//   - key: filename relative to public dir (e.g., /foo/index.html)
//   - value:
//     - getMetadata()      - gets the metadata entry
//     - getBody()          - gets a Body object that represents the asset
// moduleAssetMap: Map<string, ModuleAsset>
//   - key: filename relative to public dir (e.g., /foo/index.html)
//   - value:
//     - getMetadata()      - gets the metadata entry
//     - async getModule()  - Returns a promise that imports the module and returns a reference.
//                            This simply returns the statically imported module if it is statically imported.
//     - getStaticModule()  - Advanced. Returns the statically imported module, or null.

// This also reexports values like the "spa" value in the static-publish.rc.js
// file so that the C@E handler knows what file to serve up if
// the resource doesn't map to a file.

import * as fs from "fs";
import * as path from "path";
import * as url from "url";
import commandLineArgs from "command-line-args";

import { loadConfigFile } from "./load-config.js";
import { applyDefaults } from "./util/data.js";
import { calculateFileHash } from "./util/hash.js";
import { getFiles } from "./util/files.js";
import { createStringId } from "./util/id.js";
import { FastlyApiContext, loadApiKey } from "./util/fastly-api.js";
import { objectStoreEntryExists, objectStoreSubmitFile } from "./util/object-store.js";
import { mergeContentTypes, testFileContentType } from "../util/content-types.js";
import { compressionTypes } from "../constants/compression.js";
import { algs } from "./compression/index.js";

import type {
  ContentAssetMetadataMap,
  ContentAssetMetadataMapEntry,
} from "../types/content-assets.js";
import type {
  ContentTypeDef,
  ContentTypeTestResult,
} from "../types/content-types.js";
import type {
  ContentAssetInclusionResultNormalized,
  ModuleAssetInclusionResultNormalized,
  PublisherServerConfigNormalized,
} from "../types/config-normalized.js";

type AssetInfo =
  ContentTypeTestResult &
  ContentAssetInclusionResultNormalized &
  ModuleAssetInclusionResultNormalized &
  {
    // Full path to file on local filesystem
    file: string,

    // Asset key (relative to public dir)
    assetKey: string,
  };

type ObjectStoreItemDesc = {
  objectStoreKey: string,
  staticFilePath: string,
  text: boolean,
};

function generateOrLoadPublishId() {

  let created = false;

  const filename = './.publish-id';
  let contents: string | null;
  try {
    contents = fs.readFileSync(filename, 'utf-8');
  } catch {
    contents = null;
  }

  let publishId: string | null = null;
  if (contents != null) {
    publishId = contents
      .split('\n')
      .find(line => line.length > 0 && !line.startsWith('#')) ?? null;
  }

  if (publishId == null) {

    publishId = createStringId();
    created = true;
    const fileContents = `# Generated by @fastly/compute-js-static-publish.\n${publishId}\n`;
    fs.writeFileSync(filename, fileContents, 'utf-8');

  }

  return { publishId, created };

}

async function uploadFilesToObjectStore(fastlyApiContext: FastlyApiContext, objectStoreName: string, objectStoreItems: ObjectStoreItemDesc[]) {
  for (const { objectStoreKey, staticFilePath, text } of objectStoreItems) {
    if (await objectStoreEntryExists(fastlyApiContext, objectStoreName, objectStoreKey)) {
      // Already exists in Object Store
      console.log(`✔️ Asset already exists in Object Store with key "${objectStoreKey}".`)
    } else {
      // Upload to Object Store
      const fileData = fs.readFileSync(staticFilePath);
      await objectStoreSubmitFile(fastlyApiContext!, objectStoreName!, objectStoreKey, fileData);
      console.log(`✔️ Submitted ${text ? 'text' : 'binary'} asset "${staticFilePath}" to Object Store at key "${objectStoreKey}".`)
    }
  }
}

function writeObjectStoreEntriesToFastlyToml(objectStoreName: string, objectStoreItems: ObjectStoreItemDesc[]) {

  let fastlyToml = fs.readFileSync('./fastly.toml', 'utf-8');

  let before: string = '';
  let after: string = '';

  const tableMarker = `[[local_server.object_store.${objectStoreName}]]`;

  const startPos = fastlyToml.indexOf(tableMarker);
  if (startPos === -1) {

    // Object store decl not in fastly.toml yet

    if (fastlyToml.indexOf(objectStoreName) !== -1) {
      // don't do this!
      console.error("Don't do this!");
      throw "No"!
    }

    let newLines;
    if (fastlyToml.endsWith('\n\n')) {
      newLines = '';
    } else if (fastlyToml.endsWith('\n')) {
      newLines = '\n'
    } else {
      newLines = '\n\n';
    }

    before = fastlyToml + newLines;
    after = '';

  } else {

    const lastObjStoreTablePos = fastlyToml.lastIndexOf(tableMarker);
    const nextTablePos = fastlyToml.indexOf('[', lastObjStoreTablePos + tableMarker.length);

    before = fastlyToml.slice(0, startPos);

    if (nextTablePos === -1) {

      after = '';

    } else {

      after = fastlyToml.slice(nextTablePos);

    }

  }

  let tablesToml = '';

  for (const {objectStoreKey, staticFilePath} of objectStoreItems) {
    // Probably, JSON.stringify is wrong, but it should do its job
    tablesToml += tableMarker + '\n';
    tablesToml += 'key = ' + JSON.stringify(objectStoreKey) + '\n';
    tablesToml += 'path = ' + JSON.stringify(path.relative('./', staticFilePath)) + '\n';
    tablesToml += '\n';
  }

  fastlyToml = before + tablesToml + after;

  fs.writeFileSync('./fastly.toml', fastlyToml, 'utf-8');
}

export async function buildStaticLoader(commandLineValues: commandLineArgs.CommandLineOptions) {

  const { 'suppress-framework-warnings': suppressFrameworkWarnings } = commandLineValues;
  const displayFrameworkWarnings = !suppressFrameworkWarnings;

  const { publishId, created } = generateOrLoadPublishId();

  if (created) {
    console.log("✅  Created publish ID");
  }

  console.log(`Publish ID: ${publishId}`);

  console.log("🚀 Building loader...");

  const errors: string[] = [];
  const config = await loadConfigFile(errors);

  if (config == null) {
    console.error("❌ Can't load static-publish.rc.js");
    console.error("Run this from a compute-js-static-publish compute-js directory.");
    for (const error of errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }

  const outputDir = path.resolve();
  const publicDirRoot = path.resolve(config.rootDir);

  console.log(`✔️ Public directory '${publicDirRoot}'.`);

  const objectStoreName = config.objectStore;
  let fastlyApiContext: FastlyApiContext | null = null;
  if (objectStoreName != null) {
    // TODO: load api key from command line
    const apiKeyResult = loadApiKey();
    if (apiKeyResult == null) {
      console.error("❌ Fastly API Token not provided.");
      console.error("Specify one on the command line, or use the FASTLY_API_TOKEN environment variable.");
      process.exitCode = 1;
      return;
    }
    fastlyApiContext = { apiToken: apiKeyResult.apiToken };
    console.log(`✔️ Using Object Store mode, with object store: ${objectStoreName}`);
    console.log(`✔️ Fastly API Token: ${fastlyApiContext.apiToken.slice(0, 4)}${'*'.repeat(fastlyApiContext.apiToken.length-4)} from '${apiKeyResult.source}'`);
  } else {
    if (displayFrameworkWarnings) {
      console.log(`✔️ Not using Object Store mode.`);
    }
  }

  const excludeDirs = config.excludeDirs;
  if (excludeDirs.length > 0) {
    console.log(`✔️ Using exclude directories: ${excludeDirs.join(', ')}`);
  } else {
    if (displayFrameworkWarnings) {
      console.log(`✔️ No exclude directories defined.`);
    }
  }

  const excludeDotFiles = config.excludeDotFiles;
  if (excludeDotFiles) {
    console.log(`✔️ Files/Directories starting with . are excluded.`);
  }

  const includeWellKnown = config.includeWellKnown;
  if (includeWellKnown) {
    console.log(`✔️ (.well-known is exempt from exclusion.)`);
  }

  const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

  // Load content types
  const finalContentTypes: ContentTypeDef[] = mergeContentTypes(config.contentTypes);

  // getFiles() applies excludeDirs, excludeDotFiles, and includeWellKnown.
  let files = getFiles(publicDirRoot, config);

  // If public dir is not inside the c@e dir, then
  // exclude files that come from C@E app dir
  if (!publicDirRoot.startsWith(outputDir)) {
    files = files.filter(file => !file.startsWith(outputDir));
  }

  // And then we apply assetInclusionTest.
  const assetInfos: AssetInfo[] = files.map(file => {
    const assetKey = file.slice(publicDirRoot.length);

    let contentTypeTestResult = testFileContentType(finalContentTypes, assetKey);

    if (contentTypeTestResult == null) {
      contentTypeTestResult = {
        text: false,
        contentType: 'application/octet-stream',
      };
      if (displayFrameworkWarnings) {
        console.log('⚠️ Notice: Unknown file type ' + assetKey + '. Treating as binary file.');
      }
    }

    let contentAssetInclusionResultValue = config.contentAssetInclusionTest?.(assetKey, contentTypeTestResult.contentType);
    if (typeof contentAssetInclusionResultValue === 'boolean') {
      contentAssetInclusionResultValue = {
        includeContent: contentAssetInclusionResultValue,
      };
    } else if (contentAssetInclusionResultValue === 'inline') {
      contentAssetInclusionResultValue = {
        includeContent: true,
        inline: true,
      };
    }
    const contentAssetInclusionResult = applyDefaults(contentAssetInclusionResultValue ?? null, {
      includeContent: true,
      inline: false,
    });

    let moduleAssetInclusionResultValue = config.moduleAssetInclusionTest?.(assetKey, contentTypeTestResult.contentType);
    if (typeof moduleAssetInclusionResultValue === 'boolean') {
      moduleAssetInclusionResultValue = {
        includeModule: moduleAssetInclusionResultValue,
      };
    } else if (moduleAssetInclusionResultValue === 'static-import') {
      moduleAssetInclusionResultValue = {
        includeModule: true,
        useStaticImport: true,
      };
    }

    const moduleAssetInclusionResult = applyDefaults(moduleAssetInclusionResultValue ?? null, {
      includeModule: false,
      useStaticImport: false,
    });

    return {
      file,
      assetKey,
      ...contentAssetInclusionResult,
      ...moduleAssetInclusionResult,
      ...contentTypeTestResult,
    };

  });

  // Create "static content" dir that will be used to hold a copy of static files.
  // NOTE: this is needed because includeBytes doesn't seem to be able to traverse up to parent dir of the Compute project.
  const staticContentDir = './src/static-content';
  fs.rmSync(staticContentDir, { recursive: true, force: true });
  fs.mkdirSync(staticContentDir, { recursive: true });

  // Build content assets metadata
  const contentAssetMetadataMap: ContentAssetMetadataMap = {};

  let contentItems = 0;
  for (const assetInfo of assetInfos) {
    if (!assetInfo.includeContent) {
      continue;
    }
    contentItems++;
    console.log(`✔️ [${contentItems}] ${assetInfo.assetKey}: ${JSON.stringify(assetInfo.contentType)}`);

    const {
      assetKey,
      contentType,
      text,
    } = assetInfo;

    let metadata: ContentAssetMetadataMapEntry;

    if (objectStoreName == null || assetInfo.inline) {
      metadata = {
        assetKey,
        contentType,
        text,
        isInline: true,
        staticFilePath: `${staticContentDir}/file${contentItems}.${assetInfo.text ? 'txt' : 'bin'}`,
        staticFilePathsCompressed: {},
      };
    } else {
      // Use the hash as part of the object store key name.  This avoids having to
      // re-upload a file if it already exists.
      const hash = calculateFileHash(assetInfo.file);

      metadata = {
        assetKey,
        contentType,
        text,
        isInline: false,
        staticFilePath: `${staticContentDir}/file${contentItems}.${assetInfo.text ? 'txt' : 'bin'}`,
        staticFilePathsCompressed: {},
        objectStoreKey: `${publishId}:${assetInfo.assetKey}_${hash}`,
        objectStoreKeysCompressed: {},
      };
    }

    contentAssetMetadataMap[assetKey] = metadata;
  }

  console.log("🚀 Preparing content assets ...");

  // Object store items to upload
  const objectStoreItems: ObjectStoreItemDesc[] = [];

  // Prepare content asset
  const counts = {
    inline: 0,
    objectStore: 0,
    excluded: 0,
  }
  for (const assetInfo of assetInfos) {
    const metadata = contentAssetMetadataMap[assetInfo.assetKey];
    if (metadata == null) {
      // Non-content asset
      counts.excluded++;
      continue;
    }

    const { file } = assetInfo;

    // Copy file to static-content directory
    fs.cpSync(file, metadata.staticFilePath);
    console.log(`✔️ Copied ${metadata.text ? 'text' : 'binary'} asset "${file}" to "${metadata.staticFilePath}".`)

    for (const alg of config.contentCompression) {
      const encodedStaticFilePath = `${metadata.staticFilePath}_${alg}`;

      const compressTo = algs[alg];
      if (compressTo != null) {
        if (await compressTo(file, encodedStaticFilePath, metadata.text)) {
          metadata.staticFilePathsCompressed[alg] = encodedStaticFilePath;
          console.log(`✔️ Compressed ${metadata.text ? 'text' : 'binary'} asset "${file}" to "${encodedStaticFilePath}" [${alg}].`)
        }
      }
    }

    if (metadata.isInline) {
      // Inline using includeBytes()
      counts.inline++;
    } else {
      // fastlyApiContext and objectStoreName will not be null at this point.

      objectStoreItems.push({
        objectStoreKey: metadata.objectStoreKey,
        staticFilePath: metadata.staticFilePath,
        text: metadata.text,
      });

      // For each supported compression type, see if we have a file
      // and then if we do, we upload it to the object store too.
      for (const alg of compressionTypes) {
        const staticFilePath = metadata.staticFilePathsCompressed[alg];
        if (staticFilePath == null) {
          continue;
        }
        const hash = calculateFileHash(staticFilePath);
        const objectStoreKey = `${publishId}:${assetInfo.assetKey}_${alg}_${hash}`;
        objectStoreItems.push({
          objectStoreKey,
          staticFilePath,
          text: metadata.text,
        });
        metadata.objectStoreKeysCompressed[alg] = objectStoreKey;
      }

      counts.objectStore++;
    }
  }

  if (objectStoreName != null) {
    await uploadFilesToObjectStore(fastlyApiContext!, objectStoreName, objectStoreItems);
    writeObjectStoreEntriesToFastlyToml(objectStoreName, objectStoreItems);
  }

  console.log("✅  Prepared " + (counts.inline + counts.objectStore) + " content asset(s):");
  if (counts.inline > 0) {
    console.log("      " + counts.inline + " inline");
  }
  if (counts.objectStore > 0) {
    console.log("      " + counts.objectStore + " object store");
  }

  // Build statics-metadata.js
  let metadataFileContents = `/*
 * Generated by @fastly/compute-js-static-publish.
 */

`;
  metadataFileContents += `\nexport const objectStoreName = ${JSON.stringify(objectStoreName)};\n`;
  metadataFileContents += `\nexport const contentAssetMetadataMap = {\n`;
  for (const [key, value] of Object.entries(contentAssetMetadataMap)) {
    metadataFileContents += `  ${JSON.stringify(key)}: ${JSON.stringify(value)},\n`;
  }
  metadataFileContents += '};\n';
  fs.writeFileSync('./src/statics-metadata.js', metadataFileContents);

  console.log(`✅  Wrote static file metadata for ${contentItems} file(s).`);

  // Copy Types file for static file loader
  try {
    const typesFile = path.resolve(__dirname, '../../resources/statics-metadata.d.ts');
    fs.copyFileSync(typesFile, './src/statics-metadata.d.ts');

    console.log("✅  Wrote content assets metadata types file statics-metadata.d.ts.");
  } catch {
    console.log("⚠️ Notice: could not write content assets metadata types file statics-metadata.d.ts.");
  }

  // Build statics.js
  let fileContents = `/*
 * Generated by @fastly/compute-js-static-publish.
 */

`;

  fileContents += 'import { ContentAssets, ModuleAssets, PublisherServer } from "@fastly/compute-js-static-publish";\n\n';
  fileContents += 'import { objectStoreName, contentAssetMetadataMap } from "./statics-metadata";\n';

  // Add import statements for assets that are modules and that need to be statically imported.
  const staticImportModuleNumbers: Record<string, number> = {};
  let staticImportModuleNumber = 0;
  for (const assetInfo of assetInfos) {
    if (assetInfo.includeModule && assetInfo.useStaticImport) {
      staticImportModuleNumber++;
      staticImportModuleNumbers[assetInfo.assetKey] = staticImportModuleNumber;

      // static-content lives in the src dir, so the import must be declared as
      // relative to that file.
      const relativeFilePath = path.relative('./src', assetInfo.file);
      fileContents += `import * as fileModule${staticImportModuleNumber} from "${relativeFilePath}";\n`;
    }
  }

  fileContents += `\nexport const moduleAssetsMap = {\n`;

  for (const assetInfo of assetInfos) {
    if (!assetInfo.includeModule) {
      continue;
    }

    let module;
    let loadModuleFunction;

    if (assetInfo.useStaticImport) {
      const moduleNumber = staticImportModuleNumbers[assetInfo.assetKey];
      if (moduleNumber == null) {
        throw new Error(`Unexpected! module asset number for "${assetInfo.assetKey}" was not found!`);
      }
      loadModuleFunction = `() => Promise.resolve(fileModule${moduleNumber})`;
      module = `fileModule${moduleNumber}`;
    } else {
      // static-content lives in the src dir, so the import must be declared as
      // relative to that file.
      const relativeFilePath = path.relative('./src', assetInfo.file);
      loadModuleFunction = `() => import("${relativeFilePath}")`;
      module = 'null';
    }

    fileContents += `  ${JSON.stringify(assetInfo.assetKey)}: { isStaticImport: ${JSON.stringify(assetInfo.useStaticImport)}, module: ${module}, loadModule: ${loadModuleFunction} },\n`;
  }

  fileContents += '};\n';

  const server = applyDefaults<PublisherServerConfigNormalized>(config.server, {
    publicDirPrefix: '',
    staticItems: [],
    compression: [ 'br', 'gzip' ],
    spaFile: null,
    notFoundPageFile: null,
    autoExt: [],
    autoIndex: [],
  });

  let publicDirPrefix = server.publicDirPrefix;
  console.log(`✔️ Server public dir prefix '${publicDirPrefix}'.`);

  let staticItems = server.staticItems;

  let compression = server.compression;

  let spaFile = server.spaFile;
  if(spaFile != null) {
    console.log(`✔️ Application SPA file '${spaFile}'.`);
    const spaAsset = assetInfos.find(assetInfo => assetInfo.assetKey === spaFile);
    if(spaAsset == null || spaAsset.contentType !== 'text/html') {
      if (displayFrameworkWarnings) {
        console.log(`⚠️ Notice: '${spaFile}' does not exist or is not of type 'text/html'. Ignoring.`);
      }
      spaFile = null;
    }
  } else {
    if (displayFrameworkWarnings) {
      console.log(`✔️ Application is not a SPA.`);
    }
  }

  let notFoundPageFile = server.notFoundPageFile;
  if(notFoundPageFile != null) {
    console.log(`✔️ Application 'not found (404)' file '${notFoundPageFile}'.`);
    const notFoundPageAsset = assetInfos.find(assetInfo => assetInfo.assetKey === notFoundPageFile);

    if(notFoundPageAsset == null || notFoundPageAsset.contentType !== 'text/html') {
      if (displayFrameworkWarnings) {
        console.log(`⚠️ Notice: '${notFoundPageFile}' does not exist or is not of type 'text/html'. Ignoring.`);
      }
      notFoundPageFile = null;
    }
  } else {
    if (displayFrameworkWarnings) {
      console.log(`✔️ Application specifies no 'not found (404)' page.`);
    }
  }

  let autoIndex: string[] = server.autoIndex;
  let autoExt: string[] = server.autoExt;

  const serverConfig: PublisherServerConfigNormalized = {
    publicDirPrefix,
    staticItems,
    compression,
    spaFile,
    notFoundPageFile,
    autoExt,
    autoIndex,
  };

  fileContents += `\nexport const serverConfig = ${JSON.stringify(serverConfig, null, 2)};\n`;

  fileContents += '\nexport const contentAssets = new ContentAssets(objectStoreName, contentAssetMetadataMap);';
  fileContents += '\nexport const moduleAssets = new ModuleAssets(moduleAssetsMap);\n';

  fileContents += '\nlet server = null;';
  fileContents += '\nexport function getServer() {' +
    '\n  if (server == null) {' +
    '\n    server = new PublisherServer(serverConfig, contentAssets);' +
    '\n  }' +
    '\n  return server;' +
    '\n}\n';

  fs.writeFileSync('./src/statics.js', fileContents);

  console.log("✅  Wrote static file loader for " + files.length + " file(s).");

  // Copy Types file for static file loader
  try {
    const staticsTypeFile = path.resolve(__dirname, '../../resources/statics.d.ts');
    fs.copyFileSync(staticsTypeFile, './src/statics.d.ts');

    console.log("✅  Wrote static file loader types file statics.d.ts.");
  } catch {
    console.log("⚠️ Notice: could not write static file loader types file statics.d.ts.");
  }

}