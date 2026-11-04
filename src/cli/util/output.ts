/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import util from 'node:util';

let nonInteractive = false;

// True with --non-interactive, or when the CI environment variable is set. Then
// a command never asks a question: missing input is an error.
export function isNonInteractive() {
  return nonInteractive;
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
// S3_SECRET_ACCESS_KEY. Thus an error message can never show a secret.
export function setUpOutput(options: { nonInteractive: boolean, secrets: string[] }, env: Record<string, string | undefined>) {
  nonInteractive = options.nonInteractive;
  for (const secret of options.secrets) {
    addSecret(secret);
  }
  addSecret(env.FASTLY_API_TOKEN);
  addSecret(env.S3_SECRET_ACCESS_KEY);

  for (const method of [ 'log', 'info', 'debug', 'warn', 'error' ] as const) {
    const stream = method === 'warn' || method === 'error' ? process.stderr : process.stdout;
    console[method] = (...args: unknown[]) => {
      stream.write(redactSecrets(util.format(...args)) + '\n');
    };
  }
}

// Show an error for the customer, and make the command fail.
export function fail(message: string) {
  console.error(`❌ ${message}`);
  process.exitCode = 1;
}
