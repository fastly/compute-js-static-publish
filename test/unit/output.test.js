/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  CLI_ERROR_CODES,
  EXIT_FAILED,
  EXIT_USAGE,
  errorCodeOf,
  exitCodeOf,
} from '../../build/cli/cli/util/output.js';

const README = fs.readFileSync(path.resolve(import.meta.dirname, '../../README.md'), 'utf-8');

describe('error codes', () => {
  test('exit 1 only for a failed operation', () => {
    assert.equal(exitCodeOf('failed'), EXIT_FAILED);
    assert.equal(exitCodeOf('deploy-failed'), EXIT_FAILED);
    assert.equal(exitCodeOf('usage'), EXIT_USAGE);
    assert.equal(exitCodeOf('collection-name-invalid'), EXIT_USAGE);
  });

  test('the README lists each code with its exit code', () => {
    const rows = [ ...README.matchAll(/^\| `([a-z-]+)` \| `(\d)` \|/gm) ].map(m => [ m[1], Number(m[2]) ]);
    assert.deepEqual(
      rows.sort(),
      CLI_ERROR_CODES.map(code => [ code, exitCodeOf(code) ]).sort(),
    );
  });
});

describe('errorCodeOf()', () => {
  test('missing credentials', () => {
    assert.equal(errorCodeOf(new Error('❌ Fastly API Token not provided.')), 'credentials-missing');
    assert.equal(errorCodeOf(new Error('❌ S3 Credentials not provided.')), 'credentials-missing');
  });

  test('an incorrect option value', () => {
    assert.equal(errorCodeOf(new Error("❌ Unknown --purge-environment 'x'.")), 'usage');
    assert.equal(errorCodeOf(new Error('--local is available only in KV Store mode.')), 'usage');
  });

  test('any other error is a config error', () => {
    assert.equal(errorCodeOf(new Error('storage mode not recognized')), 'config-invalid');
  });
});
