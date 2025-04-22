/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// This program creates a Fastly Compute JavaScript application
// in a subfolder named compute-js.
// This project can be served using fastly compute serve
// or deployed to a Compute service using fastly compute publish.
import * as child_process from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

import { type CommandLineOptions, type OptionDefinition } from 'command-line-args';

import { dotRelative, rootRelative } from '../../util/files.js';
import { findComputeJsStaticPublisherVersion, type PackageJson } from '../../util/package.js';
import { parseCommandLine } from "../../util/args.js";

function help() {
  console.log(`\

Usage:
  npx @fastly/compute-js-static-publish [options]

Description:
  Scaffold a new Compute app configured for static publishing.

  Note: If run inside a scaffolded project, this tool will automatically enter project
  management mode.

Options:
  --kv-store-name <name>                (required) KV Store name for content storage
  --root-dir <path>                     (required) Path to static content (e.g., ./public)
  -o, --output <dir>                    Output directory for Compute app (default: ./compute-js)
  --static-publisher-working-dir <dir>  Working directory for build artifacts (default: <output>/static-publisher)
  --publish-id <id>                     Advanced. Prefix for KV keys (default: "default")
                                        (default: ./compute-js/static-publisher)

Compute Service Metadata:
  --name <name>                         App name (for fastly.toml)
  --description <text>                  App description (for fastly.toml)
  --author <name/email>                 App author (for fastly.toml)
  --service-id <id>                     (optional) Fastly service ID

Server Config:
  --public-dir <path>                   Base dir for content (default: root-dir)
  --static-dir <path>,<path...>         Directory served with long TTL (can repeat)
  --spa <file>                          SPA fallback file (e.g., /index.html)
  --not-found-page <file>               404 fallback file (e.g., /404.html)
  --auto-index <name>,<name...>         Index filename (e.g., index.html,index.htm)
  --auto-ext <ext>,<ext...>             Automatic extensions (e.g., .html,.htm)

Other:
  --verbose                             Enable verbose output
  -h, --help                            Show help
`);
}

export type InitAppOptions = {
  outputDir: string | undefined,
  rootDir: string | undefined,
  publicDir: string | undefined,
  staticDirs: string[],
  staticPublisherWorkingDir: string | undefined,
  spa: string | undefined,
  notFoundPage: string | undefined,
  autoIndex: string[],
  autoExt: string[],
  name: string | undefined,
  author: string | undefined,
  description: string | undefined,
  serviceId: string | undefined,
  publishId: string | undefined,
  kvStoreName: string | undefined,
};

const defaultOptions: InitAppOptions = {
  outputDir: undefined,
  rootDir: undefined,
  publicDir: undefined,
  staticDirs: [],
  staticPublisherWorkingDir: undefined,
  spa: undefined,
  notFoundPage: '[public-dir]/404.html',
  autoIndex: [ 'index.html', 'index.htm' ],
  autoExt: [ '.html', '.htm' ],
  author: 'you@example.com',
  name: 'compute-js-static-site',
  description: 'Fastly Compute static site',
  serviceId: undefined,
  publishId: undefined,
  kvStoreName: undefined,
};

