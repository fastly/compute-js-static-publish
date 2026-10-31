/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Options that work with every command. The CLI handles them before it
// detects the mode, and removes them from the arguments of the command.
export type GlobalOptions = {
  // --project-dir <dir>: the directory that has static-publish.rc.js.
  projectDir: string | undefined,
  // --version: print the version of this package, and do nothing else.
  version: boolean,
  // The arguments without the global options.
  argv: string[],
};

export function parseGlobalOptions(args: string[]): GlobalOptions | { error: string } {
  let projectDir: string | undefined;
  let version = false;
  const argv: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--version') {
      version = true;
    } else if (arg === '--project-dir' || arg.startsWith('--project-dir=')) {
      const value = arg === '--project-dir' ? args[++i] : arg.slice('--project-dir='.length);
      if (value == null || value === '' || value.startsWith('--')) {
        return { error: '--project-dir needs a directory.' };
      }
      if (projectDir != null) {
        return { error: '--project-dir can be given only one time.' };
      }
      projectDir = value;
    } else {
      argv.push(arg);
    }
  }

  return { projectDir, version, argv };
}
