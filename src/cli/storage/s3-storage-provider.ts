/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import fs from 'node:fs';
import {
  DeleteObjectCommand,
  DeleteObjectCommandInput,
  GetObjectCommand,
  GetObjectCommandInput,
  HeadObjectCommand,
  HeadObjectCommandInput,
  ListObjectsV2Command,
  ListObjectsV2CommandInput,
  PutObjectCommand,
  PutObjectCommandInput,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import {
  type Command,
  type HttpHandlerOptions,
} from '@aws-sdk/types';

import {
  type AssetVariantMetadata,
  decodeAssetVariantMetadata,
} from '../../models/assets/index.js';
import {
  type StaticPublishRc,
  isS3StorageConfigRc,
} from '../../models/config/static-publish-rc.js';
import {
  getS3StorageConfigFromRc,
} from '../../models/config/s3-storage-config.js';
import {
  type StorageEntry,
  type StorageProvider,
  type StorageProviderBuilder,
  type StorageProviderBuilderContext,
  type StorageProviderBatch,
} from './storage-provider.js';
import {
  loadAwsCredentials,
} from '../util/aws-credentials.js';
import {
  concurrentParallel,
  makeRetryable,
} from '../util/retryable.js';
import {
  rootRelative,
} from '../util/files.js';

type CommandOutput<C> = C extends Command<any, any, any, infer O, any> ? O : never;

export const buildStoreProvider: StorageProviderBuilder = async (
  config: StaticPublishRc,
  context: StorageProviderBuilderContext,
) => {
  if (isS3StorageConfigRc(config)) {
    console.log(`  Working on S3 (or compatible) storage (BETA)...`);
  } else {
    return null;
  }

  const {
    region,
    bucket,
    endpoint,
  } = getS3StorageConfigFromRc(config);
  console.log(`  | Using S3 storage (BETA)`);
  console.log(`     Region  : ${region}`);
  console.log(`     Bucket  : ${bucket}`);
  console.log(`     Endpoint: ${endpoint ?? 'default'}`);

  const awsCredentialsResult = await loadAwsCredentials({
    awsProfile: context.awsProfile,
    awsAccessKeyId: context.awsAccessKeyId,
    awsSecretAccessKey: context.awsSecretAccessKey,
  });
  if (awsCredentialsResult == null) {
    throw new Error("❌ S3 Credentials not provided.\nProvide an AWS access key ID and secret access key that has write access to the S3 Storage.\nRefer to the README file and --help for additional information.");
  }
  console.log(`✔️ S3 Credentials: ${awsCredentialsResult.awsAccessKeyId.slice(0, 4)}${'*'.repeat(awsCredentialsResult.awsAccessKeyId.length-4)} from '${awsCredentialsResult.source}'`);
  return new S3StorageProvider(
    region,
    awsCredentialsResult.awsAccessKeyId,
    awsCredentialsResult.awsSecretAccessKey,
    bucket,
    endpoint,
  );
};


export class S3StorageProvider implements StorageProvider {
  constructor(
    s3Region: string,
    accessKeyId: string,
    secretAccessKey: string,
    s3Bucket: string,
    s3Endpoint?: string,
  ) {
    this.s3Region = s3Region;
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.s3Bucket = s3Bucket;
    this.s3Endpoint = s3Endpoint;
  }

  private readonly s3Region: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly s3Bucket: string;
  private readonly s3Endpoint?: string;

  private s3Client?: S3Client;
  getS3Client() {
    if (this.s3Client != null) {
      return this.s3Client;
    }
    this.s3Client = new S3Client({
      region: this.s3Region,
      endpoint: this.s3Endpoint,
      forcePathStyle: this.s3Endpoint != null,
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
      },
      maxAttempts: 1,
    });
    return this.s3Client;
  }

  async sendS3ClientCommand<C extends Command<any, any, any, any, any>>(
    command: C,
    options?: HttpHandlerOptions
  ): Promise<CommandOutput<C>> {
    try {
      return await this.getS3Client().send(command, options);
    } catch(ex) {
      if (ex instanceof S3ServiceException && ex.$retryable) {
        throw makeRetryable(ex);
      }
      throw ex;
    }
  }

  async getStorageKeys(prefix?: string): Promise<string[] | null> {

    const input = {
      Bucket: this.s3Bucket,
      MaxKeys: 4096,
      Prefix: prefix,
      ContinuationToken: undefined, // pagination
    } satisfies ListObjectsV2CommandInput;
    const command = new ListObjectsV2Command(input);
    const response = await this.sendS3ClientCommand(command);

    if (response.Contents == null) {
      return null;
    }

    return response.Contents
      .map(c => c.Key)
      .filter(c => c != null);

  }

  async getStorageEntry(key: string): Promise<StorageEntry | null> {

    const input = {
      Bucket: this.s3Bucket, // required
      Key: key,              // required
    } satisfies GetObjectCommandInput;
    const command = new GetObjectCommand(input);
    let response;
    try {
      response = await this.sendS3ClientCommand(command);
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

    return {
      data: response.Body.transformToWebStream(),
      metadata: response.Metadata,
    } satisfies StorageEntry;

  }

  async getStorageEntryInfo(key: string): Promise<StorageEntry | null> {

    const input = {
      Bucket: this.s3Bucket, // required
      Key: key,              // required
    } satisfies HeadObjectCommandInput;
    const command = new HeadObjectCommand(input);
    let response;
    try {
      response = await this.sendS3ClientCommand(command);
    } catch(err) {
      if (err instanceof S3ServiceException && (err.name === "NotFound" || err.name === "NoSuchKey")) {
        console.log("Object does not exist");
        return null;
      } else {
        throw err; // some other problem (auth, network, etc.)
      }
    }

    return {
      metadata: response.Metadata,
    } satisfies StorageEntry;
  }

  async submitStorageEntry(
    key: string,
    _filePath: string,
    data: ReadableStream<Uint8Array> | Uint8Array | string | null | undefined,
    metadata?: Record<string, string>,
  ): Promise<void> {

    const input = {
      Bucket: this.s3Bucket, // required
      Key: key,              // required
      Body: data ?? undefined,
      Metadata: metadata,
    } satisfies PutObjectCommandInput;
    const command = new PutObjectCommand(input);
    await this.sendS3ClientCommand(command);

  }

  async deleteStorageEntry(key: string): Promise<void> {

    const input = {
      Bucket: this.s3Bucket, // required
      Key: key,              // required
    } as DeleteObjectCommandInput;
    const command = new DeleteObjectCommand(input);
    await this.sendS3ClientCommand(command);

  }

  async applyBatch(batch: StorageProviderBatch): Promise<void> {
    console.log(`📤 Uploading entries to S3 storage.`);
    // fastlyApiContext is non-null if useKvStore is true
    await this.doConcurrentParallel(
      batch.storageProviderBatchEntries.filter(x => x.write),
      async ({filePath, metadataJson}, key) => {
        // const fileStream = fs.createReadStream(filePath);
        const fileData = fs.readFileSync(filePath);
        await this.submitStorageEntry(
          key,
          filePath,
          fileData,
          metadataJson,
        );
        console.log(` 🌐 Submitted asset "${rootRelative(filePath)}" to S3 storage with key "${key}".`)
      }
    );
    console.log(`✅  Uploaded entries to S3 storage.`);

  }

  async doConcurrentParallel<TObject extends { key: string }>(
    objects: TObject[],
    fn: (obj: TObject, key: string, index: number) => Promise<void>,
    maxConcurrent: number = 12,
  ): Promise<void> {

    await concurrentParallel(
      objects,
      fn,
      (err) => {
        if (err instanceof S3ServiceException) {
          return `S3 error [${err.name}] - ${err.message}`;
        } else if (err instanceof TypeError) {
          return 'transport';
        }
        return null;
      },
      maxConcurrent,
    );

  }

  calculateNumChunks(_size: number): number {
    return 1;
  }

  async getExistingAssetVariant(variantKey: string): Promise<AssetVariantMetadata | null> {

    let assetVariantMetadata: AssetVariantMetadata | null = null;

    await this.doConcurrentParallel(
      [{key: variantKey}],
      async (_, variantKey) => {
        const entryInfo = await this.getStorageEntryInfo(
          variantKey,
        );
        if (entryInfo == null) {
          return;
        }
        const metadata = decodeAssetVariantMetadata(entryInfo.metadata);
        if (metadata != null) {
          if (metadata.numChunks !== undefined) {
            return;
          }
          assetVariantMetadata = {
            contentEncoding: metadata.contentEncoding,
            size: metadata.size,
            hash: metadata.hash,
          };
        }
      }
    );

    return assetVariantMetadata;
  }

}
