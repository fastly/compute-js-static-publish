/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isSdkVersionAtLeast } from '../../build/server/server/util/sdk-version.js';

describe('isSdkVersionAtLeast', () => {
  test('compares the major and minor versions', () => {
    assert.equal(isSdkVersionAtLeast('4.2.0', 4, 2), true);
    assert.equal(isSdkVersionAtLeast('4.3.0', 4, 2), true);
    assert.equal(isSdkVersionAtLeast('4.10.1', 4, 2), true);
    assert.equal(isSdkVersionAtLeast('5.0.0', 4, 2), true);
    assert.equal(isSdkVersionAtLeast('4.1.9', 4, 2), false);
    assert.equal(isSdkVersionAtLeast('3.40.0', 4, 2), false);
  });

  test('accepts a prerelease version', () => {
    assert.equal(isSdkVersionAtLeast('4.2.0-beta.1', 4, 2), true);
  });

  test('gives false for a version that is missing or cannot be read', () => {
    assert.equal(isSdkVersionAtLeast(undefined, 4, 2), false);
    assert.equal(isSdkVersionAtLeast(null, 4, 2), false);
    assert.equal(isSdkVersionAtLeast('', 4, 2), false);
    assert.equal(isSdkVersionAtLeast('dev', 4, 2), false);
  });
});
