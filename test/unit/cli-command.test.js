/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import { cliCommand, getOwnPackageDir, getOwnVersion, isLocalCopy } from '../../build/cli/cli/util/package.js';

describe('cliCommand()', () => {
  test('a stable version: no dist-tag, or @latest', () => {
    assert.equal(cliCommand({}, '8.1.0', false), 'npx @fastly/compute-js-static-publish');
    assert.equal(cliCommand({ latest: true }, '8.1.0', false), 'npx @fastly/compute-js-static-publish@latest');
  });

  test('a prerelease: the dist-tag of the prerelease, also for the command that makes a new app', () => {
    assert.equal(cliCommand({}, '8.1.0-beta.1', false), 'npx @fastly/compute-js-static-publish@beta');
    assert.equal(cliCommand({ latest: true }, '8.1.0-beta.1', false), 'npx @fastly/compute-js-static-publish@beta');
    assert.equal(cliCommand({}, '9.0.0-rc.2', false), 'npx @fastly/compute-js-static-publish@rc');
  });

  test('a copy that a plain npx runs: no dist-tag, also for a prerelease', () => {
    assert.equal(cliCommand({}, '8.1.0-beta.1', true), 'npx @fastly/compute-js-static-publish');
    assert.equal(cliCommand({ latest: true }, '8.1.0-beta.1', true), 'npx @fastly/compute-js-static-publish');
    assert.equal(cliCommand({ latest: true }, '8.1.0', true), 'npx @fastly/compute-js-static-publish');
  });

  test('without arguments: the version and the place of this copy', () => {
    assert.equal(cliCommand(), cliCommand({}, getOwnVersion(), isLocalCopy()));
  });
});

describe('isLocalCopy()', () => {
  const makeProject = (target) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cjsp-local-copy-'));
    if (target != null) {
      fs.mkdirSync(path.join(dir, 'node_modules', '@fastly'), { recursive: true });
      fs.symlinkSync(target, path.join(dir, 'node_modules', '@fastly', 'compute-js-static-publish'));
    }
    return dir;
  };

  test('true in a project that has this copy, also in a subdirectory', () => {
    const dir = makeProject(getOwnPackageDir());
    try {
      assert.equal(isLocalCopy(dir), true);
      fs.mkdirSync(path.join(dir, 'public'));
      assert.equal(isLocalCopy(path.join(dir, 'public')), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('false in a project that has another copy, or none', () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'cjsp-other-copy-'));
    const withOther = makeProject(other);
    const withNone = makeProject(null);
    try {
      assert.equal(isLocalCopy(withOther), false);
      assert.equal(isLocalCopy(withNone), false);
    } finally {
      for (const dir of [ other, withOther, withNone ]) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});
