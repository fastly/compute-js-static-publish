/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { CacheOverride } from 'fastly:cache-override';
import { SecretStore } from 'fastly:secret-store';
import { Command } from '@smithy/types';
import { FetchHttpHandler } from '@smithy/fetch-http-handler';
import {
  GetObjectCommand,
  GetObjectCommandInput,
  GetObjectCommandOutput,
  S3Client,
  S3ClientResolvedConfig,
  S3ServiceException,
  ServiceInputTypes,
  ServiceOutputTypes,
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

export type S3Credentials = {
  accessKeyId: string,
  secretAccessKey: string,
};

export type S3CredentialsBuilder = () => (S3Credentials | Promise<S3Credentials>);

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

let _secretStoreForS3Credentials = 'S3_CREDENTIALS';
let _secretStoreKeyForS3AccessKeyId = 'S3_ACCESS_KEY_ID';
let _secretStoreKeyForS3SecretAccessKey = 'S3_SECRET_ACCESS_KEY';

export function setSecretStoreForS3Credentials(secretStoreName: string) {
  _secretStoreForS3Credentials = secretStoreName;
}

export function setSecretStoreKeyForS3AccessKeyId(secretStoreKey: string) {
  _secretStoreKeyForS3AccessKeyId = secretStoreKey;
}

export function setSecretStoreKeyForS3SecretAccessKey(secretStoreKey: string) {
  _secretStoreKeyForS3SecretAccessKey = secretStoreKey;
}

let _s3CredentialsFromSecretStore: S3Credentials | undefined = undefined;
export async function buildS3CredentialsFromSecretStore() {
  if (_s3CredentialsFromSecretStore != null) {
    return _s3CredentialsFromSecretStore;
  }
  let secretStore;
  try {
    secretStore = new SecretStore(_secretStoreForS3Credentials);
  } catch {
    throw new Error(`Could not open secret store for S3 credentials: ${_secretStoreForS3Credentials}`);
  }
  const accessKeyIdEntry = await secretStore.get(_secretStoreKeyForS3AccessKeyId);
  if (accessKeyIdEntry == null) {
    throw new Error(`Could not retrieve value '${_secretStoreKeyForS3AccessKeyId}' in secret store '${_secretStoreForS3Credentials}'`);
  }
  const accessKeyId = accessKeyIdEntry.plaintext();

  const secretAccessKeyEntry = await secretStore.get(_secretStoreKeyForS3SecretAccessKey);
  if (secretAccessKeyEntry == null) {
    throw new Error(`Could not retrieve value '${_secretStoreKeyForS3SecretAccessKey}' in secret store '${_secretStoreForS3Credentials}'`);
  }
  const secretAccessKey = secretAccessKeyEntry.plaintext();

  _s3CredentialsFromSecretStore = {
    accessKeyId,
    secretAccessKey,
  };
  return _s3CredentialsFromSecretStore;
}

let _s3CredentialsBuilder: S3CredentialsBuilder = buildS3CredentialsFromSecretStore;
export function setS3CredentialsBuilder(s3CredentialsBuilder: S3CredentialsBuilder) {
  _s3CredentialsBuilder = s3CredentialsBuilder;
}

export type S3StorageProviderParams = {
  s3Endpoint?: string,
  s3FastlyBackendName?: string,
};

type S3ClientCommand<InputType extends ServiceInputTypes, OutputType extends ServiceOutputTypes> =
  Command<ServiceInputTypes, InputType, ServiceOutputTypes, OutputType, S3ClientResolvedConfig>;

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

  async sendS3Command<InputType extends ServiceInputTypes, OutputType extends ServiceOutputTypes>(
    command: S3ClientCommand<InputType, OutputType>,
    requestInit?: RequestInit,
  ): Promise<OutputType> {
    const s3Credentials = await _s3CredentialsBuilder();
    const s3Client = new S3Client({
      region: this.s3Region,
      endpoint: this.s3Endpoint,
      forcePathStyle: this.s3Endpoint != null,
      credentials: {
        accessKeyId: s3Credentials.accessKeyId,
        secretAccessKey: s3Credentials.secretAccessKey,
      },
      maxAttempts: 5,
      requestHandler: new FetchHttpHandler({
        requestInit() {
          return requestInit ?? {};
        },
      }),
    });
    return s3Client.send(command);
  }

  async getEntry(key: string, tags?: string[]): Promise<StorageEntry | null> {
    const input = {
      Bucket: this.s3Bucket, // required
      Key: key,              // required
    } satisfies GetObjectCommandInput;
    const command = new GetObjectCommand(input);
    let response: GetObjectCommandOutput;
    try {
      response = await this.sendS3Command(command, {
        backend: this.s3FastlyBackendName ?? "s3_storage",
        cacheOverride: new CacheOverride({
          ttl: 3600,
          surrogateKey: (tags ?? []).join(' ') || undefined,
        }),
      });
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
