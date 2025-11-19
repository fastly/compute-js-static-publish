/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { getCommandAndArgs } from '../../../util/args.js';
import * as deleteCommand from './delete.js';
import * as listCommand from './list.js';
import * as promoteCommand from './promote.js';
import * as updateExpirationCommand from './update-expiration.js';

function help() {
  console.log(`\

Usage:
  npx @fastly/compute-js-static-publish collections <sub-command> [options]

Description:
  Manage named collections within a Compute application built with @fastly/compute-js-static-publish.

Available Subcommands:
  list                             List all published collections
  delete                           Delete a specific collection index
  promote                          Copies an existing collection (content + config)
                                   to a new collection name
  update-expiration                Modify expiration time for an existing collection

KV Store Options:
  --local                          Instead of working with the Fastly KV Store, operate on
                                   local files that will be used to simulate the KV Store
                                   with the local development environment.

  --fastly-api-token=<token>       Fastly API token for KV Store access.
                                   If not set, the tool will check:
                                     1. FASTLY_API_TOKEN environment variable
                                     2. The default profile in the Fastly CLI

S3 Storage Options (BETA):
  --s3-access-key-id=<id>          Access Key ID and Secret Access Key used to
  --s3-secret-access-key=<key>     interface with S3 or compatible storage.
                                   If not set, the tool will check the S3_ACCESS_KEY_ID
                                   and S3_SECRET_ACCESS_KEY environment variables.

Global Options:
  -h, --help                       Show this help message and exit.

Examples:
  npx @fastly/compute-js-static-publish collections list
  npx @fastly/compute-js-static-publish collections delete --collection-name=preview-42
`);
}

export async function action(actionArgs: string[]) {

  const modes = {
    'delete': deleteCommand,
    'list': listCommand,
    'promote': promoteCommand,
    'update-expiration': updateExpirationCommand,
  };

  const commandAndArgs = getCommandAndArgs(actionArgs, modes);

  if (commandAndArgs.needHelp) {
    if (commandAndArgs.error != null) {
      console.error(commandAndArgs.error);
      console.error(`Specify one of the following sub-commands: ${Object.keys(modes).join(', ')}`);
      console.error();
      process.exitCode = 1;
    }

    help();
    return;
  }

  const { command, argv, } = commandAndArgs;
  await modes[command].action(argv);

}
