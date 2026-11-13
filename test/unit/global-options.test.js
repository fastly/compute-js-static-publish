/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseGlobalOptions } from '../../build/cli/cli/util/global-options.js';
import { addSecret, redactSecrets } from '../../build/cli/cli/util/output.js';

describe('parseGlobalOptions()', () => {
  test('removes the global options from the arguments', () => {
    assert.deepEqual(parseGlobalOptions([ 'publish-content', '--project-dir', './app', '--local' ]), {
      projectDir: './app', version: false, nonInteractive: false, json: false, secrets: [], argv: [ 'publish-content', '--local' ],
    });
    assert.deepEqual(parseGlobalOptions([ '--project-dir=./app', 'collections', 'list' ]), {
      projectDir: './app', version: false, nonInteractive: false, json: false, secrets: [], argv: [ 'collections', 'list' ],
    });
    assert.deepEqual(parseGlobalOptions([ 'clean', '--version', '--non-interactive' ]), {
      projectDir: undefined, version: true, nonInteractive: true, json: false, secrets: [], argv: [ 'clean' ],
    });
    assert.deepEqual(parseGlobalOptions([]), {
      projectDir: undefined, version: false, nonInteractive: false, json: false, secrets: [], argv: [],
    });
  });

  test('--json', () => {
    assert.deepEqual(parseGlobalOptions([ 'collections', '--json', 'list' ]), {
      projectDir: undefined, version: false, nonInteractive: false, json: true, secrets: [], argv: [ 'collections', 'list' ],
    });
  });

  test('the CI environment variable turns on non-interactive mode', () => {
    for (const value of [ 'true', '1', 'yes' ]) {
      assert.equal(parseGlobalOptions([], { CI: value }).nonInteractive, true, value);
    }
    for (const value of [ undefined, '', 'false', '0' ]) {
      assert.equal(parseGlobalOptions([], { CI: value }).nonInteractive, false, String(value));
    }
  });

  test('the values of the options with a secret are collected, and stay in argv', () => {
    const options = parseGlobalOptions([ 'clean', '--fastly-api-token=token-1234567', '--s3-secret-access-key', 'key-1234567' ]);
    assert.deepEqual(options.secrets, [ 'token-1234567', 'key-1234567' ]);
    assert.deepEqual(options.argv, [ 'clean', '--fastly-api-token=token-1234567', '--s3-secret-access-key', 'key-1234567' ]);
  });

  test('a secret option followed by another option has no value', () => {
    const options = parseGlobalOptions([ 'clean', '--fastly-api-token', '--verbose' ]);
    assert.deepEqual(options.secrets, []);
  });

  test('--project-dir needs one value', () => {
    for (const args of [ [ '--project-dir' ], [ '--project-dir=' ], [ '--project-dir', '--local' ] ]) {
      assert.match(parseGlobalOptions(args).error, /needs a directory/, args.join(' '));
    }
    assert.match(parseGlobalOptions([ '--project-dir=a', '--project-dir=b' ]).error, /only one time/);
  });
});

describe('redactSecrets()', () => {
  test('replaces each secret, and ignores very short values', () => {
    addSecret('secret-value-1');
    addSecret('short');
    addSecret(undefined);
    assert.equal(redactSecrets('a secret-value-1 b secret-value-1'), 'a [REDACTED] b [REDACTED]');
    assert.equal(redactSecrets('a short b'), 'a short b');
  });
});
