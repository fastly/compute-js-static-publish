/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Publishes to a real KV Store. Set these environment variables:
//   FASTLY_API_TOKEN         an API token that can write to the KV Store
//   CJSP_TEST_KV_STORE_NAME  the name of a KV Store to use for tests
// Optional:
//   CJSP_TEST_SERVICE_ID     a Service ID to purge after publishing. The API
//                            token must be able to purge this service.

import { describe } from 'node:test';

import { skipUnlessEnv } from './helpers.js';
import { defineStoragePublishTests } from './storage-publish.js';

describe('KV Store', { skip: skipUnlessEnv('FASTLY_API_TOKEN', 'CJSP_TEST_KV_STORE_NAME') }, () => {
  defineStoragePublishTests({
    storageMode: 'kv-store',
    scaffoldArgs: [ '--kv-store-name', process.env.CJSP_TEST_KV_STORE_NAME ],
    purgeServiceId: process.env.CJSP_TEST_SERVICE_ID,
  });
});
