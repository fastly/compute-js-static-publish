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
  const run = (args) => runCli([ ...args, '--non-interactive' ], { cwd: dir, env }).output;
  // The value of a line '<label>   : <value>' in the output of status.
  const statusValue = (output, label) => {
    const line = output.split('\n').find(x => x.startsWith(`${label} `) && x.includes(' : '));
    return line?.slice(line.indexOf(' : ') + 3).trim();
  };

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
    const first = run([ 'deploy', '--force', '--comment', 'e2e' ]);
    assert.match(first, new RegExp(`🎉 Deployed ${process.env.CJSP_TEST_DEPLOY_SERVICE_ID} version \\d+`));

    const status = run([ 'status' ]);
    assert.match(statusValue(status, 'Deployed fingerprint'), new RegExp(`^${statusValue(status, 'Fingerprint')} \\(version \\d+\\)$`));
    assert.equal(statusValue(status, 'Deploy necessary'), 'no');
  });

  test('a second deploy with no change does nothing', () => {
    const second = run([ 'deploy' ]);
    assert.match(second, /Nothing to deploy/);
  });
});
