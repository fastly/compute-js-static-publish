/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import util from 'node:util';

// The contract with tools that run the CLI, for example in CI:
// - Exit codes: 0 success (also "nothing to do"), 1 the operation failed and a
//   retry can help, 2 a usage or config error (a retry cannot help).
// - --json: stdout has exactly one JSON object, written at the end. The log
//   lines go to stderr. Each object has schemaVersion. Adding a field keeps the
//   version. Removing or changing a field increases it, only in a major release.
// - An error with --json: { schemaVersion, error: { code, message } }. The
//   codes are part of the contract (CliErrorCode, also in the README). The
//   message is for people, and can change.

export const EXIT_SUCCESS = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;

export const JSON_SCHEMA_VERSION = 1;

// The codes that give exit 1.
const FAILED_CODES = [
  'deploy-failed',              // the build or the deploy of the app failed
  'failed',                     // the operation failed, for example storage cannot be reached
] as const;

// The codes that give exit 2.
const USAGE_CODES = [
  'usage',                      // an unknown command or option, or a missing or incorrect option value
  'config-invalid',             // a config file cannot be loaded or is not valid
  'collection-name-invalid',    // a collection name breaks the rule
  'collection-not-found',       // the command needs a collection that does not exist
  'project-dir-not-found',      // --project-dir is not a directory, or has no config file, or a command for a project runs in a directory with no config file
  'json-not-supported',         // --json with a command that does not support it
  'credentials-missing',        // a token or credentials are necessary, but not given
  'version-mismatch',           // managed.staticPublishVersion is not the version that runs
  'first-deploy-manual',        // a first deploy that must be done by hand (S3 storage, non-interactive)
  'version-not-published',      // eject needs a version of this package that is on npm
  'template-init-needed',       // template init --check: the template's folder is out of date
] as const;

export type CliErrorCode = typeof FAILED_CODES[number] | typeof USAGE_CODES[number];

export const CLI_ERROR_CODES: readonly CliErrorCode[] = [ ...USAGE_CODES, ...FAILED_CODES ];

export type CliError = { code: CliErrorCode, message: string };

// An error in the settings that a command finds after it loads them, for
// example a name in managed.fastlyToml that the CLI writes. The CLI gives the
// code config-invalid (exit 2) for it.
export class ConfigError extends Error {}

export function exitCodeOf(code: CliErrorCode) {
  return (FAILED_CODES as readonly string[]).includes(code) ? EXIT_FAILED : EXIT_USAGE;
}

let nonInteractive = false;
let json = false;
let jsonResult: Record<string, unknown> | null = null;
let recordedError: CliError | null = null;

// True with --non-interactive, or when the CI environment variable is set. Then
// a command never asks a question: missing input is an error.
export function isNonInteractive() {
  return nonInteractive;
}

// True with --json.
export function isJsonMode() {
  return json;
}

// Values that must never appear in the output, for example the API token.
const secrets = new Set<string>();

export function addSecret(value: string | undefined | null) {
  // A very short value would also replace normal text.
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

// Sets the mode of the run, and replaces the console methods with ones that
// redact the secrets: the given values, and the values of FASTLY_API_TOKEN and
// S3_SECRET_ACCESS_KEY. Thus an error message can never show a secret. With
// --json, all console methods write to stderr, so that stdout has only the
// JSON object.
export function setUpOutput(options: { nonInteractive: boolean, json: boolean, secrets: string[] }, env: Record<string, string | undefined>) {
  nonInteractive = options.nonInteractive;
  json = options.json;
  for (const secret of options.secrets) {
    addSecret(secret);
  }
  addSecret(env.FASTLY_API_TOKEN);
  addSecret(env.S3_SECRET_ACCESS_KEY);

  for (const method of [ 'log', 'info', 'debug', 'warn', 'error' ] as const) {
    const stream = json || method === 'warn' || method === 'error' ? process.stderr : process.stdout;
    console[method] = (...args: unknown[]) => {
      stream.write(redactSecrets(util.format(...args)) + '\n');
    };
  }
}

// Make the command fail with the exit code of the error code. Use this when
// the log already shows the error for the customer. With --json, the output
// has the first error only.
export function recordFailure(code: CliErrorCode, message: string) {
  recordedError ??= { code, message: redactSecrets(message.replace(/^(Error: )?❌\s*/, '')) };
  process.exitCode = exitCodeOf(code);
}

// Show an error for the customer, and make the command fail.
export function fail(code: CliErrorCode, message: string) {
  console.error(`❌ ${message}`);
  recordFailure(code, message);
}

// The error code for an error that a storage provider or the purge setup
// throws before the operation starts.
export function errorCodeOf(err: unknown): CliErrorCode {
  const message = String(err instanceof Error ? err.message : err);
  if (/not provided/i.test(message)) {
    return 'credentials-missing';
  }
  if (/^(❌ )?Unknown --|^--local is available only/.test(message)) {
    return 'usage';
  }
  return 'config-invalid';
}

// The result of the command, for --json.
export function setJsonResult(result: Record<string, unknown>) {
  jsonResult = result;
}

// With --json, write the one JSON object to stdout: the error, or the result.
export function writeJsonOutput() {
  if (!json) {
    return;
  }
  let output: Record<string, unknown>;
  if (recordedError != null) {
    output = { schemaVersion: JSON_SCHEMA_VERSION, error: recordedError };
  } else if (process.exitCode != null && process.exitCode !== EXIT_SUCCESS) {
    output = { schemaVersion: JSON_SCHEMA_VERSION, error: { code: 'failed', message: 'The command failed.' } };
  } else {
    output = { schemaVersion: JSON_SCHEMA_VERSION, ...jsonResult };
  }
  process.stdout.write(redactSecrets(JSON.stringify(output, undefined, 2)) + '\n');
}
