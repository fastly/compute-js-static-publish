/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

/**
 * The AWS S3 host name of a bucket, for the backend of the app:
 * <bucket>.s3.<region>.amazonaws.com. The server uses the same host name for a
 * bucket without an endpoint (see objectUrl() in
 * src/server/storage/s3-storage-provider.ts). It needs no credentials and no
 * network.
 *
 * Returns null for a bucket name with a dot: under HTTPS, such a name does not
 * match the certificate of *.s3.<region>.amazonaws.com. Such a bucket needs
 * an endpoint, so that the bucket is in the path of the URL.
 */
export function findHostnameForAwsS3RegionAndBucket(region: string, bucket: string): string | null {
  if (bucket.includes('.')) {
    return null;
  }
  return `${bucket}.s3.${region}.amazonaws.com`;
}