function buildOptions(
  packageJson: PackageJson | null,
  commandLineOptions: CommandLineOptions,
): InitAppOptions {

  // Applied in this order for proper overriding
  // 1. defaults
  // 2. package.json
  // 3. command-line args

  const options = structuredClone(defaultOptions);

  if (packageJson?.name !== undefined) {
    options.name = packageJson!.name;
  }
  if (packageJson?.author !== undefined) {
    options.author = packageJson!.author;
  }
  if (packageJson?.description !== undefined) {
    options.description = packageJson!.description;
  }

  {
    let outputDir: string | undefined;
    const outputDirValue = commandLineOptions['output'];
    if (outputDirValue == null || typeof outputDirValue === 'string') {
      outputDir = outputDirValue;
    }
    if (outputDir !== undefined) {
      options.outputDir = outputDir;
    }
  }

  {
    let rootDir: string | undefined;
    const rootDirValue = commandLineOptions['root-dir'];
    if (rootDirValue == null || typeof rootDirValue === 'string') {
      rootDir = rootDirValue;
    }
    if (rootDir !== undefined) {
      options.rootDir = rootDir;
    }
  }

  {
    let publicDir: string | undefined;
    const publicDirValue = commandLineOptions['public-dir'];
    if (publicDirValue == null || typeof publicDirValue === 'string') {
      publicDir = publicDirValue;
    }
    if (publicDir !== undefined) {
      options.publicDir = publicDir;
    }
  }

  {
    let staticDirs: string[] | undefined;
    const staticDirsValue = commandLineOptions['static-dir'];

    const asArray = Array.isArray(staticDirsValue) ? staticDirsValue : [ staticDirsValue ];
    if (asArray.every((x: any) => typeof x === 'string')) {
      staticDirs = asArray;
    }
    if (staticDirs !== undefined) {
      options.staticDirs = staticDirs;
    }
  }

  {
    let staticPublisherWorkingDir: string | undefined;
    const staticPublisherWorkingDirValue = commandLineOptions['static-publisher-working-dir'];
    if (staticPublisherWorkingDirValue == null || typeof staticPublisherWorkingDirValue === 'string') {
      staticPublisherWorkingDir = staticPublisherWorkingDirValue;
    }
    if (staticPublisherWorkingDir !== undefined) {
      options.staticPublisherWorkingDir = staticPublisherWorkingDir;
    }
  }

  {
    let spa: string | undefined;
    const spaValue = commandLineOptions['spa'];
    if (spaValue === null) {
      // If 'spa' is provided with a null value, then the flag was provided
      // with no value. Assumed to be './index.html' relative to the public directory.
      spa = '[public-dir]/index.html';
      console.log('--spa provided, but no value specified.  Assuming ' + spa);
    } else if (spaValue == null || typeof spaValue === 'string') {
      spa = spaValue;
    }
    if (spa !== undefined) {
      options.spa = spa;
    }
  }

  {
    let notFoundPage: string | undefined;
    const notFoundPageValue = commandLineOptions['not-found-page'];
    if (notFoundPageValue === null) {
      // If 'spa' is provided with a null value, then the flag was provided
      // with no value. Assumed to be './404.html' relative to the public directory.
      notFoundPage = '[public-dir]/404.html';
      console.log('--not-found-page provided, but no value specified.  Assuming ' + notFoundPage);
    } else if (notFoundPageValue == null || typeof notFoundPageValue === 'string') {
      notFoundPage = notFoundPageValue;
    }
    if (notFoundPage !== undefined) {
      options.notFoundPage = notFoundPage;
    }
  }

  {
    let autoIndex: string[] | undefined;
    const autoIndexValue = commandLineOptions['auto-index'];

    const asArray = Array.isArray(autoIndexValue) ? autoIndexValue : [ autoIndexValue ];
    if (asArray.every((x: any) => typeof x === 'string')) {

      autoIndex = (asArray as string[]).reduce<string[]>((acc, entry) => {

        const segments = entry
          .split(',')
          .map(x => x.trim())
          .filter(x => Boolean(x));

        for (const segment of segments) {
          acc.push(segment);
        }

        return acc;
      }, []);

    }
    if (autoIndex !== undefined) {
      options.autoIndex = autoIndex;
    }
  }

  {
    let autoExt: string[] = [];
    const autoExtValue = commandLineOptions['auto-ext'];

    const asArray = Array.isArray(autoExtValue) ? autoExtValue : [ autoExtValue ];
    if (asArray.every((x: any) => typeof x === 'string')) {

      autoExt = (asArray as string[]).reduce<string[]>((acc, entry) => {

        const segments = entry
          .split(',')
          .map(x => x.trim())
          .filter(x => Boolean(x))
          .map(x => !x.startsWith('.') ? '.' + x : x);

        for (const segment of segments) {
          acc.push(segment);
        }

        return acc;
      }, []);

    }
    if (autoExt !== undefined) {
      options.autoExt = autoExt;
    }
  }

  {
    let name: string | undefined;
    const nameValue = commandLineOptions['name'];
    if (nameValue == null || typeof nameValue === 'string') {
      name = nameValue;
    }
    if (name !== undefined) {
      options.name = name;
    }
  }

  {
    let author: string | undefined;
    const authorValue = commandLineOptions['author'];
    if (authorValue == null || typeof authorValue === 'string') {
      author = authorValue;
    }
    if (author !== undefined) {
      options.author = author;
    }
  }

  {
    let description: string | undefined;
    const descriptionValue = commandLineOptions['description'];
    if (descriptionValue == null || typeof descriptionValue === 'string') {
      description = descriptionValue;
    }
    if (description !== undefined) {
      options.description = description;
    }
  }

  {
    let serviceId: string | undefined;
    const serviceIdValue = commandLineOptions['service-id'];
    if (serviceIdValue == null || typeof serviceIdValue === 'string') {
      serviceId = serviceIdValue;
    }
    if (serviceId !== undefined) {
      options.serviceId = serviceId;
    }
  }

  {
    let publishId: string | undefined;
    const publishIdValue = commandLineOptions['publish-id'];
    if (publishIdValue == null || typeof publishIdValue === 'string') {
      publishId = publishIdValue;
    }
    if (publishId !== undefined) {
      options.publishId = publishId;
    }
  }

  {
    let kvStoreName: string | undefined;
    const kvStoreNameValue = commandLineOptions['kv-store-name'];
    if (kvStoreNameValue == null || typeof kvStoreNameValue === 'string') {
      kvStoreName = kvStoreNameValue;
    }
    if (kvStoreName !== undefined) {
      options.kvStoreName = kvStoreName;
    }
  }

  return options;

}

