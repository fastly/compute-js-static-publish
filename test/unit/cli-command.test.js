/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { cliCommand, getOwnVersion } from '../../build/cli/cli/util/package.js';

describe('cliCommand()', () => {
  test('a stable version: no dist-tag, or @latest', () => {
    assert.equal(cliCommand({}, '8.1.0'), 'npx @fastly/compute-js-static-publish');
    assert.equal(cliCommand({ latest: true }, '8.1.0'), 'npx @fastly/compute-js-static-publish@latest');
  });

  test('a prerelease: the dist-tag of the prerelease, also for the command that makes a new app', () => {
    assert.equal(cliCommand({}, '8.1.0-beta.1'), 'npx @fastly/compute-js-static-publish@beta');
    assert.equal(cliCommand({ latest: true }, '8.1.0-beta.1'), 'npx @fastly/compute-js-static-publish@beta');
    assert.equal(cliCommand({}, '9.0.0-rc.2'), 'npx @fastly/compute-js-static-publish@rc');
  });

  test('without a version: the version of this package', () => {
    assert.equal(cliCommand(), cliCommand({}, getOwnVersion()));
  });
});
