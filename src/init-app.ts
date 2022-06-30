import { CommandLineOptions } from "command-line-args";

// This program creates a Compute@Edge JavaScript application
// in a subfolder named compute-js.
// This project can be served using fastly compute serve
// or deployed to a Compute@Edge service using fastly compute publish.

import * as path from "path";
import * as fs from "fs";
import * as url from 'url';

export function initApp(commandLineValues: CommandLineOptions) {

  let assumeCreateReactApp = false;
  if (commandLineValues['public-path'] === undefined &&
    commandLineValues['static-path'] === undefined
  ) {
    console.log("--public-path and --static-path not provided, assuming create-react-app.");
    console.log("Using --public-path=./build and --static-path=./build/static");
    assumeCreateReactApp = true;
    commandLineValues['public-path'] = './build';
    commandLineValues['static-path'] = './build/static';
  }

  const COMPUTE_JS_DIR = commandLineValues.output as string;
  const computeJsDir = path.resolve(COMPUTE_JS_DIR);

  const BUILD_DIR = commandLineValues['public-path'] as string | undefined;
  if(BUILD_DIR == null) {
    console.error("❌ required parameter --public-path not provided.");
    process.exit(1);
  }
  const buildDir = path.resolve(BUILD_DIR);

  const BUILD_STATIC_DIR = commandLineValues['static-path'] as string | undefined;
  const buildStaticDir = BUILD_STATIC_DIR != null ? path.resolve(BUILD_STATIC_DIR) : null;

  const IS_SPA = commandLineValues['spa'] as boolean | undefined;

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
    if(packageJson?.dependencies?.['react-scripts'] == null) {
      console.error("❌ Can't find react-scripts in dependencies");
      console.error("Run this from a create-react-app project directory.");
      process.exit(1);
    }
    defaultName = 'my-create-react-app';
    defaultDescription = 'Compute@Edge static site from create-react-app';
  }

  const author = commandLineValues['author'] ?? packageJson?.author ?? defaultAuthor;
  const name = commandLineValues['name'] ?? packageJson?.name ?? defaultName;
  const description = commandLineValues['description'] ?? packageJson?.description ?? defaultDescription;

  console.log('');
  console.log('Public Path :', BUILD_DIR);
  console.log('Static Path :', BUILD_STATIC_DIR ?? '(None)');
  console.log('SPA         :', IS_SPA ? 'Yes' : 'No');
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

  // static-publish.json
  const buildDirRel = path.relative(computeJsDir, buildDir);
  const buildStaticDirRel = buildStaticDir != null ? path.relative(computeJsDir, buildStaticDir) : null;

  // language=JSON
  const staticPublishJsonContent = `\
{
  "buildDir": ${JSON.stringify(buildDirRel)},
  "staticDir": ${JSON.stringify(buildStaticDirRel)},
  "spa": ${JSON.stringify(IS_SPA)}
}
`;

  const staticPublishJsonPath = path.resolve(computeJsDir, 'static-publish.json');
  fs.writeFileSync(staticPublishJsonPath, staticPublishJsonContent, "utf-8");

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

  console.log('');
  console.log('To run your Compute@Edge application locally:');
  console.log('');
  console.log('  cd ' + COMPUTE_JS_DIR);
  console.log('  npm install');
  console.log('  fastly compute serve');
  console.log('');
  console.log('To build and deploy to your Compute@Edge service:');
  console.log('');
  console.log('  cd ' + COMPUTE_JS_DIR);
  console.log('  npm install');
  console.log('  fastly compute publish');
  console.log('');

}