const PUBLIC_DIR_TOKEN = '[public-dir]';
function processPublicDirToken(filepath: string, publicDir: string) {
  if (!filepath.startsWith(PUBLIC_DIR_TOKEN)) {
    return path.resolve(filepath);
  }

  const processedPath = '.' + filepath.slice(PUBLIC_DIR_TOKEN.length);
  return path.resolve(publicDir, processedPath)
}

export async function action(actionArgs: string[]) {

  const optionDefinitions: OptionDefinition[] = [
    { name: 'verbose', type: Boolean },

    // Required. The name of a Fastly KV Store to hold the content assets.
    // It is also added to the fastly.toml that is generated.
    { name: 'kv-store-name', type: String, },

    // Output directory. "Required" (if not specified, then defaultValue is used).
    { name: 'output', alias: 'o', type: String, defaultValue: './compute-js', },

    // Name of the application, to be inserted into fastly.toml
    { name: 'name', type: String, },

    // Description of the application, to be inserted into fastly.toml
    { name: 'description', type: String, },

    // Name of the author, to be inserted into fastly.toml
    { name: 'author', type: String, },

    // Fastly Service ID to be added to the fastly.toml that is generated.
    { name: 'service-id', type: String },

    // Required. The 'root' directory for the publishing.
    // All assets are expected to exist under this root. Required.
    // For backwards compatibility, if this value is not provided,
    // then the value of 'public-dir' is used.
    { name: 'root-dir', type: String, },

    // Publish ID to be used as a prefix for all KV Store entries.
    // If not provided, the default value of 'default' is used.
    { name: 'publish-id', type: String, },

    // The 'static publisher working directory' is the directory under the Compute
    // application where asset files are written in preparation for upload to the
    // KV Store and for serving for local mode.
    { name: 'static-publisher-working-dir', type: String, },

    // The 'public' directory. The Publisher Server will
    // resolve requests relative to this directory. If not specified,
    // defaults to the same value as 'root-dir'. See README for
    // details.
    { name: 'public-dir', type: String, },

    // Directories to specify as containing 'static' files. The
    // Publisher Server will serve files from these directories
    // with a long TTL.
    { name: 'static-dir', type: String, multiple: true, },

    // Path to a file to be used to serve in a SPA application.
    // The Publisher Server will serve this file with a 200 status code
    // when the request doesn't match a known file, and the accept
    // header includes text/html. You may use the '[public-dir]' token
    // if you wish to specify this as a relative path from the 'public-dir'.
    { name: 'spa', type: String, },

    // Path to a file to be used to serve as a 404 not found page.
    // The Publisher Server will serve this file with a 404 status code
    // when the request doesn't match a known file, and the accept
    // header includes text/html. You may use the '[public-dir]' token
    // if you wish to specify this as a relative path from the 'public-dir'.
    { name: 'not-found-page', type: String, },

    // List of files to automatically use as index, for example, index.html,index.htm
    // If a request comes in but the route does not exist, we check the route
    // plus a slash plus the items in this array.
    { name: 'auto-index', type: String, multiple: true, },

    // List of extensions to apply to a path name, for example, if
    // http://example.com/about is requested, we can respond with http://example.com/about.html
    { name: 'auto-ext', type: String, multiple: true, },
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

  let packageJson;
  try {
    const packageJsonText = fs.readFileSync("./package.json", "utf-8");
    packageJson = JSON.parse(packageJsonText) as PackageJson;
  } catch {
    console.log("Can't read/parse package.json in current directory, making no assumptions!");
    packageJson = null;
  }

  const options = buildOptions(
    packageJson,
    parsed.commandLineOptions,
  );

  const COMPUTE_JS_DIR = options.outputDir;
  if (COMPUTE_JS_DIR == null) {
    console.error("❌ required parameter --output not provided.");
    process.exitCode = 1;
    return;
  }
  const computeJsDir = path.resolve(COMPUTE_JS_DIR);

  // Resolve the root dir, relative to current directory, and make sure it exists.
  const ROOT_DIR = options.rootDir;
  if (ROOT_DIR == null) {
    console.error("❌ required parameter --root-dir not provided.");
    process.exitCode = 1;
    return;
  }
  const rootDir = path.resolve(ROOT_DIR);
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    console.error(`❌ Specified root directory '${ROOT_DIR}' does not exist.`);
    console.error(`  * ${rootRelative(rootDir)} must exist and be a directory.`);
    process.exitCode = 1;
    return;
  }

  // Resolve the public dir as well. If it's not specified, we use the root directory.
  const PUBLIC_DIR = options.publicDir ?? ROOT_DIR;
  const publicDir = path.resolve(PUBLIC_DIR);
  if (!fs.existsSync(publicDir) || !fs.statSync(publicDir).isDirectory()) {
    console.error(`❌ Specified public directory '${PUBLIC_DIR}' does not exist.`);
    console.error(`  * ${rootRelative(publicDir)} must exist and be a directory.`);
    process.exitCode = 1;
    return;
  }

  // Public dir must be inside the root dir.
  if (!publicDir.startsWith(rootDir)) {
    console.error(`❌ Specified public directory '${PUBLIC_DIR}' is not under the asset root directory.`);
    console.error(`  * ${rootRelative(publicDir)} must be under ${rootRelative(rootDir)}`);
    process.exitCode = 1;
    return;
  }

  // Static dirs must be inside the public dir.
  const STATIC_DIRS = options.staticDirs;
  const staticDirs: string[] = [];
  for (const STATIC_DIR of STATIC_DIRS) {
    // For backwards compatibility, these values can start with [public-dir]
    const staticDir = processPublicDirToken(STATIC_DIR, publicDir);
    if (!staticDir.startsWith(publicDir)) {
      console.log(`⚠️ Ignoring static directory '${STATIC_DIR}'`);
      console.log(`  * ${rootRelative(staticDir)} is not under ${rootRelative(publicDir)}`);
      continue;
    }
    if (!fs.existsSync(staticDir) || !fs.statSync(staticDir).isDirectory()) {
      console.log(`⚠️ Ignoring static directory '${STATIC_DIR}'`);
      console.log(`  * ${rootRelative(staticDir)} does not exist or is not a directory.`);
      continue;
    }
    staticDirs.push(staticDir);
  }

  // Static Publisher Working Root Dir must be under the current dir
  // This comes in relative to cwd.
  const STATIC_PUBLISHER_WORKING_DIR = options.staticPublisherWorkingDir ??
    path.resolve(computeJsDir, './static-publisher');
  const staticPublisherWorkingDir = path.resolve(STATIC_PUBLISHER_WORKING_DIR);
  if (
    !staticPublisherWorkingDir.startsWith(computeJsDir) ||
    staticPublisherWorkingDir === computeJsDir ||
    staticPublisherWorkingDir === path.resolve(computeJsDir, './bin') ||
    staticPublisherWorkingDir === path.resolve(computeJsDir, './pkg') ||
    staticPublisherWorkingDir === path.resolve(computeJsDir, './src') ||
    staticPublisherWorkingDir === path.resolve(computeJsDir, './node_modules')
  ) {
    console.error(`❌ Specified static publisher working directory '${rootRelative(staticPublisherWorkingDir)}' must be under ${rootRelative(computeJsDir)}.`);
    console.error(`  It also must not be bin, pkg, src, or node_modules.`);
    process.exitCode = 1;
    return;
  }

  // SPA and Not Found are relative to the asset root dir.

  const SPA = options.spa;
  let spaFilename: string | undefined;
  if (SPA != null) {
    // If it starts with [public-dir], then resolve it relative to public directory.
    spaFilename = processPublicDirToken(SPA, publicDir);
    // At any rate it must exist under the root directory
    if (!spaFilename.startsWith(rootDir)) {
      console.log(`⚠️ Ignoring specified SPA file '${SPA}' as is not under the asset root directory.`);
      console.log(`  * ${rootRelative(spaFilename)} is not under ${rootRelative(rootDir)}`);
      spaFilename = undefined;
    } else if (!fs.existsSync(spaFilename)) {
      console.log(`⚠️ Warning: Ignoring specified SPA file '${SPA}' does not exist.`);
      console.log(`  * ${rootRelative(spaFilename)} does not exist.`);
    }
  }

  const NOT_FOUND_PAGE = options.notFoundPage;
  let notFoundPageFilename: string | undefined;
  if (NOT_FOUND_PAGE != null) {
    // If it starts with [public-dir], then resolve it relative to public directory.
    notFoundPageFilename = processPublicDirToken(NOT_FOUND_PAGE, publicDir);
    // At any rate it must exist under the root directory
    if (!notFoundPageFilename.startsWith(rootDir)) {
      console.log(`⚠️ Ignoring specified Not Found file '${NOT_FOUND_PAGE}' as is not under the asset root directory.`);
      console.log(`  * ${rootRelative(notFoundPageFilename)} is not under ${rootRelative(rootDir)}`);
      notFoundPageFilename = undefined;
    } else if (!fs.existsSync(notFoundPageFilename)) {
      console.log(`⚠️ Warning: Ignoring specified Not Found file '${NOT_FOUND_PAGE}' as it does not exist.`);
      console.log(`  * ${rootRelative(notFoundPageFilename)} does not exist.`);
    }
  }

  const autoIndex = options.autoIndex;
  const autoExt = options.autoExt;

  const exists = fs.existsSync(computeJsDir);
  if(exists) {
    console.error(`❌ '${COMPUTE_JS_DIR}' directory already exists!`);
    console.error(`  You should not run this command if this directory exists.`);
    console.error(`  If you need to re-scaffold the static publisher Compute App,`);
    console.error(`  delete the following directory and then try again:`);
    console.error(`  ${rootRelative(computeJsDir)}`);
    process.exitCode = 1;
    return;
  }

  const author = options.author;
  const name = options.name;
  const description = options.description;
  const fastlyServiceId = options.serviceId;
  const kvStoreName = options.kvStoreName;
  if (kvStoreName == null) {
    console.error(`❌ required parameter --kv-store-name not provided.`);
    process.exitCode = 1;
    return;
  }
  let publishId = options.publishId;
  if (publishId == null) {
    publishId = 'default';
  }

  const defaultCollectionName = 'live';

  console.log('');
  console.log('Compute Application Settings');
  console.log('----------------------------');
  console.log('Compute Application Output Dir :', rootRelative(computeJsDir));
  console.log('name                           :', name);
  console.log('author                         :', author);
  console.log('description                    :', description);
  console.log('Service ID                     :', fastlyServiceId ?? '(None)');
  console.log('KV Store Name                  :', kvStoreName);
  console.log('Default Collection Name        :', defaultCollectionName);
  console.log('Publish ID                     :', publishId);

  console.log('');
  console.log('Publish Settings');
  console.log('----------------');
  console.log('Publish Root Dir               :', rootRelative(rootDir));
  console.log('Publisher Working Dir          :', rootRelative(staticPublisherWorkingDir));

  console.log('');
  console.log('Publisher Server Settings');
  console.log('-------------------------');
  console.log('Server Public Dir              :', rootRelative(publicDir));
  console.log('SPA                            :', spaFilename != null ? rootRelative(spaFilename) : '(None)');
  console.log('404 Page                       :', notFoundPageFilename != null ? rootRelative(notFoundPageFilename) : '(None)');
  console.log('Auto-Index                     :', autoIndex.length > 0 ? autoIndex : '(None)')
  console.log('Auto-Ext                       :', autoExt.length > 0 ? autoExt : '(None)')
  console.log('Static Files Dir               :', staticDirs.length > 0 ? staticDirs.map(rootRelative) : '(None)');

  console.log('');

  console.log("Initializing Compute Application in " + computeJsDir + "...");
  fs.mkdirSync(computeJsDir);
  fs.mkdirSync(path.resolve(computeJsDir, './src'));

  const resourceFiles: Record<string, string> = {};

  // .gitignore
  resourceFiles['.gitignore'] = `\
/node_modules
/bin
/pkg
/${path.relative(computeJsDir, staticPublisherWorkingDir)}
`;

  // package.json
  const computeJsStaticPublisherVersion = findComputeJsStaticPublisherVersion(packageJson);
  resourceFiles['package.json'] = JSON.stringify({
    name,
    version: '0.1.0',
    description,
    author,
    type: 'module',
    devDependencies: {
      "@fastly/cli": "^11.2.0",
      '@fastly/compute-js-static-publish': computeJsStaticPublisherVersion,
    },
    dependencies: {
      '@fastly/js-compute': '^3.26.0',
    },
    engines: {
      node: '>=20.11.0',
    },
    private: true,
    scripts: {
      'dev:publish': 'npx @fastly/compute-js-static-publish publish-content --local',
      'dev:start': 'fastly compute serve',
      'fastly:deploy': 'fastly compute publish',
      'fastly:publish': 'npx @fastly/compute-js-static-publish publish-content',
      'build': 'js-compute-runtime ./src/index.js ./bin/main.wasm'
    },
  }, undefined, 2);

  // fastly.toml
  const localServerKvStorePath = dotRelative(computeJsDir, path.resolve(staticPublisherWorkingDir, 'kvstore.json'));
  resourceFiles['fastly.toml'] = /* language=text */ `\
# This file describes a Fastly Compute package. To learn more visit:
# https://developer.fastly.com/reference/fastly-toml/

authors = [ "${author}" ]
description = "${description}"
language = "javascript"
manifest_version = 3
name = "${name}"
${fastlyServiceId != null ? `service_id = "${fastlyServiceId}"\n` : ''}
[scripts]
build = "npm run build"

[local_server.kv_stores]
${kvStoreName} = { file = "${localServerKvStorePath}", format = "json" }

[setup.kv_stores.${kvStoreName}]
`;

  // kvstore.json
  resourceFiles[localServerKvStorePath] = '{}';

  // static-publish.rc.js
  resourceFiles['static-publish.rc.js'] = `\
/*
 * Generated by @fastly/compute-js-static-publish.
 */

/** @type {import('@fastly/compute-js-static-publish').StaticPublishRc} */
const rc = {
  kvStoreName: ${JSON.stringify(kvStoreName)},
  publishId: ${JSON.stringify(publishId)},
  defaultCollectionName: ${JSON.stringify(defaultCollectionName)},
  staticPublisherWorkingDir: ${JSON.stringify(dotRelative(computeJsDir, staticPublisherWorkingDir))},
};

export default rc;
`;

  // publish-content.config.js
  // publicDirPrefix -- if public dir is deeper than the root dir, then
  // public dir is used as a prefix to drill into asset names.
  // e.g.,
  // root dir   : /path/to/root
  // public dir : /path/to/root/public
  // then publicDirPrefix = /public

  // We've already established publicDir.startsWith(rootDir)
  let publicDirPrefix = '';
  if (rootDir !== publicDir) {
    publicDirPrefix = rootDir.slice(rootDir.length);
  }

  // staticItems - specified as prefixes, relative to publicDir
  const staticItems: string[] = [];
  for (const staticDir of staticDirs) {
    // We've already established staticDir.startsWith(publicDir)
    let staticItem = staticDir.slice(publicDir.length);
    if (!staticItem.endsWith('/')) {
      // Ending with a slash denotes that this is a directory.
      staticItem = staticItem + '/';
    }
    staticItems.push(staticItem);
  }

  // spaFile - asset key of spa file
  let spaFile: string | false = false;
  if (spaFilename != null) {
    // We've already established spaFilename.startsWith(rootDir)
    // and that it exists
    spaFile = spaFilename.slice(rootDir.length);
  }

  let notFoundPageFile: string | false = false;
  if(notFoundPageFilename != null) {
    // We've already established notFoundPageFilename.startsWith(rootDir)
    // and that it exists
    notFoundPageFile = notFoundPageFilename.slice(rootDir.length);
  }

  resourceFiles['publish-content.config.js'] = `\
/*
 * Generated by @fastly/compute-js-static-publish.
 */

// Commented items are defaults, feel free to modify and experiment!
// See README for a detailed explanation of the configuration options.

/** @type {import('@fastly/compute-js-static-publish').PublishContentConfig} */
const config = {
  rootDir: ${JSON.stringify(dotRelative(computeJsDir, rootDir))},
  // excludeDirs: [ './node_modules' ],
  // excludeDotFiles: true,
  // includeWellKnown: true,
  // kvStoreAssetInclusionTest: (assetKey) => true,
  // contentCompression: [ 'br', 'gzip' ], 
  // contentTypes: [
  //   { test: /.custom$/, contentType: 'application/x-custom', text: false },
  // ],
  
  // Server settings are saved to the KV Store per collection
  server: {
    publicDirPrefix: ${JSON.stringify(publicDirPrefix)},
    staticItems: ${JSON.stringify(staticItems)},
    allowedEncodings: [ 'br', 'gzip' ],
    spaFile: ${JSON.stringify(spaFile)},
    notFoundPageFile: ${JSON.stringify(notFoundPageFile)}, 
    autoExt: ${JSON.stringify(autoExt)},
    autoIndex: ${JSON.stringify(autoIndex)},
  },
};

export default config;
`;

  // src/index.js
  resourceFiles['./src/index.js'] = /* language=text */ `\
/// <reference types="@fastly/js-compute" />
import { env } from 'fastly:env';
import { PublisherServer } from '@fastly/compute-js-static-publish';
import rc from '../static-publish.rc.js';
const publisherServer = PublisherServer.fromStaticPublishRc(rc);

// eslint-disable-next-line no-restricted-globals
addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));
async function handleRequest(event) {

  console.log('FASTLY_SERVICE_VERSION', env('FASTLY_SERVICE_VERSION'));

  const request = event.request;

  const response = await publisherServer.serveRequest(request);
  if (response != null) {
    return response;
  }

  // Do custom things here!
  // Handle API requests, serve non-static responses, etc.

  return new Response('Not found', { status: 404 });
}
`;

  // Write out the files
  for (const [filename, content] of Object.entries(resourceFiles)) {
    const filePath = path.resolve(computeJsDir, filename);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  console.log("🚀 Compute application created!");

  console.log('Installing dependencies...');
  console.log(`npm --prefix ${COMPUTE_JS_DIR} install`);
  child_process.spawnSync('npm', [ '--prefix', COMPUTE_JS_DIR, 'install' ], { stdio: 'inherit' });
  console.log('');

  console.log('');
  console.log('To run your Compute application locally:');
  console.log('');
  console.log('  cd ' + COMPUTE_JS_DIR);
  console.log('  npm run dev:publish');
  console.log('  npm run dev:start');
  console.log('');
  console.log('To build and deploy to your Compute service:');
  console.log('');
  console.log('  cd ' + COMPUTE_JS_DIR);
  console.log('  npm run fastly:deploy');
  console.log('  npm run fastly:publish');
  console.log('');
}
