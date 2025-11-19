/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

export type LoadAwsCredentialsResult = {
  awsAccessKeyId: string,
  awsSecretAccessKey: string,
  source: string,
};

export type LoadAwsCredentialsParams = {
  awsAccessKeyId?: any,
  awsSecretAccessKey?: any,
};

export async function loadAwsCredentials(params: LoadAwsCredentialsParams): Promise<LoadAwsCredentialsResult | null> {

  let awsAccessKeyId: string | null = null;
  let awsSecretAccessKey: string | null = null;
  let source: string = '';

  // Try command line arg
  if (
    typeof params.awsAccessKeyId === 'string' &&
    typeof params.awsSecretAccessKey === 'string'
  ) {
    const id = params.awsAccessKeyId.trim() || null;
    const key = params.awsSecretAccessKey.trim() || null;
    if (id != null && key != null) {
      awsAccessKeyId = id;
      awsSecretAccessKey = key;
      source = 'commandline';
    }
  }

  // Try env (AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY)
  if (awsAccessKeyId == null && awsSecretAccessKey == null) {
    const id = process.env.AWS_ACCESS_KEY_ID || null;
    const key = process.env.AWS_SECRET_ACCESS_KEY || null;
    if (id != null && key != null) {
      awsAccessKeyId = id;
      awsSecretAccessKey = key;
      source = 'env';
    }
  }

  if (awsAccessKeyId == null || awsSecretAccessKey == null) {
    return null;
  }

  return {
    awsAccessKeyId,
    awsSecretAccessKey,
    source,
  };
}