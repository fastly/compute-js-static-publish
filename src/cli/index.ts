#!/usr/bin/env node
/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import fs from 'node:fs';

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

if (!fs.existsSync('./static-publish.rc.js')) {

  console.log("🧑‍💻Fastly Compute JavaScript Static Publisher (Scaffolding mode)");
  await scaffoldCommand.action(process.argv);

} else {

  console.log("🧑‍💻Fastly Compute JavaScript Static Publisher (Management mode)");
  await manageCommands.action(process.argv);

}
