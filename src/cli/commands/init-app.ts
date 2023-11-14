import { CommandLineOptions } from "command-line-args";

// This program creates a Fastly Compute JavaScript application
// in a subfolder named compute-js.
// This project can be served using fastly compute serve
// or deployed to a Compute service using fastly compute publish.

import * as child_process from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as url from 'url';

import { AppOptions, IPresetBase } from '../presets/preset-base.js';
import { presets } from '../presets/index.js';

const defaultOptions: AppOptions = {
  rootDir: undefined,
  publicDir: undefined,
  staticDirs: [],
  spa: undefined,
  notFoundPage: '[public-dir]/404.html',
  autoIndex: [ 'index.html', 'index.htm' ],
  autoExt: [ '.html', '.htm' ],
  author: 'you@example.com',
  name: 'compute-js-static-site',
  description: 'Fastly Compute static site',
  serviceId: undefined,
  kvStoreName: undefined,
};

// Current directory of this program that's running.
const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

function processCommandLineArgs(commandLineValues: CommandLineOptions): Partial<AppOptions> {

  // All paths are relative to CWD.

  let preset: string | undefined;
  {
    const presetValue = commandLineValues['preset'];
    if (presetValue == null || typeof presetValue === 'string') {
      preset = presetValue;
    }
  }

  let rootDir: string | undefined;
  let publicDir: string | undefined;
  {
    const rootDirValue = commandLineValues['root-dir'];
    if (rootDirValue == null || typeof rootDirValue === 'string') {
      rootDir = rootDirValue;
    }
    if (rootDir != null) {
      rootDir = path.resolve(rootDir);
    }

    const publicDirValue = commandLineValues['public-dir'];
    if (publicDirValue == null || typeof publicDirValue === 'string') {
      publicDir = publicDirValue;
    }
    if (publicDir != null) {
      publicDir = path.resolve(publicDir);
    }

    // If we don't have a preset, then for backwards compatibility
    // we check if we have public-dir but no root-dir. If that is
    // the case then we use the value public-dir as root-dir.
    if (preset == null && rootDir == null && publicDir != null) {
      rootDir = publicDir;
      publicDir = undefined;
    }

  }

  // Filepaths provided on the command line are always given relative to CWD,
  // so we need to resolve them.

  let staticDirs: string[] | undefined;
  {
    const staticDirsValue = commandLineValues['static-dir'];

    const asArray = Array.isArray(staticDirsValue) ? staticDirsValue : [ staticDirsValue ];
    if (asArray.every((x: any) => typeof x === 'string')) {
      staticDirs = (asArray as string[]).map(x => path.resolve(x));
    }
  }

  let spa: string | undefined;
  {
    const spaValue = commandLineValues['spa'];
    if (spaValue === null) {
      // If 'spa' is provided with a null value, then the flag was provided
      // with no value. Assumed to be './index.html' relative to the public directory.
      spa = '[public-dir]/index.html';
      console.log('--spa provided, but no value specified.  Assuming ' + spa);
    } else if (spaValue == null || typeof spaValue === 'string') {
      spa = spaValue;
    }
  }

  let notFoundPage: string | undefined;
  {
    const notFoundPageValue = commandLineValues['not-found-page'];
    if (notFoundPageValue === null) {
      // If 'spa' is provided with a null value, then the flag was provided
      // with no value. Assumed to be './404.html' relative to the public directory.
      notFoundPage = '[public-dir]/404.html';
      console.log('--not-found-page provided, but no value specified.  Assuming ' + notFoundPage);
    } else if (notFoundPageValue == null || typeof notFoundPageValue === 'string') {
      notFoundPage = notFoundPageValue;
    }
  }

  let autoIndex: string[] | undefined;
  {
    const autoIndexValue = commandLineValues['auto-index'];

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
  }

  let autoExt: string[] = [];
  {
    const autoExtValue = commandLineValues['auto-ext'];

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
  }

  let name: string | undefined;
  {
    const nameValue = commandLineValues['name'];
    if (nameValue == null || typeof nameValue === 'string') {
      name = nameValue;
    }
  }

  let author: string | undefined;
  {
    const authorValue = commandLineValues['author'];
    if (authorValue == null || typeof authorValue === 'string') {
      author = authorValue;
    }
  }

  let description: string | undefined;
  {
    const descriptionValue = commandLineValues['description'];
    if (descriptionValue == null || typeof descriptionValue === 'string') {
      description = descriptionValue;
    }
  }

  let serviceId: string | undefined;
  {
    const serviceIdValue = commandLineValues['service-id'];
    if (serviceIdValue == null || typeof serviceIdValue === 'string') {
      serviceId = serviceIdValue;
    }
  }

  let kvStoreName: string | undefined;
  {
    const kvStoreNameValue = commandLineValues['kv-store-name'];
    if (kvStoreNameValue == null || typeof kvStoreNameValue === 'string') {
      kvStoreName = kvStoreNameValue;
    }
  }

  return {
    rootDir,
    publicDir,
    staticDirs,
    spa,
    notFoundPage,
    autoIndex,
    autoExt,
    name,
    author,
    description,
    serviceId,
    kvStoreName,
  };

}

