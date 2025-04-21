/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import commandLineArgs, { type CommandLineOptions, type OptionDefinition } from 'command-line-args';

export type ModeAction = (argv: string[]) => void | Promise<void>;
export type ActionModule = { action: ModeAction };
export type ActionTable<T extends string> = Record<T, ActionModule>;

const helpOptionsDefs: OptionDefinition[] = [
  { name: 'help', alias: 'h', type: Boolean },
];

export function isHelpArgs(argv: string[]) {

  const helpOptions = commandLineArgs(helpOptionsDefs, { argv, stopAtFirstUnknown: true });
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

export type CommandAndArgs<T> = {
  needHelp: false,
  command: T,
  argv: string[],
};

export type CommandAndArgsHelp = {
  needHelp: true,
  command: string | null,
}

export type CommandAndArgsResult<T> = CommandAndArgs<T> | CommandAndArgsHelp;

export function getCommandAndArgs<T extends string>(
  argv: string[],
  actions: ActionTable<T>,
): CommandAndArgsResult<T> {
  if (isHelpArgs(argv)) {
    return {
      needHelp: true,
      command: null,
    };
  }

  const result = findMainCommandNameAndArgs(argv);

  const [ command, actionArgv ] = result;
  if (command != null) {
    for (const modeName of Object.keys(actions)) {
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

export type CommandLineParsed = {
  needHelp: false,
  commandLineOptions: CommandLineOptions,
};

export type CommandLineHelp = {
  needHelp: true,
  error: Error | null,
};

export type CommandLineResult = CommandLineParsed | CommandLineHelp;

export function parseCommandLine(
  argv: string[],
  optionDefinitions: OptionDefinition[],
): CommandLineResult {
  let commandLineOptions;
  try {
    commandLineOptions = commandLineArgs([
      ...helpOptionsDefs,
      ...optionDefinitions,
    ], { argv });
  } catch(err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      needHelp: true,
      error,
    }
  }

  if (!!commandLineOptions['help']) {
    return {
      needHelp: true,
      error: null,
    };
  }

  return {
    needHelp: false,
    commandLineOptions,
  };
}
