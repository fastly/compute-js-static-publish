#!/usr/bin/env node
/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import fs from 'node:fs';
import { availableParallelism } from 'node:os';

import * as scaffoldCommand from './commands/scaffold/index.js';
import * as manageCommands from './commands/manage/index.js';

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

if (!fs.existsSync('./static-publish.rc.js')) {

  console.log("🧑‍💻Fastly Compute JavaScript Static Publisher (Scaffolding mode)");
  await scaffoldCommand.action(process.argv);

} else {

  console.log("🧑‍💻Fastly Compute JavaScript Static Publisher (Management mode)");
  await manageCommands.action(process.argv);

}
