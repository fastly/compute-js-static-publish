/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { getCommandAndArgs } from '../../util/args.js';
import { fail, isJsonMode, recordFailure } from '../../util/output.js';
import * as cleanCommand from './clean.js';
import * as deployCommand from './deploy.js';
import * as devCommand from './dev.js';
import * as ejectCommand from './eject.js';
import * as statusCommand from './status.js';
import * as templateCommands from './template/index.js';
import * as upgradeCommand from './upgrade.js';
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
  dev                              Run the app of a managed project locally
  status                           Show the state of the app, and if a deploy is necessary
  deploy                           Deploy the app of a managed project, if it changed
  upgrade                          Move a managed project to the version of this CLI
  eject                            Convert a managed project into an ejected app
  template init                    Make or update the folder of the app's template
                                   (for the hono template: hono-extensions/)

KV Store Options:
  --local                          Instead of working with the Fastly KV Store, operate on
                                   local files that will be used to simulate the KV Store
                                   with the local development environment.
                                   KV Store mode only. In S3 mode, --local is an error.

  --fastly-api-token=<token>       Fastly API token for KV Store access.
                                   If not set, the tool uses the FASTLY_API_TOKEN
                                   environment variable.

S3 Storage Options (BETA):
  --s3-access-key-id=<id>          Access Key ID and Secret Access Key used to
  --s3-secret-access-key=<key>     interface with S3 or compatible storage.
                                   If not set, the tool will check the S3_ACCESS_KEY_ID
                                   and S3_SECRET_ACCESS_KEY environment variables.

Global Options:
  --project-dir=<dir>              Run the command for the app in <dir>, the directory
                                   that has static-publish.rc.js or static-publish.project.js.
                                   Relative paths, also in other options, are then
                                   relative to <dir>.
  --version                        Print the version of this package and exit.
  --non-interactive                Never ask a question. Missing input is an error.
                                   This is also on when the CI environment variable is set.
  --json                           Write the result as one JSON object to stdout, and
                                   the log to stderr. For publish-content,
                                   collections list/delete/promote, status, deploy,
                                   and --version.
  -h, --help                       Show this help message and exit.

Automatic Project Initialization:
  If run in a directory that does not contain a \`static-publish.rc.js\` file, this tool will scaffold a new
  Compute application for you, including Fastly configuration, default routes, and publishing setup.

Examples:
  npx @fastly/compute-js-static-publish publish-content --collection-name=live
  npx @fastly/compute-js-static-publish collections list
  npx @fastly/compute-js-static-publish clean --dry-run
  npx @fastly/compute-js-static-publish publish-content --project-dir=./compute-js
`);
}

export async function action(actionArgs: string[]) {

  const modes = {
    'clean': cleanCommand,
    'deploy': deployCommand,
    'dev': devCommand,
    'eject': ejectCommand,
    'status': statusCommand,
    'upgrade': upgradeCommand,
    'publish-content': publishContentCommand,
    'collections': collectionsCommands,
    'template': templateCommands,
  };

  const commandAndArgs = getCommandAndArgs(actionArgs, modes);

  if (commandAndArgs.needHelp) {
    if (commandAndArgs.error != null) {
      console.error(commandAndArgs.error);
      console.error(`Specify one of the following commands: ${Object.keys(modes).join(', ')}`);
      console.error();
      recordFailure('usage', commandAndArgs.error);
    }

    help();
    return;
  }

  const { command, argv, } = commandAndArgs;
  if (isJsonMode() && ![ 'publish-content', 'collections', 'status', 'deploy' ].includes(command)) {
    fail('json-not-supported', `--json is not supported for '${command}'.`);
    return;
  }
  await modes[command].action(argv);

}
