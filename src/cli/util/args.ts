/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import commandLineArgs from 'command-line-args';

export type ModeAction = (argv: string[]) => void | Promise<void>;
export type ActionModule = { action: ModeAction };

export function isHelpArgs(argv: string[]) {

  const helpDefinitions = [
    { name: 'help', type: Boolean, },
  ];
  const helpOptions = commandLineArgs(helpDefinitions, { argv, stopAtFirstUnknown: true });
  return !!helpOptions['help'];

}

export function findMainCommandNameAndArgs(argv: string[]): [string | null, string[]] {

  const mainDefinitions = [
    { name: 'command', type: String, defaultOption: true },
  ];
  const mainOptions = commandLineArgs(mainDefinitions, { argv, stopAtFirstUnknown: true });
  const commandArgs = mainOptions._unknown || [];

  const command = mainOptions['command'];
  if (typeof command !== 'string') {
    return [ null, commandArgs ];
  }

  return [ command, commandArgs ];

}

export type CommandAndArgs<T> =
| {
  needHelp: false,
  command: T,
  argv: string[],
}
| {
  needHelp: true,
  command: string | null,
}
;

export function getCommandAndArgs<T extends string>(
  argv: string[],
  modes: T[],
): CommandAndArgs<T> {
  if (isHelpArgs(argv)) {
    return {
      needHelp: true,
      command: null,
    };
  }

  const result = findMainCommandNameAndArgs(argv);

  const [ command, actionArgv ] = result;
  if (command != null) {
    for (const modeName of modes) {
      if (command === modeName) {
        return {
          needHelp: false,
          command: command as T,
          argv: actionArgv,
        };
      }
    }
  }

  try {
    commandLineArgs([], { argv: actionArgv });
  } catch(err) {
    console.log(String(err));
  }

  return {
    needHelp: true,
    command,
  };
}
