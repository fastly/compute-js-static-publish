/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

import { loadApiToken } from '../../build/cli/cli/util/api-token.js';
import { loadPurgeTarget, parsePurgeEnvironments } from '../../build/cli/cli/util/purge.js';
import { loadServiceId } from '../../build/cli/cli/util/service-id.js';

// Saves and restores the environment variables that these tests change.
const ENV_NAMES = [ 'FASTLY_API_TOKEN', 'FASTLY_SERVICE_ID' ];
const savedEnv = {};
before(() => {
  for (const name of ENV_NAMES) {
    savedEnv[name] = process.env[name];
  }
});
beforeEach(() => {
  for (const name of ENV_NAMES) {
    delete process.env[name];
  }
});
after(() => {
  for (const name of ENV_NAMES) {
    if (savedEnv[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = savedEnv[name];
    }
  }
});

let tempDir;
before(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cjsp-unit-'));
});
after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function writeFastlyToml(serviceId) {
  const fastlyTomlPath = path.resolve(tempDir, 'fastly.toml');
  const serviceIdLine = serviceId != null ? `service_id = "${serviceId}"\n` : '';
  fs.writeFileSync(fastlyTomlPath, `manifest_version = 3\nname = "app"\n${serviceIdLine}`);
  return fastlyTomlPath;
}

describe('parsePurgeEnvironments', () => {
  test('the default is production', () => {
    assert.deepEqual(parsePurgeEnvironments(undefined), [ 'production' ]);
    assert.deepEqual(parsePurgeEnvironments([]), [ 'production' ]);
  });

  test('accepts repeated options and comma-separated lists, without duplicates', () => {
    assert.deepEqual(parsePurgeEnvironments([ 'staging' ]), [ 'staging' ]);
    assert.deepEqual(parsePurgeEnvironments([ 'production,staging', 'staging' ]), [ 'production', 'staging' ]);
    assert.deepEqual(parsePurgeEnvironments(' staging , production '), [ 'staging', 'production' ]);
  });

  test('rejects an unknown environment', () => {
    assert.throws(() => parsePurgeEnvironments([ 'prod' ]), /Unknown --purge-environment 'prod'/);
  });
});

describe('loadServiceId', () => {
  test('uses the command line first', () => {
    process.env.FASTLY_SERVICE_ID = 'from-env';
    const fastlyTomlPath = writeFastlyToml('from-toml');
    assert.deepEqual(loadServiceId({ commandLine: 'from-cli', fastlyTomlPath }), { serviceId: 'from-cli', source: 'commandline' });
  });

  test('then fastly.toml', () => {
    process.env.FASTLY_SERVICE_ID = 'from-env';
    const fastlyTomlPath = writeFastlyToml('from-toml');
    assert.deepEqual(loadServiceId({ commandLine: undefined, fastlyTomlPath }), { serviceId: 'from-toml', source: 'fastly.toml' });
  });

  test('then the FASTLY_SERVICE_ID environment variable', () => {
    process.env.FASTLY_SERVICE_ID = 'from-env';
    const fastlyTomlPath = writeFastlyToml(null);
    assert.deepEqual(loadServiceId({ commandLine: undefined, fastlyTomlPath }), { serviceId: 'from-env', source: 'env' });
  });

  test('gives null if no Service ID is found', () => {
    const fastlyTomlPath = writeFastlyToml(null);
    assert.equal(loadServiceId({ commandLine: undefined, fastlyTomlPath }), null);
    assert.equal(loadServiceId({ commandLine: undefined, fastlyTomlPath: path.resolve(tempDir, 'missing.toml') }), null);
  });
});

describe('loadApiToken', () => {
  test('uses the command line first, then FASTLY_API_TOKEN', () => {
    process.env.FASTLY_API_TOKEN = 'env-token';
    assert.deepEqual(loadApiToken({ commandLine: 'cli-token' }), { apiToken: 'cli-token', source: 'commandline' });
    assert.deepEqual(loadApiToken({ commandLine: undefined }), { apiToken: 'env-token', source: 'env' });
  });

  test('gives null if no token is found', () => {
    assert.equal(loadApiToken({ commandLine: undefined }), null);
  });
});

describe('loadPurgeTarget', () => {
  const params = (overrides) => ({
    localMode: false,
    computeAppDir: tempDir,
    fastlyServiceId: undefined,
    fastlyApiToken: undefined,
    purgeEnvironments: undefined,
    ...overrides,
  });

  test('skips the purge in local mode', () => {
    writeFastlyToml('from-toml');
    assert.equal(loadPurgeTarget(params({ localMode: true, fastlyApiToken: 'token' })), null);
  });

  test('skips the purge if no Service ID is found', () => {
    writeFastlyToml(null);
    assert.equal(loadPurgeTarget(params({ fastlyApiToken: 'token' })), null);
  });

  test('fails if there is a Service ID but no API token', () => {
    writeFastlyToml('from-toml');
    assert.throws(() => loadPurgeTarget(params({})), /API Token not provided/);
  });

  test('gives the purge target', () => {
    writeFastlyToml(null);
    assert.deepEqual(loadPurgeTarget(params({
      fastlyServiceId: 'service',
      fastlyApiToken: 'token',
      purgeEnvironments: [ 'staging' ],
    })), {
      serviceId: 'service',
      fastlyApiContext: { apiToken: 'token' },
      environments: [ 'staging' ],
    });
  });

  test('reports an unknown environment also in local mode', () => {
    assert.throws(() => loadPurgeTarget(params({ localMode: true, purgeEnvironments: [ 'prod' ] })), /Unknown --purge-environment/);
  });
});
