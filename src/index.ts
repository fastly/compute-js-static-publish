#!/usr/bin/env node

// This program creates a Compute@Edge JavaScript application
// as a subfolder of a create-react-app project in a folder named
// compute-js.  This project can be served using fastly compute serve
// or deployed to a Compute@Edge service using fastly compute publish.

// For now, we expect this program to have been run inside a
// directory created with create-react-app
// TODO: Can run anywhere and specify a static folder.

import * as path from "path";
import * as fs from "fs";
import * as url from 'url';

import commandLineArgs, { OptionDefinition } from "command-line-args";

const optionDefinitions: OptionDefinition[] = [
  { name: 'output', alias: 'o', type: String, defaultValue: './compute-js', },
  { name: 'public-path', type: String, },
  { name: 'static-path', type: String, },
  { name: 'spa', type: Boolean, defaultValue: false, }
]

const commandLineValues = commandLineArgs(optionDefinitions);

console.log("Fastly Compute@Edge JavaScript Static Publisher");

if (commandLineValues['public-path'] === undefined &&
  commandLineValues['static-path'] === undefined
) {
  console.log("--public-path and --static-path not provided, assuming create-react-app.");
  console.log("Using --public-path=./build and --static-path=./build/static");
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

let packageJsonText;
try {
  packageJsonText = fs.readFileSync("./package.json", "utf-8");
} catch {
  console.error("❌ Can't read package.json");
  console.error("Run this from a create-react-app project directory.");
  process.exit(1);
}

let packageJson;
try {
  packageJson = JSON.parse(packageJsonText);
} catch {
  console.error("❌ Can't parse package.json");
  console.error("Run this from a create-react-app project directory.");
  process.exit(1);
}

if(packageJson.dependencies?.['react-scripts'] == null) {
  console.error("❌ Can't find react-scripts in dependencies");
  console.error("Run this from a create-react-app project directory.");
  process.exit(1);
}

const author = packageJson.author ?? 'you@example.com';
const name = packageJson.name ?? 'my-app';
const description = packageJson.description ?? 'create-react-app';

console.log("Initializing Compute@Edge Application in " + computeJsDir + "...");
fs.mkdirSync(computeJsDir);
fs.mkdirSync(path.resolve(computeJsDir, './src'));

// gitignore
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
        "@fastly/expressly": "^1.0.0-alpha.7",` +
        //"@fastly/compute-js-static-publish": "1.0.0",
`
        "@fastly/js-compute": "^0.2.5",
        "buffer": "^6.0.3",
        "core-js": "^3.19.1",
        "webpack": "^5.64.0",
        "webpack-cli": "^4.9.1"
    },
    "engines": {
        "node": "^16"
    },
    "license": "MIT",
    "main": "src/index.js",
    "scripts": {
        "build": "js-compute-runtime --skip-pkg bin/index.js bin/main.wasm",
        "deploy": "npm run build && fastly compute deploy",
        "prebuild": "npx compute-js-build-static-loader && webpack"
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

authors = []
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
