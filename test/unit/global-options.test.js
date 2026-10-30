/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseGlobalOptions } from '../../build/cli/cli/util/global-options.js';

describe('parseGlobalOptions()', () => {
  test('removes the global options from the arguments', () => {
    assert.deepEqual(parseGlobalOptions([ 'publish-content', '--project-dir', './app', '--local' ]), {
      projectDir: './app', version: false, argv: [ 'publish-content', '--local' ],
    });
    assert.deepEqual(parseGlobalOptions([ '--project-dir=./app', 'collections', 'list' ]), {
      projectDir: './app', version: false, argv: [ 'collections', 'list' ],
    });
    assert.deepEqual(parseGlobalOptions([ 'clean', '--version' ]), {
      projectDir: undefined, version: true, argv: [ 'clean' ],
    });
    assert.deepEqual(parseGlobalOptions([]), {
      projectDir: undefined, version: false, argv: [],
    });
  });

  test('--project-dir needs one value', () => {
    for (const args of [ [ '--project-dir' ], [ '--project-dir=' ], [ '--project-dir', '--local' ] ]) {
      assert.match(parseGlobalOptions(args).error, /needs a directory/, args.join(' '));
    }
    assert.match(parseGlobalOptions([ '--project-dir=a', '--project-dir=b' ]).error, /only one time/);
  });
});
