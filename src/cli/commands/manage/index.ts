/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { getCommandAndArgs } from '../../util/args.js';
import * as cleanCommand from './clean.js';
import * as publishContentCommand from './publish-content.js';
import * as collectionsCommands from './collections/index.js';

function help() {
  console.log(`\

Usage:
  npx @fastly/compute-js-static-publish <command> [options]

Description:
  Manage and publish static content to Fastly Compute using KV Store-backed collections.

  Note: If run outside a scaffolded project, this tool will automatically enter scaffolding mode.

Available Commands:
  publish-content                  Publish static files to the KV Store under a named collection
  clean                            Remove expired collections and unused KV Store content
  collections list                 List all published collections
  collections delete               Delete a specific collection index
  collections promote              Copy a collection to another name
  collections update-expiration    Modify expiration time for an existing collection

KV Store Options:
  --local                          Instead of working with the Fastly KV Store, operate on
                                   local files that will be used to simulate the KV Store
                                   with the local development environment.

  --fastly-api-token=<token>       Fastly API token for KV Store access.
                                   If not set, the tool will check:
                                     1. FASTLY_API_TOKEN environment variable
                                     2. The default profile in the Fastly CLI

S3 Storage Options (BETA):
  --aws-access-key-id=<key>        AWS Access Key ID and Secret Access Key used to
  --aws-secret-access-key=<key>    interface with S3.
                                   If not set, the tool will check:
                                     1. AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY
                                        environment variables
                                     2. The aws credentials file, see below  

  --aws-profile=<profile>          Profile within the aws credentials file.
                                   If not set, the tool will check:
                                     1. AWS_PROFILE environment variable
                                     2. The default profile, if set

Global Options:
  -h, --help                       Show this help message and exit.

Automatic Project Initialization:
  If run in a directory that does not contain a \`static-publish.rc.js\` file, this tool will scaffold a new
  Compute application for you, including Fastly configuration, default routes, and publishing setup.

Examples:
  npx @fastly/compute-js-static-publish publish-content --collection-name=live
  npx @fastly/compute-js-static-publish collections list
  npx @fastly/compute-js-static-publish clean --dry-run
`);
}

export async function action(actionArgs: string[]) {

  const modes = {
    'clean': cleanCommand,
    'publish-content': publishContentCommand,
    'collections': collectionsCommands,
  };

  const commandAndArgs = getCommandAndArgs(actionArgs, modes);

  if (commandAndArgs.needHelp) {
    if (commandAndArgs.error != null) {
      console.error(commandAndArgs.error);
      console.error(`Specify one of the following commands: ${Object.keys(modes).join(', ')}`);
      console.error();
      process.exitCode = 1;
    }

    help();
    return;
  }

  const { command, argv, } = commandAndArgs;
  await modes[command].action(argv);

}
