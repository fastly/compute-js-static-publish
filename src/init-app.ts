import { CommandLineOptions } from "command-line-args";

// This program creates a Compute@Edge JavaScript application
// in a subfolder named compute-js.
// This project can be served using fastly compute serve
// or deployed to a Compute@Edge service using fastly compute publish.

import * as child_process from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as url from 'url';

export function initApp(commandLineValues: CommandLineOptions) {

  let assumeCreateReactApp = false;
  if (commandLineValues['public-dir'] === undefined &&
    commandLineValues['static-dir'] === undefined
  ) {
    console.log("--public-dir and --static-dir not provided, assuming create-react-app.");
    console.log("Using --public-dir=./build and --static-dir=./build/static");
    assumeCreateReactApp = true;
    commandLineValues['public-dir'] = './build';
    commandLineValues['static-dir'] = './build/static';
  }

  const COMPUTE_JS_DIR = commandLineValues.output as string;
  const computeJsDir = path.resolve(COMPUTE_JS_DIR);

  const PUBLIC_DIR = commandLineValues['public-dir'] as string | undefined;
  if(PUBLIC_DIR == null) {
    console.error("❌ required parameter --public-dir not provided.");
    process.exit(1);
  }
  const publicDir = path.resolve(PUBLIC_DIR);

  const BUILD_STATIC_DIR = commandLineValues['static-dir'] as string | undefined;
  const buildStaticDir = BUILD_STATIC_DIR != null ? path.resolve(BUILD_STATIC_DIR) : null;

  const spa = commandLineValues['spa'] as string | null | undefined;

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
      process.exit(1);
    }
  }

  const exists = fs.existsSync(computeJsDir);
  if(exists) {
    console.error(`❌ '${COMPUTE_JS_DIR}' directory already exists!`);
    process.exit(1);
  }

  let packageJson;
  try {
    const packageJsonText = fs.readFileSync("./package.json", "utf-8");
    packageJson = JSON.parse(packageJsonText);
  } catch {
    if(assumeCreateReactApp) {
      console.error("❌ Can't read/parse package.json");
      console.error("Run this from a create-react-app project directory.");
      process.exit(1);
    }
    console.log("Can't read/parse package.json in current directory, making no assumptions!");
    packageJson = null;
  }

  let defaultAuthor = 'you@example.com';
  let defaultName = 'compute-js-static-site';
  let defaultDescription = 'Compute@Edge static site';
  if(assumeCreateReactApp) {
    if(commandLineValues['cra-eject']) {
      console.log("--cra-eject specified, skipping check for react-scripts in dependencies.")
    } else {
      if(packageJson?.dependencies?.['react-scripts'] == null) {
        console.error("❌ Can't find react-scripts in dependencies");
        console.error("Run this from a create-react-app project directory.");
        console.log("If this is a project created with create-react-app and has since been ejected, specify --cra-eject to skip this check.")
        process.exit(1);
      }
    }
    defaultName = 'my-create-react-app';
    defaultDescription = 'Compute@Edge static site from create-react-app';
  }

  const author = commandLineValues['author'] ?? packageJson?.author ?? defaultAuthor;
  const name = commandLineValues['name'] ?? packageJson?.name ?? defaultName;
  const description = commandLineValues['description'] ?? packageJson?.description ?? defaultDescription;

  let spaRel: string | null = spaFilename != null ? path.relative(path.resolve(), spaFilename) : null;
  if(spaRel != null && !spaRel.startsWith('..')) {
    spaRel = './' + spaRel;
  }

  console.log('');
  console.log('Public Dir  :', PUBLIC_DIR);
  console.log('Static Dir  :', BUILD_STATIC_DIR ?? '(None)');
  console.log('SPA         :', spaRel != null ? spaRel : '(None)');
  console.log('name        :', name);
  console.log('author      :', author);
  console.log('description :', description);
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
        "@fastly/js-compute": "^0.3.0",
        "buffer": "^6.0.3",
        "core-js": "^3.19.1",
        "webpack": "^5.64.0",
        "webpack-cli": "^4.9.1"
    },
    "engines": {
        "node": "^16"
    },
    "license": "MIT",
    "private": true,
    "main": "src/index.js",
    "scripts": {
        "build": "js-compute-runtime bin/index.js bin/main.wasm",
        "deploy": "npm run build && fastly compute deploy",
        "prebuild": "npx @fastly/compute-js-static-publish --build-static && webpack"
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
service_id = ""
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

  const staticPublishJsContent = `\
module.exports = {
  publicDir: ${JSON.stringify(publicDirRel)},
  excludeDirs: [ './node_modules' ],
  includeDirs: [ './.well-known' ],
  staticDirs: ${JSON.stringify(staticDirsRel)},
  spa: ${JSON.stringify(spaFileRel)},
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
