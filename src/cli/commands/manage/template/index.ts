/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { getCommandAndArgs } from '../../../util/args.js';
import { recordFailure } from '../../../util/output.js';
import * as initCommand from './init.js';
import { cliCommand } from '../../../util/package.js';

function help() {
  console.log(`\

Usage:
  ${cliCommand()} template <sub-command> [options]

Description:
  Commands for the template of the app.

Available Subcommands:
  init                             Make or update the folder of the template
                                   (for the hono template: hono-extensions/)

Global Options:
  -h, --help                       Show this help message and exit.
`);
}

export async function action(actionArgs: string[]) {

  const modes = {
    'init': initCommand,
  };

  const commandAndArgs = getCommandAndArgs(actionArgs, modes);

  if (commandAndArgs.needHelp) {
    if (commandAndArgs.error != null) {
      console.error(commandAndArgs.error);
      console.error(`Specify one of the following sub-commands: ${Object.keys(modes).join(', ')}`);
      console.error();
      recordFailure('usage', commandAndArgs.error);
    }

    help();
    return;
  }

  const { command, argv, } = commandAndArgs;
  await modes[command].action(argv);

}
