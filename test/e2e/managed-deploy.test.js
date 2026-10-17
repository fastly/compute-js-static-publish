/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Deploys a managed project to a real service, two times. The second deploy
// must do nothing, because the fingerprint did not change. Needs the Fastly CLI
// and the variables below. The test replaces the active version of the service.

import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { makeTempDir, removeDir, runCli, skipUnlessEnv, skipUnlessFastlyCli, writeFixtureContent } from './helpers.js';

const skip = skipUnlessEnv('FASTLY_API_TOKEN', 'CJSP_TEST_KV_STORE_NAME', 'CJSP_TEST_DEPLOY_SERVICE_ID') || skipUnlessFastlyCli();

describe('deploy of a managed project', { skip }, () => {
  let dir;
  const env = { FASTLY_SERVICE_ID: process.env.CJSP_TEST_DEPLOY_SERVICE_ID };
  const runJson = (args) => JSON.parse(runCli([ ...args, '--json', '--non-interactive' ], { cwd: dir, env }).stdout);

  before(() => {
    dir = makeTempDir('managed-deploy');
    writeFixtureContent(path.resolve(dir, 'public'));
    runCli([ '--managed', '--root-dir', './public', '--kv-store-name', process.env.CJSP_TEST_KV_STORE_NAME ], { cwd: dir });
  });

  after(() => {
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('the first deploy deploys, and records the fingerprint', () => {
    const first = runJson([ 'deploy', '--force', '--comment', 'e2e' ]);
    assert.equal(first.deployed, true);
    assert.equal(first.serviceId, process.env.CJSP_TEST_DEPLOY_SERVICE_ID);
    assert.equal(typeof first.version, 'number');

    const status = runJson([ 'status' ]);
    assert.equal(status.fingerprint.deployed, first.fingerprint);
    assert.equal(status.needsDeploy, false);
  });

  test('a second deploy with no change does nothing', () => {
    const second = runJson([ 'deploy' ]);
    assert.equal(second.deployed, false);
    assert.equal(second.reason, 'up-to-date');
  });
});
