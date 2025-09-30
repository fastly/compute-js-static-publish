/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { SecretStore } from 'fastly:secret-store';
import { FetchHttpHandler } from '@smithy/fetch-http-handler';
import {
  GetObjectCommand,
  GetObjectCommandInput,
  GetObjectCommandOutput,
  S3Client,
  S3ServiceException
} from '@aws-sdk/client-s3';

import {
  isS3StorageConfigRc,
  type StaticPublishRc,
} from '../../models/config/static-publish-rc.js';
import {
  getS3StorageConfigFromRc,
} from '../../models/config/s3-storage-config.js';
import {
  concatReadableStreams,
  type StorageEntry,
  StorageEntryImpl,
  type StorageProvider,
  StorageProviderBuilder,
} from './storage-provider.js';

export type AwsCredentials = {
  accessKeyId: string,
  secretAccessKey: string,
};

export type AwsCredentialsBuilder = () => (AwsCredentials | Promise<AwsCredentials>);

export const buildStoreProvider: StorageProviderBuilder = (config: StaticPublishRc) => {
  if (!isS3StorageConfigRc(config)) {
    return null;
  }
  const s3StorageConfig = getS3StorageConfigFromRc(config);
  return new S3StorageProvider(
    s3StorageConfig.region,
    s3StorageConfig.bucket,
    {
      s3Endpoint: s3StorageConfig.endpoint,
      s3FastlyBackendName: s3StorageConfig.fastlyBackendName,
    },
  );
};

let _secretStoreForAwsCredentials = 'AWS_CREDENTIALS';
let _secretStoreKeyForAwsAccessKeyId = 'AWS_ACCESS_KEY_ID';
let _secretStoreKeyForAwsSecretAccessKey = 'AWS_SECRET_ACCESS_KEY';

export function setSecretStoreForAwsCredentials(secretStoreName: string) {
  _secretStoreForAwsCredentials = secretStoreName;
}

export function setSecretStoreKeyForAwsAccessKeyId(secretStoreKey: string) {
  _secretStoreKeyForAwsAccessKeyId = secretStoreKey;
}

export function setSecretStoreKeyForAwsSecretAccessKey(secretStoreKey: string) {
  _secretStoreKeyForAwsSecretAccessKey = secretStoreKey;
}

export async function buildAwsCredentialsFromSecretStore() {
  let secretStore;
  try {
    secretStore = new SecretStore(_secretStoreForAwsCredentials);
  } catch {
    throw new Error(`Could not open secret store for AWS credentials: ${_secretStoreForAwsCredentials}`);
  }
  const accessKeyIdEntry = await secretStore.get(_secretStoreKeyForAwsAccessKeyId);
  if (accessKeyIdEntry == null) {
    throw new Error(`Could not retrieve value '${_secretStoreKeyForAwsAccessKeyId}' in secret store '${_secretStoreForAwsCredentials}'`);
  }
  const accessKeyId = accessKeyIdEntry.plaintext();

  const secretAccessKeyEntry = await secretStore.get(_secretStoreKeyForAwsSecretAccessKey);
  if (secretAccessKeyEntry == null) {
    throw new Error(`Could not retrieve value '${_secretStoreKeyForAwsSecretAccessKey}' in secret store '${_secretStoreForAwsCredentials}'`);
  }
  const secretAccessKey = secretAccessKeyEntry.plaintext();

  return {
    accessKeyId,
    secretAccessKey,
  };
}

let _awsCredentialsBuilder: AwsCredentialsBuilder = buildAwsCredentialsFromSecretStore;
export function setAwsCredentialsBuilder(awsCredentialsBuilder: AwsCredentialsBuilder) {
  _awsCredentialsBuilder = awsCredentialsBuilder;
}

export type S3StorageProviderParams = {
  s3Endpoint?: string,
  s3FastlyBackendName?: string,
};

export class S3StorageProvider implements StorageProvider {
  constructor(
    s3Region: string,
    s3Bucket: string,
    params?: S3StorageProviderParams,
  ) {
    this.s3Region = s3Region;
    this.s3Bucket = s3Bucket;
    this.s3Endpoint = params?.s3Endpoint;
    this.s3FastlyBackendName = params?.s3FastlyBackendName;
  }

  private readonly s3Region: string;
  private readonly s3Bucket: string;
  private readonly s3Endpoint?: string;
  private readonly s3FastlyBackendName?: string;

  private s3Client?: S3Client;
  async getS3Client() {
    if (this.s3Client != null) {
      return this.s3Client;
    }
    const awsCredentials = await _awsCredentialsBuilder();
    const s3FastlyBackendName = this.s3FastlyBackendName ?? "aws";
    this.s3Client = new S3Client({
      region: this.s3Region,
      endpoint: this.s3Endpoint,
      forcePathStyle: this.s3Endpoint != null,
      credentials: {
        accessKeyId: awsCredentials.accessKeyId,
        secretAccessKey: awsCredentials.secretAccessKey,
      },
      maxAttempts: 1,
      requestHandler: new FetchHttpHandler({
        requestInit() { return { backend: s3FastlyBackendName } }
      }),
    });
    return this.s3Client;
  }

  async getEntry(key: string): Promise<StorageEntry | null> {

    const input = {
      Bucket: this.s3Bucket, // required
      Key: key,              // required
    } satisfies GetObjectCommandInput;
    const command = new GetObjectCommand(input);
    let response: GetObjectCommandOutput;
    try {
      const s3Client = await this.getS3Client();
      response = await s3Client.send(command);
    } catch(err) {
      if (err instanceof S3ServiceException && (err.name === "NotFound" || err.name === "NoSuchKey")) {
        console.log("Object does not exist");
        return null;
      } else {
        throw err; // some other problem (auth, network, etc.)
      }
    }
    if (response.Body == null) {
      return null;
    }

    const body = concatReadableStreams([response.Body.transformToWebStream()]);
    const metadataText = JSON.stringify(response.Metadata ?? {});

    return new StorageEntryImpl(body, metadataText);
  }
}
