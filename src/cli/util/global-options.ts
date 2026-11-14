/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Options that work with every command. The CLI handles them before it
// detects the mode, and removes them from the arguments of the command.
export type GlobalOptions = {
  // --project-dir <dir>: the directory that has static-publish.rc.js or
  // static-publish.project.js.
  projectDir: string | undefined,
  // --version: print the version of this package, and do nothing else.
  version: boolean,
  // --non-interactive, or the CI environment variable: never ask a question.
  nonInteractive: boolean,
  // The values of the options that have a secret, for example
  // --fastly-api-token. These options stay in argv.
  secrets: string[],
  // The arguments without the global options.
  argv: string[],
};

// The options of the commands that take a secret.
const SECRET_OPTIONS = [ '--fastly-api-token', '--s3-secret-access-key' ];

// CI is set (to a value that is not empty, 'false', or '0') by CI systems such
// as GitHub Actions.
export function isCiEnvironment(env: Record<string, string | undefined>) {
  return env.CI != null && env.CI !== '' && env.CI !== 'false' && env.CI !== '0';
}

export function parseGlobalOptions(args: string[], env: Record<string, string | undefined> = {}): GlobalOptions | { error: string } {
  let projectDir: string | undefined;
  let version = false;
  let nonInteractive = isCiEnvironment(env);
  const secrets: string[] = [];
  const argv: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    for (const option of SECRET_OPTIONS) {
      if (arg.startsWith(`${option}=`)) {
        secrets.push(arg.slice(option.length + 1));
      } else if (arg === option && args[i + 1] != null && !args[i + 1].startsWith('-')) {
        secrets.push(args[i + 1]);
      }
    }
    if (arg === '--version') {
      version = true;
    } else if (arg === '--non-interactive') {
      nonInteractive = true;
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

  return { projectDir, version, nonInteractive, secrets, argv };
}
