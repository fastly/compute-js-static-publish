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
import {
  type GlobalOptions,
  EXIT_FAILED,
  EXIT_USAGE,
  JSON_SCHEMA_VERSION,
  isJsonMode,
  parseGlobalOptions,
  recordError,
  redactSecrets,
  reportError,
  setJsonResult,
  setUpOutput,
  writeJsonOutput,
} from './util/cli-output.js';
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

// The template hooks of a generated app call this on each install and build.
// It works in any directory and prints no banner.
if (process.argv[2] === 'run-template-hook') {

  process.exitCode = runTemplateHook(process.argv[3]);

} else {

  await main();

}

async function main() {

  const globalOptions = parseGlobalOptions(process.argv.slice(2), process.env);
  if ('code' in globalOptions) {
    console.error(`❌ ${globalOptions.message}`);
    process.exitCode = EXIT_USAGE;
    if (process.argv.includes('--json')) {
      process.stdout.write(JSON.stringify({ schemaVersion: JSON_SCHEMA_VERSION, error: globalOptions }, undefined, 2) + '\n');
    }
    return;
  }
  setUpOutput(globalOptions, process.env);

  try {
    await run(globalOptions);
  } catch (err) {
    // Log through console, so that secrets are redacted.
    console.error(err);
    recordError('failed', redactSecrets(String(err instanceof Error ? err.message : err)), EXIT_FAILED);
  }

  writeJsonOutput();

}

async function run(globalOptions: GlobalOptions) {

  // --version works in any directory, before the mode is detected.
  if (globalOptions.version) {
    const version = getOwnVersion();
    if (isJsonMode()) {
      setJsonResult({ version });
    } else {
      process.stdout.write(version + '\n');
    }
    return;
  }

  if (globalOptions.projectDir != null) {
    const projectDir = path.resolve(globalOptions.projectDir);
    if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
      reportError('project-dir-not-found', `--project-dir '${globalOptions.projectDir}' is not a directory.`);
      return;
    }
    // All relative paths, also the paths in flags, are relative to the project dir.
    process.chdir(projectDir);
  }

  // The commands get process.argv without the global flags. command-line-args
  // removes the first two items (node and the script) only if it gets
  // process.argv itself, so change it in place.
  process.argv.splice(2, process.argv.length - 2, ...globalOptions.argv);
  const argv = process.argv;

  const mode = detectProjectMode();
  if (mode === 'conflict') {
    reportError('config-invalid', `This directory has both ${PROJECT_FILE_NAME} (a managed project) and ${RC_FILE_NAME} (an ejected app). Remove one of them.`);
    return;
  }

  if (mode === 'scaffold') {

    console.log("🧑‍💻Fastly Compute JavaScript Static Publisher (Scaffolding mode)");
    if (isJsonMode()) {
      reportError('json-not-supported', `--json is not supported for scaffolding.`);
      return;
    }
    await scaffoldCommand.action(argv);

  } else {

    console.log(`🧑‍💻Fastly Compute JavaScript Static Publisher (Management mode${mode === 'managed' ? ', managed project' : ''})`);
    await manageCommands.action(argv);

  }

}
