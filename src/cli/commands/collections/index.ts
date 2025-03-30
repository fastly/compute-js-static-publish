/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { getCommandAndArgs } from '../../util/args.js';
import * as collectionsDelete from './delete.js';
import * as collectionsList from './list.js';

export async function action(actionArgs: string[]) {

  const modes = {
    'delete': collectionsDelete,
    'list': collectionsList,
  };

  const commandAndArgs = getCommandAndArgs<keyof typeof modes>(
    actionArgs,
    Object.keys(modes) as (keyof typeof modes)[],
  );

  if (commandAndArgs.needHelp) {
    if (commandAndArgs.command != null) {
      console.error(`Unknown subcommand: ${commandAndArgs.command}`);
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

function help() {

  console.log(`\

Usage:
  npx @fastly/compute-js-static-publish collections <sub-command> [options]

Description:
  Manage named collections within a Compute application built with @fastly/compute-js-static-publish.

Available Subcommands:
  list                 List all published collections
  delete               Delete a specific collection index
  update-expiration    Modify expiration time for an existing collection

Global Options:
  --fastly-api-token <token>       Fastly API token used for KV Store access. If not provided,
                                   the tool will try:
                                     1. FASTLY_API_TOKEN environment variable
                                     2. fastly profile token (via CLI)
  -h, --help                       Show help for this command or any subcommand

Examples:
  npx @fastly/compute-js-static-publish collections list
  npx @fastly/compute-js-static-publish collections delete --collection-name=preview-42
`);

}
