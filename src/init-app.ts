import { CommandLineOptions } from "command-line-args";

// This program creates a Compute@Edge JavaScript application
// in a subfolder named compute-js.
// This project can be served using fastly compute serve
// or deployed to a Compute@Edge service using fastly compute publish.

import * as child_process from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as url from 'url';

import { AppOptions, IPresetBase } from './presets/preset-base.js';
import { presets } from './presets/index.js';

const defaultOptions: AppOptions = {
  'public-dir': undefined,
  'static-dir': undefined,
  spa: undefined,
  'not-found-page': '[public-dir]/404.html',
  'auto-index': [ 'index.html', 'index.htm' ],
  'auto-ext': [ '.html', '.htm' ],
  author: 'you@example.com',
  name: 'compute-js-static-site',
  description: 'Compute@Edge static site',
  'service-id': undefined,
};

function pickKeys(keys: string[], object: Record<string, any>): Record<string, any> {

  const result: Record<string, any> = {};

  for (const key of keys) {
    if(object[key] !== undefined) {
      result[key] = object[key];
    }
  }

  return result;

}

function applyPublicDir(optionValue: string | null | undefined, publicDir: string) {
  if(optionValue == null) {
    return optionValue;
  }
  return optionValue.replace('[public-dir]', publicDir);
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

  options = {
    ...options,
    ...(preset != null ? preset.defaultOptions : {}),
    ...pickKeys(['author', 'name', 'description'], packageJson ?? {}),
    ...pickKeys(['public-dir', 'static-dir', 'spa', 'not-found-page', 'auto-index', 'auto-ext', 'author', 'name', 'description', 'service-id'], commandLineValues)
  };

  if(preset != null) {
    if(!preset.check(packageJson, options)) {
      console.log("Failed preset check.");
      process.exitCode = 1;
      return;
    }
  }

  const COMPUTE_JS_DIR = commandLineValues.output as string;
  const computeJsDir = path.resolve(COMPUTE_JS_DIR);

  const PUBLIC_DIR = options['public-dir'];
  if(PUBLIC_DIR == null) {
    console.error("❌ required parameter --public-dir not provided.");
    process.exitCode = 1;
    return;
  }
  const publicDir = path.resolve(PUBLIC_DIR);

  const BUILD_STATIC_DIR = applyPublicDir(options['static-dir'], PUBLIC_DIR);
  const buildStaticDir = BUILD_STATIC_DIR != null ? path.resolve(BUILD_STATIC_DIR) : null;

  const spa = applyPublicDir(options['spa'], PUBLIC_DIR);
  const notFoundPage = applyPublicDir(options['not-found-page'], PUBLIC_DIR);

  const autoIndex = options['auto-index'];
  const autoExt = options['auto-ext'];

  let spaFilename = spa;

  // Specifically check for null instead of undefined
  if(spa === null) {
    spaFilename = path.resolve(publicDir, './index.html');
    let rel = path.relative(path.resolve(), spaFilename);
    if(!rel.startsWith('..')) {
      rel = './' + rel;
    }
    console.log('--spa provided with no value, assuming ' + rel);
  }

  if(spaFilename != null) {
    spaFilename = path.resolve(spaFilename);
    if(!spaFilename.startsWith(publicDir)) {
      console.error(`❌ SPA file '${spaFilename}' not inside public directory!`);
      process.exitCode = 1;
      return;
    }
  }

  let notFoundPageFilename = notFoundPage;

  // Specifically check for null instead of undefined
  if(notFoundPage === null) {
    notFoundPageFilename = path.resolve(publicDir, './404.html');
    let rel = path.relative(path.resolve(), notFoundPageFilename);
    if(!rel.startsWith('..')) {
      rel = './' + rel;
    }
    console.log('--not-found-page provided with no value, assuming ' + rel);
  }

  if(notFoundPageFilename != null) {
    notFoundPageFilename = path.resolve(notFoundPageFilename);
    if(!notFoundPageFilename.startsWith(publicDir)) {
      console.error(`❌ --not-found-page file '${notFoundPageFilename}' not inside public directory!`);
      process.exitCode = 1;
      return;
    }
  }

  const exists = fs.existsSync(computeJsDir);
  if(exists) {
    console.error(`❌ '${COMPUTE_JS_DIR}' directory already exists!`);
    process.exitCode = 1;
    return;
  }

  const author = options['author'];
  const name = options['name'];
  const description = options['description'];
  const fastlyServiceId = options['service-id'];

  let spaRel: string | null = spaFilename != null ? path.relative(path.resolve(), spaFilename) : null;
  if(spaRel != null && !spaRel.startsWith('..')) {
    spaRel = './' + spaRel;
  }

  let notFoundRel: string | null = notFoundPageFilename != null ? path.relative(path.resolve(), notFoundPageFilename) : null;
  if(notFoundRel != null && !notFoundRel.startsWith('..')) {
    notFoundRel = './' + notFoundRel;
  }

  console.log('');
  console.log('Public Dir  :', PUBLIC_DIR);
  console.log('Static Dir  :', BUILD_STATIC_DIR ?? '(None)');
  console.log('SPA         :', spaRel ?? '(None)');
  console.log('404 Page    :', notFoundRel ?? '(None)');
  console.log('Auto-Index  :', autoIndex ?? '(None)')
  console.log('Auto-Ext    :', autoExt ?? '(None)')
  console.log('name        :', name);
  console.log('author      :', author);
  console.log('description :', description);
  console.log('Service ID  :', fastlyServiceId ?? '(None)');
  console.log('');

  console.log("Initializing Compute@Edge Application in " + computeJsDir + "...");
  fs.mkdirSync(computeJsDir);
  fs.mkdirSync(path.resolve(computeJsDir, './src'));

  // .gitignore
  const gitIgnoreContent = `\
/node_modules
/bin
/pkg
/src/statics.js
`;
  const gitIgnorePath = path.resolve(computeJsDir, '.gitignore');
  fs.writeFileSync(gitIgnorePath, gitIgnoreContent, "utf-8");

  // package.json

  // language=JSON
  const packageJsonContent = `\
{
    "name": ${JSON.stringify(name)},
    "description": ${JSON.stringify(description)},
    "author": ${JSON.stringify(author)},
    "devDependencies": {
        "@fastly/expressly": "^1.0.0-alpha.7",
        "buffer": "^6.0.3",
        "webpack": "^5.64.0",
        "webpack-cli": "^4.9.1"
    },
    "dependencies": {
        "@fastly/js-compute": "^0.5.12"
    },
    "engines": {
        "node": ">=16.0.0"
    },
    "license": "MIT",
    "private": true,
    "main": "src/index.js",
    "scripts": {
        "deploy": "fastly compute deploy"
    },
    "version": "0.2.1"
}
`;

  const packageJsonPath = path.resolve(computeJsDir, 'package.json');
  fs.writeFileSync(packageJsonPath, packageJsonContent, "utf-8");

  // fastly.toml

  // language=toml
  const fastlyTomlContent = `\
# This file describes a Fastly Compute@Edge package. To learn more visit:
# https://developer.fastly.com/reference/fastly-toml/

authors = [ "${author}" ]
description = "${description}"
language = "javascript"
manifest_version = 2
name = "${name}"
${fastlyServiceId != null ? `service_id = "${fastlyServiceId}"
` : ''}
[scripts]
  build = "npx @fastly/compute-js-static-publish --build-static && npx webpack && npx js-compute-runtime ./bin/index.js ./bin/main.wasm"
`;

  const fastlyTomlPath = path.resolve(computeJsDir, 'fastly.toml');
  fs.writeFileSync(fastlyTomlPath, fastlyTomlContent, "utf-8");

  // static-publish.rc.js
  const publicDirRel = path.relative(computeJsDir, publicDir);

  const staticDirs = [];
  if (buildStaticDir != null) {
    staticDirs.push(buildStaticDir);
  }

  const staticDirsRel = [];
  for (const staticDir of staticDirs) {
    const rel = path.relative(publicDir, staticDir);
    if(rel.startsWith('../')) {
      // we can't have a path outside the public dir, so we ignore it
      console.warn(`Specified static dir '${staticDir}' is not inside public directory, ignoring...`);
      continue;
    }
    staticDirsRel.push('./' + rel);
  }

  let spaFileRel: string | false = false;
  if(spaFilename != null) {
    spaFileRel = '/' + path.relative(publicDir, spaFilename);
  }

  let notFoundFileRel: string | false = false;
  if(notFoundPageFilename != null) {
    notFoundFileRel = '/' + path.relative(publicDir, notFoundPageFilename);
  }

  const staticPublishJsContent = `\
module.exports = {
  publicDir: ${JSON.stringify(publicDirRel)},
  excludeDirs: [ './node_modules' ],
  includeDirs: [ './.well-known' ],
  staticDirs: ${JSON.stringify(staticDirsRel)},
  spa: ${JSON.stringify(spaFileRel)},
  notFoundPage: ${JSON.stringify(notFoundFileRel)},
  autoIndex: ${JSON.stringify(autoIndex)},
  autoExt: ${JSON.stringify(autoExt)},
};`;

  const staticPublishJsonPath = path.resolve(computeJsDir, 'static-publish.rc.js');
  fs.writeFileSync(staticPublishJsonPath, staticPublishJsContent, "utf-8");

  // Copy resource files
  const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

  // webpack.config.js
  const webpackConfigJsSrcPath = path.resolve(__dirname, '../resources/webpack.config.js');
  const webpackConfigJsPath = path.resolve(computeJsDir, 'webpack.config.js');
  fs.copyFileSync(webpackConfigJsSrcPath, webpackConfigJsPath);

  // src/index.js
  const indexJsSrcPath = path.resolve(__dirname, '../resources/index.js');
  const indexJsPath = path.resolve(computeJsDir, './src/index.js');
  fs.copyFileSync(indexJsSrcPath, indexJsPath);

  console.log("🚀 Compute@Edge application created!");

  console.log('Installing dependencies...');
  console.log(`npm --prefix ${COMPUTE_JS_DIR} install`);
  child_process.spawnSync('npm', [ '--prefix', COMPUTE_JS_DIR, 'install' ], { stdio: 'inherit' });
  console.log('');

  console.log('');
  console.log('To run your Compute@Edge application locally:');
  console.log('');
  console.log('  cd ' + COMPUTE_JS_DIR);
  console.log('  fastly compute serve');
  console.log('');
  console.log('To build and deploy to your Compute@Edge service:');
  console.log('');
  console.log('  cd ' + COMPUTE_JS_DIR);
  console.log('  fastly compute publish');
  console.log('');

}
