#!/usr/bin/env node
/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import fs from 'node:fs';
import { availableParallelism } from 'node:os';
import path from 'node:path';

import * as scaffoldCommand from './commands/scaffold/index.js';
import * as manageCommands from './commands/manage/index.js';
import { runTemplateHook } from './commands/run-template-hook.js';
import { parseGlobalOptions } from './util/global-options.js';
import { getOwnVersion } from './util/package.js';

// Register storage builder providers
import { registerStorageProviderBuilder } from './storage/storage-provider.js';
import * as kvStoreProvider from './storage/kv-store-provider.js';
import * as kvStoreLocalProvider from './storage/kv-store-local-provider.js';
import * as s3StorageProvider from './storage/s3-storage-provider.js';

registerStorageProviderBuilder(kvStoreProvider.buildStoreProvider);
registerStorageProviderBuilder(kvStoreLocalProvider.buildStoreProvider);
registerStorageProviderBuilder(s3StorageProvider.buildStoreProvider);

// Compression runs on the libuv thread pool, which has 4 threads by default.
// Use more threads on machines with more cores. libuv reads this value when it
// first uses the pool, so set it before any async work. A value that the user
// sets is kept.
if (process.env.UV_THREADPOOL_SIZE == null) {
  process.env.UV_THREADPOOL_SIZE = String(Math.max(4, Math.min(availableParallelism(), 16)));
}

// The template hooks of an app call this on each install and build. It works
// in any directory and prints no banner.
if (process.argv[2] === 'run-template-hook') {

  process.exitCode = runTemplateHook(process.argv[3]);

} else {

  await main();

}

async function main() {

  const globalOptions = parseGlobalOptions(process.argv.slice(2));
  if ('error' in globalOptions) {
    console.error(`❌ ${globalOptions.error}`);
    process.exitCode = 1;
    return;
  }

  // --version works in any directory, before the mode is detected.
  if (globalOptions.version) {
    process.stdout.write(getOwnVersion() + '\n');
    return;
  }

  if (globalOptions.projectDir != null) {
    const projectDir = path.resolve(globalOptions.projectDir);
    if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
      console.error(`❌ --project-dir '${globalOptions.projectDir}' is not a directory.`);
      process.exitCode = 1;
      return;
    }
    if (!fs.existsSync(path.resolve(projectDir, 'static-publish.rc.js'))) {
      console.error(`❌ --project-dir '${globalOptions.projectDir}' has no static-publish.rc.js.`);
      console.error(`  * To scaffold an app in a different directory, use --output.`);
      process.exitCode = 1;
      return;
    }
    // All relative paths are relative to the project dir from here: the paths
    // in static-publish.rc.js and publish-content.config.js, and the paths in
    // the arguments.
    process.chdir(projectDir);
  }

  // The commands get process.argv without the global options. command-line-args
  // removes the first two items (node and the script) only if it gets
  // process.argv itself, so change it in place.
  process.argv.splice(2, process.argv.length - 2, ...globalOptions.argv);

  if (!fs.existsSync('./static-publish.rc.js')) {

    console.log("🧑‍💻Fastly Compute JavaScript Static Publisher (Scaffolding mode)");
    await scaffoldCommand.action(process.argv);

  } else {

    console.log("🧑‍💻Fastly Compute JavaScript Static Publisher (Management mode)");
    if (globalOptions.projectDir != null) {
      console.log(`  | Project directory: ${process.cwd()}`);
    }
    await manageCommands.action(process.argv);

  }

}
