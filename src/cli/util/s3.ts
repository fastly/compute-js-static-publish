/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { BuildMiddleware, BuildHandlerArguments } from '@smithy/types';

const DUMMY_KEY = 'dummy.dat'; // placeholder, never sent over the network

/**
 * Resolve the AWS S3 hostname for a given region and bucket.
 * - Uses client-s3's own endpoint resolution logic (so it's always accurate).
 * - No network calls; intercepts at the build step.
 */
export async function findHostnameForAwsS3RegionAndBucket(region: string, bucket: string): Promise<string> {
  const client = new S3Client({ region });
  let hostname = '';

  const captureHostname: BuildMiddleware<any, any> =
    (_next) => async (args: BuildHandlerArguments<any>) => {
      if (typeof args.request === 'object' &&
        args.request != null &&
        'hostname' in args.request &&
        typeof args.request['hostname'] === 'string'
      ) {
        hostname = args.request['hostname'];
      }
      const err: any = new Error('SHORT_CIRCUIT');
      err.name = 'SHORT_CIRCUIT';
      throw err; // short-circuit before auth/send
    };

  client.middlewareStack.add(captureHostname, {
    name: 'captureS3Hostname',
    step: 'build',
    priority: 'high', // run early in build
  });

  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: DUMMY_KEY }));
  } catch (e: unknown) {
    if (
      typeof e !== 'object' ||
      e == null ||
      !('name' in e) ||
      e.name !== 'SHORT_CIRCUIT'
    ) {
      throw e;
    }
  }
  return hostname;
}
