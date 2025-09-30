/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import {
  type StaticPublishS3Storage,
} from './static-publish-rc.js';

export type S3StorageConfig = {
  region: string,
  bucket: string,
  endpoint?: string,
  fastlyBackendName?: string,
};

export function getS3StorageConfigFromRc(rc: StaticPublishS3Storage): S3StorageConfig {
  return {
    region: rc.s3.region,
    bucket: rc.s3.bucket,
    endpoint: rc.s3.endpoint,
    fastlyBackendName: rc.s3.fastlyBackendName,
  };
}
