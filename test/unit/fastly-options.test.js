/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { findRefusedFastlyOption } from '../../build/cli/cli/util/fastly-options.js';

describe('findRefusedFastlyOption', () => {
  test('passes other options', () => {
    assert.equal(findRefusedFastlyOption([]), null);
    assert.equal(findRefusedFastlyOption([ '--status-check-timeout=180', '-i', '--version', 'latest' ]), null);
    assert.equal(findRefusedFastlyOption([ '-iyv', '--status-check-path', '/health', '--service-name=site' ]), null);
  });

  const refused = [
    [ '--comment=x', /^--comment cannot/ ],
    [ '--comment', /^--comment cannot/ ],
    [ '--service-id=abc', /^--service-id cannot.*--fastly-service-id/ ],
    [ '--token', /^--token cannot.*--fastly-api-token/ ],
    [ '--package=pkg.tar.gz', /^--package cannot/ ],
    [ '--dir=..', /^--dir cannot/ ],
    [ '--env=stage', /^--env cannot/ ],
    [ '-s', /^-s \(--service-id\) cannot/ ],
    [ '-sabc', /^-s \(--service-id\) cannot/ ],
    [ '-s=abc', /^-s \(--service-id\) cannot/ ],
    [ '-is', /^-s \(--service-id\) cannot/ ],
    [ '-t', /^-t \(--token\) cannot/ ],
    [ '-p', /^-p \(--package\) cannot/ ],
    [ '-C', /^-C \(--dir\) cannot/ ],
  ];
  for (const [ arg, message ] of refused) {
    test(`refuses ${arg}`, () => {
      assert.match(findRefusedFastlyOption([ '-i', arg, 'value' ]), message);
    });
  }

  test('a name of Object.prototype is not an option', () => {
    assert.equal(findRefusedFastlyOption([ '--toString', '--constructor=x' ]), null);
  });

  test('-c is not -C', () => {
    assert.equal(findRefusedFastlyOption([ '-c' ]), null);
  });
});
