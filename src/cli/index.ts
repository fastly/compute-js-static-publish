#!/usr/bin/env node
/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import fs from 'node:fs';

import * as scaffoldCommand from './commands/scaffold/index.js';
import * as manageCommands from './commands/manage/index.js';

if (!fs.existsSync('./static-publish.rc.js')) {

  console.log("🧑‍💻Fastly Compute JavaScript Static Publisher (Scaffolding mode)");
  await scaffoldCommand.action(process.argv);

} else {

  console.log("🧑‍💻Fastly Compute JavaScript Static Publisher (Management mode)");
  await manageCommands.action(process.argv);

}
