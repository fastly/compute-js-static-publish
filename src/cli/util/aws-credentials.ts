export type LoadAwsCredentialsResult = {
  awsAccessKeyId: string,
  awsSecretAccessKey: string,
  source: string,
};

export type LoadAwsCredentialsParams = {
  awsAccessKeyId?: any,
  awsSecretAccessKey?: any,
};

export function loadAwsCredentials(params: LoadAwsCredentialsParams): LoadAwsCredentialsResult | null {

  let awsAccessKeyId: string | null = null;
  let awsSecretAccessKey: string | null = null;
  let source: string = '';

  // Try command line arg
  if (
    typeof params.awsAccessKeyId === 'string' &&
    typeof params.awsSecretAccessKey === 'string'
  ) {
    awsAccessKeyId = params.awsAccessKeyId.trim();
    awsSecretAccessKey = params.awsSecretAccessKey.trim();
    source = 'commandline';
  }

  // Try env (AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY)
  if (awsAccessKeyId == null && awsSecretAccessKey == null) {
    const envAwsAccessKeyId = process.env.AWS_ACCESS_KEY_ID || null;
    const envAwsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || null;
    if (envAwsAccessKeyId != null && envAwsSecretAccessKey != null) {
      awsAccessKeyId = envAwsAccessKeyId;
      awsSecretAccessKey = envAwsSecretAccessKey;
      source = 'env';
    }
  }

  // TODO: try aws cli

  if (awsAccessKeyId == null || awsSecretAccessKey == null) {
    return null;
  }

  return {
    awsAccessKeyId,
    awsSecretAccessKey,
    source,
  };
}