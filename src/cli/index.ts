#!/usr/bin/env node
/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { action } from './commands/index.js';

console.log("🧑‍💻 Fastly Compute JavaScript Static Publisher");

await action(process.argv);
