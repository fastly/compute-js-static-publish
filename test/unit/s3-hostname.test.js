/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { findHostnameForAwsS3RegionAndBucket } from '../../build/cli/cli/util/s3.js';

describe('findHostnameForAwsS3RegionAndBucket()', () => {
  test('the virtual-hosted host name, as the server uses it', () => {
    assert.equal(findHostnameForAwsS3RegionAndBucket('us-east-1', 'my-bucket'), 'my-bucket.s3.us-east-1.amazonaws.com');
    assert.equal(findHostnameForAwsS3RegionAndBucket('eu-west-2', 'site-content'), 'site-content.s3.eu-west-2.amazonaws.com');
  });

  test('null for a bucket name with a dot', () => {
    assert.equal(findHostnameForAwsS3RegionAndBucket('us-east-1', 'my.bucket'), null);
  });
});
