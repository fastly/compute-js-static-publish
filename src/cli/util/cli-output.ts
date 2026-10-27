/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import util from 'node:util';

// The contract with tools that run the CLI, for example in CI:
// - Exit codes: 0 success (also "nothing to do"), 1 the operation failed (a
//   retry can help), 2 a usage or config error (the command could not start).
// - --json: stdout has exactly one JSON object, written at the end. The log
//   lines go to stderr. Each object has schemaVersion. Adding a field keeps the
//   version; removing or changing a field increases it, only in a major release.
// - An error with --json: { schemaVersion, error: { code, message } }. The
//   codes are part of the contract (see CliErrorCode). The message can change.

export const EXIT_SUCCESS = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;

export const JSON_SCHEMA_VERSION = 1;

export type CliErrorCode =
  // Exit 2: the command could not start.
  | 'usage'                     // an unknown command or flag, a missing or bad flag value
  | 'config-invalid'            // static-publish.rc.js or publish-content.config.js cannot be loaded or is not valid
  | 'collection-name-invalid'   // a new collection name breaks the rule
  | 'collection-not-found'      // the command needs a collection that does not exist
  | 'project-dir-not-found'     // --project-dir is not a directory
  | 'json-not-supported'        // --json with a command that does not support it
  | 'credentials-missing'       // a token or credentials are necessary, but not given
  // Exit 1: the operation failed.
  | 'failed'                    // the operation failed, for example storage cannot be reached
;

export type CliError = { code: CliErrorCode, message: string };

type State = {
  json: boolean,
  nonInteractive: boolean,
  result: Record<string, unknown> | null,
  error: CliError | null,
};

const state: State = {
  json: false,
  nonInteractive: false,
  result: null,
  error: null,
};

export function isJsonMode() {
  return state.json;
}

// No prompts: with --non-interactive, or when the CI environment variable is set.
// Missing input is then an error with a clear message.
export function isNonInteractive() {
  return state.nonInteractive;
}

// Record a failure. It sets the exit code. With --json, the error object is
// written at the end. The caller also logs the details for people.
export function recordError(code: CliErrorCode, message: string, exitCode: number = EXIT_USAGE) {
  if (state.error == null) {
    state.error = { code, message };
  }
  process.exitCode = exitCode;
}

// The code for an error that a storage provider or the purge setup throws
// before the operation starts.
export function errorCodeOf(err: unknown): CliErrorCode {
  const message = String(err instanceof Error ? err.message : err);
  if (/not provided/i.test(message)) {
    return 'credentials-missing';
  }
  if (/Unknown --/.test(message)) {
    return 'usage';
  }
  return 'config-invalid';
}

// Log an error for people, and record it.
export function reportError(code: CliErrorCode, message: string, exitCode: number = EXIT_USAGE) {
  console.error(`❌ ${message}`);
  recordError(code, message, exitCode);
}

// The result of a command, for --json.
export function setJsonResult(result: Record<string, unknown>) {
  state.result = result;
}

export function getRecordedError() {
  return state.error;
}

// Values that must never appear in the output, for example the API token.
const secrets = new Set<string>();

export function addSecret(value: string | undefined | null) {
  // Very short values would replace normal text.
  if (value != null && value.length >= 8) {
    secrets.add(value);
  }
}

export function redactSecrets(text: string): string {
  let result = text;
  for (const secret of secrets) {
    result = result.split(secret).join('[REDACTED]');
  }
  return result;
}

export type GlobalOptions = {
  json: boolean,
  nonInteractive: boolean,
  version: boolean,
  projectDir: string | undefined,
  argv: string[],
};

// The flags that apply to every command. They are removed from argv, so that
// the commands do not see them.
export function parseGlobalOptions(argv: string[], env: Record<string, string | undefined>): GlobalOptions | CliError {
  const rest: string[] = [];
  const options: GlobalOptions = {
    json: false,
    nonInteractive: env.CI != null && env.CI !== '' && env.CI !== 'false' && env.CI !== '0',
    version: false,
    projectDir: undefined,
    argv: rest,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      rest.push(...argv.slice(i));
      break;
    }
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--non-interactive') {
      options.nonInteractive = true;
    } else if (arg === '--version') {
      options.version = true;
    } else if (arg === '--project-dir' || arg.startsWith('--project-dir=')) {
      const value = arg === '--project-dir' ? argv[++i] : arg.slice('--project-dir='.length);
      if (value == null || value === '' || value.startsWith('--')) {
        return { code: 'usage', message: '--project-dir needs a directory.' };
      }
      options.projectDir = value;
    } else {
      rest.push(arg);
    }
    // Secrets in flags.
    for (const flag of [ '--fastly-api-token', '--s3-secret-access-key' ]) {
      if (arg.startsWith(`${flag}=`)) {
        addSecret(arg.slice(flag.length + 1));
      } else if (arg === flag) {
        addSecret(argv[i + 1]);
      }
    }
  }
  return options;
}

// Set up the output for the global options: redact secrets in every console
// method, and with --json, send the log lines to stderr.
export function setUpOutput(options: GlobalOptions, env: Record<string, string | undefined>) {
  state.json = options.json;
  state.nonInteractive = options.nonInteractive;
  addSecret(env.FASTLY_API_TOKEN);
  addSecret(env.S3_SECRET_ACCESS_KEY);

  const toStderr = options.json;
  for (const method of [ 'log', 'info', 'debug', 'warn', 'error' ] as const) {
    const write = (method === 'log' || method === 'info' || method === 'debug') && !toStderr ?
      (text: string) => process.stdout.write(text) :
      (text: string) => process.stderr.write(text);
    console[method] = (...args: unknown[]) => {
      write(redactSecrets(util.format(...args)) + '\n');
    };
  }
}

// With --json, write the one JSON object to stdout: the error, or the result.
export function writeJsonOutput() {
  if (!state.json) {
    return;
  }
  let output: Record<string, unknown>;
  if (state.error != null) {
    output = { schemaVersion: JSON_SCHEMA_VERSION, error: state.error };
  } else if (state.result != null) {
    output = { schemaVersion: JSON_SCHEMA_VERSION, ...state.result };
  } else if (process.exitCode != null && process.exitCode !== 0) {
    output = { schemaVersion: JSON_SCHEMA_VERSION, error: { code: 'failed', message: 'The command failed.' } };
  } else {
    output = { schemaVersion: JSON_SCHEMA_VERSION };
  }
  process.stdout.write(redactSecrets(JSON.stringify(output, undefined, 2)) + '\n');
}
