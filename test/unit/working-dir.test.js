/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { checkStaticPublisherWorkingDir } from '../../build/cli/models/config/static-publish-rc.js';

describe('checkStaticPublisherWorkingDir()', () => {
  for (const value of [ './static-publisher', './a/b', '../static-publisher', './../x', '../../x', './a/../b' ]) {
    test(`accepts ${value}`, () => {
      assert.equal(checkStaticPublisherWorkingDir(value), null);
    });
  }
  for (const value of [ '/abs/path', 'static-publisher', './', '.', './..', '..', '../..', '../', './a/..', './/x', '.\\x', '', null, 42 ]) {
    test(`refuses ${JSON.stringify(value)}`, () => {
      assert.match(checkStaticPublisherWorkingDir(value) ?? '', /must be a relative path/);
    });
  }
});
