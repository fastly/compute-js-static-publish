/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Publishes to a real S3-compatible bucket, and serves the content with
// `fastly compute serve`. Set these environment variables:
//   S3_ACCESS_KEY_ID          an access key ID that can read and write the bucket
//   S3_SECRET_ACCESS_KEY      the secret access key
//   CJSP_TEST_S3_REGION       the region of the bucket
//   CJSP_TEST_S3_BUCKET       the name of a bucket to use for tests
// Optional:
//   CJSP_TEST_S3_ENDPOINT     the endpoint, for storage that is not AWS S3
//   CJSP_TEST_SERVICE_ID      a Service ID to purge after publishing. Then
//                             FASTLY_API_TOKEN must be able to purge this service.

import { describe } from 'node:test';

import { skipUnlessEnv, skipUnlessFastlyCli } from './helpers.js';
import { defineStoragePublishTests } from './storage-publish.js';

const skip =
  skipUnlessEnv('S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'CJSP_TEST_S3_REGION', 'CJSP_TEST_S3_BUCKET') ||
  skipUnlessFastlyCli();

describe('S3-compatible storage', { skip }, () => {
  const scaffoldArgs = [
    '--storage-mode', 's3',
    '--s3-region', process.env.CJSP_TEST_S3_REGION,
    '--s3-bucket', process.env.CJSP_TEST_S3_BUCKET,
  ];
  if (process.env.CJSP_TEST_S3_ENDPOINT) {
    scaffoldArgs.push('--s3-endpoint', process.env.CJSP_TEST_S3_ENDPOINT);
  }
  defineStoragePublishTests({
    storageMode: 's3',
    scaffoldArgs,
    serve: true,
    purgeServiceId: process.env.CJSP_TEST_SERVICE_ID,
  });
});
