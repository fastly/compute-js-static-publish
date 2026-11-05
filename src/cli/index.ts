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
import { runDevWatch } from './commands/run-dev-watch.js';
import { runTemplateHook } from './commands/run-template-hook.js';
import { type GlobalOptions, parseGlobalOptions } from './util/global-options.js';
import {
  EXIT_USAGE,
  JSON_SCHEMA_VERSION,
  fail,
  isJsonMode,
  recordFailure,
  setJsonResult,
  setUpOutput,
  writeJsonOutput,
} from './util/output.js';
import { getOwnVersion } from './util/package.js';
import { detectProjectMode } from './util/config.js';
import { PROJECT_FILE_NAME, RC_FILE_NAME } from '../models/config/static-publish-project.js';

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

} else if (process.argv[2] === 'run-dev-watch') {

  // The dev:watch script of an app calls this. It works in any directory and
  // prints no banner.
  process.exitCode = await runDevWatch(process.argv.slice(3));

} else {

  await main();

}

async function main() {

  const globalOptions = parseGlobalOptions(process.argv.slice(2), process.env);
  if ('error' in globalOptions) {
    console.error(`❌ ${globalOptions.error}`);
    process.exitCode = EXIT_USAGE;
    // The output is not set up yet, so write the JSON object here.
    if (process.argv.includes('--json')) {
      const error = { code: 'usage', message: globalOptions.error };
      process.stdout.write(JSON.stringify({ schemaVersion: JSON_SCHEMA_VERSION, error }, undefined, 2) + '\n');
    }
    return;
  }
  setUpOutput(globalOptions, process.env);

  try {
    await run(globalOptions);
  } catch (err) {
    // Through console.error(), so that secrets are redacted.
    console.error(err);
    recordFailure('failed', String(err instanceof Error ? err.message : err));
  }

  writeJsonOutput();

}

async function run(globalOptions: GlobalOptions) {

  // --version works in any directory, before the mode is detected.
  if (globalOptions.version) {
    if (isJsonMode()) {
      setJsonResult({ version: getOwnVersion() });
    } else {
      process.stdout.write(getOwnVersion() + '\n');
    }
    return;
  }

  if (globalOptions.projectDir != null) {
    const projectDir = path.resolve(globalOptions.projectDir);
    if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
      fail('project-dir-not-found', `--project-dir '${globalOptions.projectDir}' is not a directory.`);
      return;
    }
    if (
      !fs.existsSync(path.resolve(projectDir, RC_FILE_NAME)) &&
      !fs.existsSync(path.resolve(projectDir, PROJECT_FILE_NAME))
    ) {
      fail('project-dir-not-found', `--project-dir '${globalOptions.projectDir}' has no ${RC_FILE_NAME} or ${PROJECT_FILE_NAME}.`);
      console.error(`  * Give the directory of the app, for example --project-dir=./compute-js. To scaffold an app in another directory, use --output.`);
      return;
    }
    // After this, all relative paths are relative to the project dir: the paths
    // in the config files, and the paths in the arguments.
    process.chdir(projectDir);
  }

  // The commands get process.argv without the global options. command-line-args
  // removes the first two items (node and the script) only if it gets
  // process.argv itself, so change it in place.
  process.argv.splice(2, process.argv.length - 2, ...globalOptions.argv);

  const mode = detectProjectMode();
  if (mode === 'conflict') {
    fail('config-invalid', `This directory has both ${PROJECT_FILE_NAME} (a managed project) and ${RC_FILE_NAME} (an ejected app). Remove one of them.`);
    return;
  }

  if (mode === 'scaffold') {

    console.log("🧑‍💻Fastly Compute JavaScript Static Publisher (Scaffolding mode)");
    if (isJsonMode()) {
      fail('json-not-supported', '--json is not supported for scaffolding.');
      return;
    }
    await scaffoldCommand.action(process.argv);

  } else {

    console.log(`🧑‍💻Fastly Compute JavaScript Static Publisher (Management mode${mode === 'managed' ? ', managed project' : ''})`);
    if (globalOptions.projectDir != null) {
      console.log(`  | Project directory: ${process.cwd()}`);
    }
    await manageCommands.action(process.argv);

  }

}
