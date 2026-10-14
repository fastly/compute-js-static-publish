/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

export type LoadS3CredentialsResult = {
  s3AccessKeyId: string,
  s3SecretAccessKey: string,
  source: string,
};

export type LoadS3CredentialsParams = {
  s3AccessKeyId?: any,
  s3SecretAccessKey?: any,
};

export async function loadS3Credentials(params: LoadS3CredentialsParams): Promise<LoadS3CredentialsResult | null> {

  let s3AccessKeyId: string | null = null;
  let s3SecretAccessKey: string | null = null;
  let source: string = '';

  // Try command line arg
  if (
    typeof params.s3AccessKeyId === 'string' &&
    typeof params.s3SecretAccessKey === 'string'
  ) {
    const id = params.s3AccessKeyId.trim() || null;
    const key = params.s3SecretAccessKey.trim() || null;
    if (id != null && key != null) {
      s3AccessKeyId = id;
      s3SecretAccessKey = key;
      source = 'commandline';
    }
  }

  // Try env (S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY)
  if (s3AccessKeyId == null && s3SecretAccessKey == null) {
    const id = process.env.S3_ACCESS_KEY_ID || null;
    const key = process.env.S3_SECRET_ACCESS_KEY || null;
    if (id != null && key != null) {
      s3AccessKeyId = id;
      s3SecretAccessKey = key;
      source = 'env';
    }
  }

  if (s3AccessKeyId == null || s3SecretAccessKey == null) {
    return null;
  }

  return {
    s3AccessKeyId,
    s3SecretAccessKey,
    source,
  };
}