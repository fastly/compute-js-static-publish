#!/usr/bin/env node

import commandLineArgs, { OptionDefinition } from "command-line-args";

import { initApp } from "./commands/init-app.js";
import { buildStaticLoader } from "./commands/build-static.js";
import { cleanKVStore } from "./commands/clean-kv-store.js";

const optionDefinitions: OptionDefinition[] = [
  // (optional) Should be one of:
  // - cra (or create-react-app)
  // - vite
  // - sveltekit
  // - vue
  // - next
  // - astro
  // - gatsby
  // - docusaurus
  { name: 'preset', type: String, },

  { name: 'build-static', type: Boolean },
  { name: 'suppress-framework-warnings', type: Boolean },
  { name: 'output', alias: 'o', type: String, defaultValue: './compute-js', },

  // Whether the scaffolded project should use webpack to bundle assets.
  { name: 'webpack', type: Boolean, defaultValue: false },

  // The 'root' directory for the publishing.
  // All assets are expected to exist under this root. Required.
  // For backwards compatibility, if this value is not provided,
  // then the value of 'public-dir' is used.
  { name: 'root-dir', type: String, },

  // The 'public' directory. The Publisher Server will
  // resolve requests relative to this directory. If not specified,
  // defaults to the same value as 'root-dir'. See README for
  // details.
  { name: 'public-dir', type: String, },

  // Directories to specify as containing 'static' files. The
  // Publisher Server will serve files from these directories
  // with a long TTL.
  { name: 'static-dir', type: String, multiple: true, },

  // The 'static content root directory' where the Static Publisher
  // outputs its metadata files and loaders.
  { name: 'static-content-root-dir', type: String, },

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

  // Components from fastly.toml

  // Name of the application, to be inserted into fastly.toml
  { name: 'name', type: String, },

  // Name of the author, to be inserted into fastly.toml
  { name: 'author', type: String, },

  // Description of the application, to be inserted into fastly.toml
  { name: 'description', type: String, },

  // Fastly Service ID to be added to the fastly.toml that is generated.
  { name: 'service-id', type: String },

  // The name of a Fastly KV Store to hold the content assets.
  // It must be linked to the service specified by `--service-id`.
  { name: 'kv-store-name', type: String },

  // Clean KV Store mode
  { name: 'clean-kv-store', type: Boolean, },
];

const commandLineValues = commandLineArgs(optionDefinitions);

console.log("Fastly Compute JavaScript Static Publisher");

let mode: 'init-app' | 'build-static' | 'clean-kv-store' = 'init-app';
if(commandLineValues['build-static']) {
  mode = 'build-static';
} else if(commandLineValues['clean-kv-store']) {
  mode = 'clean-kv-store';
}

switch(mode) {
case 'build-static':
  await buildStaticLoader(commandLineValues);
  break;
case 'init-app':
  initApp(commandLineValues);
  break;
case 'clean-kv-store':
  await cleanKVStore(commandLineValues);
  break;
}
