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

Global Options:
  --fastly-api-token <token>       Fastly API token used for KV Store access. If not provided,
                                   the tool will try:
                                     1. FASTLY_API_TOKEN environment variable
                                     2. fastly profile token (via CLI)
  -h, --help                       Show help for this command or any subcommand

Automatic Project Initialization:
  If run in a directory that does not contain a \`static-publish.rc.js\` file, this tool will scaffold a new
  Compute application for you, including Fastly configuration, default routes, and publishing setup.

Examples:
  npx @fastly/compute-js-static-publish publish-content --collection-name live
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
    if (commandAndArgs.command != null) {
      console.error(`Unknown command: ${commandAndArgs.command}`);
      console.error(`Specify one of: ${Object.keys(modes).join(', ')}`);
      console.error();
      process.exitCode = 1;
    }

    help();
    return;
  }

  const { command, argv, } = commandAndArgs;
  await modes[command].action(argv);

}