function pickKeys<TModel extends Record<string, unknown>>(keys: (keyof TModel)[], object: TModel): Partial<TModel> {

  const result: Partial<TModel> = {};

  for (const key of keys) {
    if(object[key] !== undefined) {
      result[key] = object[key];
    }
  }

  return result;

}

const PUBLIC_DIR_TOKEN = '[public-dir]';
function processPublicDirToken(filepath: string, publicDir: string) {
  if (!filepath.startsWith(PUBLIC_DIR_TOKEN)) {
    return filepath;
  }

  const processedPath = '.' + filepath.slice(PUBLIC_DIR_TOKEN.length);
  const resolvedPath = path.resolve(publicDir, processedPath)
  return path.relative(path.resolve(), resolvedPath);
}

export function initApp(commandLineValues: CommandLineOptions) {

  let options: AppOptions = defaultOptions;
  let preset: IPresetBase | null = null;

  const presetName = (commandLineValues['preset'] as string | null) ?? 'none';
  if(presetName !== 'none') {
    const presetClass = presets[presetName];
    if(presetClass == null) {
      console.error('Unknown preset name.');
      console.error("--preset must be one of: none, " + (Object.keys(presets).join(', ')));
      process.exitCode = 1;
      return;
    }
    preset = new presetClass();
  }

  let packageJson;
  try {
    const packageJsonText = fs.readFileSync("./package.json", "utf-8");
    packageJson = JSON.parse(packageJsonText);
  } catch {
    console.log("Can't read/parse package.json in current directory, making no assumptions!");
    packageJson = null;
  }

  // Get the current compute js static publisher version.
  let computeJsStaticPublisherVersion: string | null = null;
  if (packageJson != null) {
    // First try current project's package.json
    computeJsStaticPublisherVersion =
      packageJson.dependencies?.["@fastly/compute-js-static-publish"] ??
      packageJson.devDependencies?.["@fastly/compute-js-static-publish"];

    // This may be a file url if during development
    if (computeJsStaticPublisherVersion != null) {

      if (computeJsStaticPublisherVersion.startsWith('file:')) {
        // this is a relative path from the current directory.
        // we replace it with an absolute path
        const relPath = computeJsStaticPublisherVersion.slice('file:'.length);
        const absPath = path.resolve(relPath);
        computeJsStaticPublisherVersion = 'file:' + absPath;
      }

    }
  }

  if (computeJsStaticPublisherVersion == null) {
    // Also try package.json of the package that contains the currently running program
    // This is used when the program doesn't actually install the package (running via npx).
    const computeJsStaticPublishPackageJsonPath = path.resolve(__dirname, '../../../package.json');
    const computeJsStaticPublishPackageJsonText = fs.readFileSync(computeJsStaticPublishPackageJsonPath, 'utf-8');
    const computeJsStaticPublishPackageJson = JSON.parse(computeJsStaticPublishPackageJsonText);
    computeJsStaticPublisherVersion = computeJsStaticPublishPackageJson?.version;
  }

  if (computeJsStaticPublisherVersion == null) {
    // Unexpected, but if it's still null then we go to a literal
    computeJsStaticPublisherVersion = '^4.0.0';
  }

  const commandLineAppOptions = processCommandLineArgs(commandLineValues);

  type PackageJsonAppOptions = Pick<AppOptions, 'author' | 'name' | 'description'>;

  options = {
    ...options,
    ...(preset != null ? preset.defaultOptions : {}),
    ...pickKeys(['author', 'name', 'description'], (packageJson ?? {}) as PackageJsonAppOptions),
    ...pickKeys(['rootDir', 'publicDir', 'staticDirs', 'spa', 'notFoundPage', 'autoIndex', 'autoExt', 'author', 'name', 'description', 'serviceId', 'kvStoreName'], commandLineAppOptions),
  };

  if(preset != null) {
    if(!preset.check(packageJson, options)) {
      console.log("Failed preset check.");
      process.exitCode = 1;
      return;
    }
  }

  // Webpack now optional as of v4
  const useWebpack = commandLineValues['webpack'] as boolean;

  const COMPUTE_JS_DIR = commandLineValues.output as string;
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
    console.error(`  * ${rootDir} must exist and be a directory.`);
    process.exitCode = 1;
    return;
  }

  // Resolve the public dir as well. If it's not specified, we use the root directory.
  const PUBLIC_DIR = options.publicDir ?? ROOT_DIR;
  const publicDir = path.resolve(PUBLIC_DIR);
  if (!fs.existsSync(publicDir) || !fs.statSync(publicDir).isDirectory()) {
    console.error(`❌ Specified public directory '${PUBLIC_DIR}' does not exist.`);
    console.error(`  * ${publicDir} must exist and be a directory.`);
    process.exitCode = 1;
    return;
  }

  // Public dir must be inside the root dir.
  if (!publicDir.startsWith(rootDir)) {
    console.error(`❌ Specified public directory '${PUBLIC_DIR}' is not under the asset root directory.`);
    console.error(`  * ${publicDir} must be under ${rootDir}`);
    process.exitCode = 1;
    return;
  }

  // Static dirs must be inside the public dir.
  const STATIC_DIRS = options.staticDirs;
  const staticDirs: string[] = [];
  for (const STATIC_DIR of STATIC_DIRS) {
    // For backwards compatibility, these values can start with [public-dir]
    const staticDir = path.resolve(processPublicDirToken(STATIC_DIR, publicDir));
    if (!staticDir.startsWith(publicDir)) {
      console.log(`⚠️ Ignoring static directory '${STATIC_DIR}'`);
      console.log(`  * ${staticDir} is not under ${publicDir}`);
      continue;
    }
    if (!fs.existsSync(staticDir) || !fs.statSync(staticDir).isDirectory()) {
      console.log(`⚠️ Ignoring static directory '${STATIC_DIR}'`);
      console.log(`  * ${staticDir} does not exist or is not a directory.`);
      continue;
    }
    staticDirs.push(staticDir);
  }

  // SPA and Not Found are relative to the asset root dir.

  const SPA = options.spa;
  let spaFilename: string | undefined;
  if (SPA != null) {
    // If it starts with [public-dir], then resolve it relative to public directory.
    spaFilename = path.resolve(processPublicDirToken(SPA, publicDir));
    // At any rate it must exist under the root directory
    if (!spaFilename.startsWith(rootDir)) {
      console.log(`⚠️ Ignoring specified SPA file '${SPA}' as is not under the asset root directory.`);
      console.log(`  * ${spaFilename} is not under ${rootDir}`);
      spaFilename = undefined;
    } else if (!fs.existsSync(spaFilename)) {
      console.log(`⚠️ Ignoring specified SPA file '${SPA}' as it does not exist.`);
      console.log(`  * ${spaFilename} does not exist.`);
      spaFilename = undefined;
    }
  }

  const NOT_FOUND_PAGE = options.notFoundPage;
  let notFoundPageFilename: string | undefined;
  if (NOT_FOUND_PAGE != null) {
    // If it starts with [public-dir], then resolve it relative to public directory.
    notFoundPageFilename = path.resolve(processPublicDirToken(NOT_FOUND_PAGE, publicDir));
    // At any rate it must exist under the root directory
    if (!notFoundPageFilename.startsWith(rootDir)) {
      console.log(`⚠️ Ignoring specified Not Found file '${NOT_FOUND_PAGE}' as is not under the asset root directory.`);
      console.log(`  * ${notFoundPageFilename} is not under ${rootDir}`);
      notFoundPageFilename = undefined;
    } else if (!fs.existsSync(notFoundPageFilename)) {
      console.log(`⚠️ Ignoring specified Not Found file '${NOT_FOUND_PAGE}' as it does not exist.`);
      console.log(`  * ${notFoundPageFilename} does not exist.`);
      notFoundPageFilename = undefined;
    }
  }

  const autoIndex = options.autoIndex;
  const autoExt = options.autoExt;

  const exists = fs.existsSync(computeJsDir);
  if(exists) {
    console.error(`❌ '${COMPUTE_JS_DIR}' directory already exists!`);
    console.error(`  You should not run this command if this directory exists.`);
    console.error(`  If you need to re-scaffold the static publisher, delete the following directory and then try again:`);
    console.error(`  ${computeJsDir}`);
    process.exitCode = 1;
    return;
  }

  const author = options.author;
  const name = options.name;
  const description = options.description;
  const fastlyServiceId = options.serviceId;
  const kvStoreName = options.kvStoreName;

  function rootRelative(itemPath: string | null | undefined) {
    if (itemPath == null) {
      return null;
    }
    const v = path.relative(path.resolve(), itemPath);
    return v.startsWith('..') ? v : './' + v;
  }

  console.log('');
  console.log('Asset Root Dir    :', rootRelative(rootDir));
  console.log('Public Dir        :', rootRelative(publicDir));
  console.log('Static Dir        :', staticDirs.length > 0 ? staticDirs.map(rootRelative) : '(None)');
  console.log('SPA               :', rootRelative(spaFilename) ?? '(None)');
  console.log('404 Page          :', rootRelative(notFoundPageFilename) ?? '(None)');
  console.log('Auto-Index        :', autoIndex.length > 0 ? autoIndex.map(rootRelative) : '(None)')
  console.log('Auto-Ext          :', autoExt.length > 0 ? autoExt.map(rootRelative) : '(None)')
  console.log('name              :', name);
  console.log('author            :', author);
  console.log('description       :', description);
  console.log('Service ID        :', fastlyServiceId ?? '(None)');
  console.log('KV Store Name     :', kvStoreName ?? '(None)');
  console.log('');
  if (useWebpack) {
    console.log('Creating project with Webpack.');
    console.log('');
  }

  console.log("Initializing Compute Application in " + computeJsDir + "...");
  fs.mkdirSync(computeJsDir);
  fs.mkdirSync(path.resolve(computeJsDir, './src'));

  // .gitignore
  const gitIgnoreContent = `\
/node_modules
/bin
/pkg
/src/statics.js
/src/statics.d.ts
/src/statics-metadata.js
/src/statics-metadata.d.ts
/src/static-content
`;
  const gitIgnorePath = path.resolve(computeJsDir, '.gitignore');
  fs.writeFileSync(gitIgnorePath, gitIgnoreContent, "utf-8");

  // package.json
  const packageJsonContent: Record<string, any> = {
    name,
    version: '0.1.0',
    description,
    author,
    type: 'module',
    devDependencies: {
      '@fastly/compute-js-static-publish': computeJsStaticPublisherVersion,
    },
    dependencies: {
      '@fastly/js-compute': '^3.0.0',
    },
    engines: {
      node: '>=18.0.0',
    },
    license: 'UNLICENSED',
    private: true,
    scripts: {
      deploy: 'fastly compute deploy',
      prebuild: 'npx @fastly/compute-js-static-publish --build-static',
      build: 'js-compute-runtime ./src/index.js ./bin/main.wasm'
    },
  };

  if (useWebpack) {
    delete packageJsonContent.type;
    packageJsonContent.devDependencies = {
      ...packageJsonContent.devDependencies,
      'webpack': '^5.75.0',
      'webpack-cli': '^5.0.0',
    };
    packageJsonContent.scripts = {
      ...packageJsonContent.scripts,
      prebuild: 'npx @fastly/compute-js-static-publish --build-static && webpack',
      build: 'js-compute-runtime ./bin/index.js ./bin/main.wasm'
    };
  }

  const packageJsonContentJson = JSON.stringify(packageJsonContent, undefined, 2);
  const packageJsonPath = path.resolve(computeJsDir, 'package.json');
  fs.writeFileSync(packageJsonPath, packageJsonContentJson, "utf-8");

  // fastly.toml

  // language=toml
  const fastlyTomlContent = `\
# This file describes a Fastly Compute package. To learn more visit:
# https://developer.fastly.com/reference/fastly-toml/

authors = [ "${author}" ]
description = "${description}"
language = "javascript"
manifest_version = 2
name = "${name}"
${fastlyServiceId != null ? `service_id = "${fastlyServiceId}"
` : ''}
[scripts]
  build = "npm run build"
  `;

  const fastlyTomlPath = path.resolve(computeJsDir, 'fastly.toml');
  fs.writeFileSync(fastlyTomlPath, fastlyTomlContent, "utf-8");

  // static-publish.rc.js
  const rootDirRel = path.relative(computeJsDir, rootDir);

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

  const staticPublishJsContent = `\
/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Commented items are defaults, feel free to modify and experiment!
// See README for a detailed explanation of the configuration options.

/** @type {import('@fastly/compute-js-static-publish').StaticPublisherConfig} */
const config = {
  rootDir: ${JSON.stringify(rootDirRel)},
  ${(kvStoreName != null ? 'kvStoreName: ' + JSON.stringify(kvStoreName) : '// kvStoreName: false')},
  // excludeDirs: [ './node_modules' ],
  // excludeDotFiles: true,
  // includeWellKnown: true,
  // contentAssetInclusionTest: (filename) => true,
  // contentCompression: [ 'br', 'gzip' ], // For this config value, default is [] if kvStoreName is null. 
  // moduleAssetInclusionTest: (filename) => false,
  // contentTypes: [
  //   { test: /.custom$/, contentType: 'application/x-custom', text: false },
  // ],
  server: {
    publicDirPrefix: ${JSON.stringify(publicDirPrefix)},
    staticItems: ${JSON.stringify(staticItems)},
    // compression: [ 'br', 'gzip' ],
    spaFile: ${JSON.stringify(spaFile)},
    notFoundPageFile: ${JSON.stringify(notFoundPageFile)}, 
    autoExt: ${JSON.stringify(autoExt)},
    autoIndex: ${JSON.stringify(autoIndex)},
  },
};

${useWebpack ? 'module.exports =' : 'export default'} config;
`;

  const staticPublishJsonPath = path.resolve(computeJsDir, 'static-publish.rc.js');
  fs.writeFileSync(staticPublishJsonPath, staticPublishJsContent, "utf-8");

  // Copy resource files

  if (useWebpack) {
    // webpack.config.js
    const webpackConfigJsSrcPath = path.resolve(__dirname, '../../../resources/webpack.config.js');
    const webpackConfigJsPath = path.resolve(computeJsDir, 'webpack.config.js');
    fs.copyFileSync(webpackConfigJsSrcPath, webpackConfigJsPath);
  }

  // src/index.js
  const indexJsSrcPath = path.resolve(__dirname, '../../../resources/index.js');
  const indexJsPath = path.resolve(computeJsDir, './src/index.js');
  fs.copyFileSync(indexJsSrcPath, indexJsPath);

  console.log("🚀 Compute application created!");

  console.log('Installing dependencies...');
  console.log(`npm --prefix ${COMPUTE_JS_DIR} install`);
  child_process.spawnSync('npm', [ '--prefix', COMPUTE_JS_DIR, 'install' ], { stdio: 'inherit' });
  console.log('');

  console.log('');
  console.log('To run your Compute application locally:');
  console.log('');
  console.log('  cd ' + COMPUTE_JS_DIR);
  console.log('  fastly compute serve');
  console.log('');
  console.log('To build and deploy to your Compute service:');
  console.log('');
  console.log('  cd ' + COMPUTE_JS_DIR);
  console.log('  fastly compute publish');
  console.log('');

}
