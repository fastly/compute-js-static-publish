/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  addSecret,
  errorCodeOf,
  parseGlobalOptions,
  redactSecrets,
} from '../../build/cli/cli/util/cli-output.js';

describe('parseGlobalOptions', () => {
  test('removes the global flags from argv', () => {
    const options = parseGlobalOptions([ 'publish-content', '--json', '--project-dir', 'site', '--local', '--non-interactive' ], {});
    assert.deepEqual(options, {
      json: true,
      nonInteractive: true,
      version: false,
      projectDir: 'site',
      argv: [ 'publish-content', '--local' ],
    });
  });

  test('--project-dir=<dir> and --version', () => {
    const options = parseGlobalOptions([ '--project-dir=a/b', '--version' ], {});
    assert.equal(options.projectDir, 'a/b');
    assert.equal(options.version, true);
  });

  test('--project-dir needs a value', () => {
    assert.equal(parseGlobalOptions([ '--project-dir' ], {}).code, 'usage');
    assert.equal(parseGlobalOptions([ '--project-dir', '--json' ], {}).code, 'usage');
  });

  test('the CI environment variable turns on non-interactive mode', () => {
    assert.equal(parseGlobalOptions([], { CI: 'true' }).nonInteractive, true);
    assert.equal(parseGlobalOptions([], { CI: '1' }).nonInteractive, true);
    assert.equal(parseGlobalOptions([], { CI: 'false' }).nonInteractive, false);
    assert.equal(parseGlobalOptions([], { CI: '' }).nonInteractive, false);
    assert.equal(parseGlobalOptions([], {}).nonInteractive, false);
  });

  test('keeps the arguments after --', () => {
    assert.deepEqual(parseGlobalOptions([ 'x', '--', '--json' ], {}).argv, [ 'x', '--', '--json' ]);
  });
});

describe('secrets', () => {
  test('a token in a flag is redacted from the output', () => {
    parseGlobalOptions([ '--fastly-api-token=token-value-1234' ], {});
    parseGlobalOptions([ '--s3-secret-access-key', 'secret-value-5678' ], {});
    assert.equal(redactSecrets('a token-value-1234 b secret-value-5678'), 'a [REDACTED] b [REDACTED]');
  });

  test('a short value is not treated as a secret', () => {
    addSecret('abc');
    assert.equal(redactSecrets('abcabc'), 'abcabc');
  });
});

describe('errorCodeOf', () => {
  test('missing credentials', () => {
    assert.equal(errorCodeOf(new Error('❌ Fastly API Token not provided.')), 'credentials-missing');
    assert.equal(errorCodeOf(new Error('❌ S3 Credentials not provided.')), 'credentials-missing');
  });

  test('a bad flag value', () => {
    assert.equal(errorCodeOf(new Error("❌ Unknown --purge-environment 'x'.")), 'usage');
  });

  test('anything else is a config error', () => {
    assert.equal(errorCodeOf(new Error('storage mode not recognized')), 'config-invalid');
  });
});
