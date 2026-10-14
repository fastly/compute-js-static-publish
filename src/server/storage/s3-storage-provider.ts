/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { CacheOverride } from 'fastly:cache-override';
import { SecretStore } from 'fastly:secret-store';
import { Sha256 } from '@aws-crypto/sha256-js';
import { SignatureV4 } from '@smithy/signature-v4';

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

// Attempts for a request that fails with a retryable status or a network error.
const MAX_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 100;

// Status codes that S3 asks clients to retry.
const RETRYABLE_STATUS_CODES = [ 429, 500, 502, 503, 504 ];

// The S3 key as a URL path. Like the AWS SDK, this also escapes !'()*.
function encodeS3Key(key: string) {
  return key.split('/').map(segment =>
    encodeURIComponent(segment).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  ).join('/');
}

// The error code and message from an S3 XML error body, for the error message.
function describeS3Error(status: number, bodyText: string) {
  const code = /<Code>([^<]*)<\/Code>/.exec(bodyText)?.[1];
  const message = /<Message>([^<]*)<\/Message>/.exec(bodyText)?.[1];
  return [ `S3 GetObject failed with status ${status}`, code, message ].filter(Boolean).join(': ');
}

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

  // The URL of an object. With a custom endpoint, such as Fastly Object Storage,
  // the bucket is in the path. Otherwise, it is in the AWS host name.
  objectUrl(key: string): URL {
    if (this.s3Endpoint != null) {
      const url = new URL(this.s3Endpoint);
      url.pathname = url.pathname.replace(/\/$/, '') + '/' + encodeURIComponent(this.s3Bucket) + '/' + encodeS3Key(key);
      return url;
    }
    return new URL(`https://${this.s3Bucket}.s3.${this.s3Region}.amazonaws.com/${encodeS3Key(key)}`);
  }

  // Sends a signed GET request for an object. The AWS SDK is not used here: its
  // browser build, which js-compute bundles, parses XML with DOMParser, which
  // Compute does not have.
  async fetchObject(key: string, requestInit: RequestInit): Promise<Response> {
    const s3Credentials = await _s3CredentialsBuilder();
    const signer = new SignatureV4({
      service: 's3',
      region: this.s3Region,
      credentials: {
        accessKeyId: s3Credentials.accessKeyId,
        secretAccessKey: s3Credentials.secretAccessKey,
      },
      sha256: Sha256,
      // The path is already escaped by encodeS3Key(). S3 expects it escaped once.
      uriEscapePath: false,
    });

    const url = this.objectUrl(key);
    for (let attempt = 1; ; attempt++) {
      const signed = await signer.sign({
        method: 'GET',
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port !== '' ? Number(url.port) : undefined,
        path: url.pathname,
        headers: {
          host: url.host,
          'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
        },
      });

      let response: Response | null = null;
      let error: unknown = null;
      try {
        response = await fetch(url, {
          ...requestInit,
          method: 'GET',
          headers: signed.headers,
        });
      } catch(err) {
        error = err;
      }

      const retryable = response == null || RETRYABLE_STATUS_CODES.includes(response.status);
      if (!retryable || attempt >= MAX_ATTEMPTS) {
        if (response == null) {
          throw error;
        }
        return response;
      }
      // Exponential backoff with jitter.
      const delay = Math.random() * RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  async getEntry(key: string, tags?: string[]): Promise<StorageEntry | null> {
    const response = await this.fetchObject(key, {
      backend: this.s3FastlyBackendName ?? "s3_storage",
      cacheOverride: new CacheOverride({
        ttl: 3600,
        surrogateKey: (tags ?? []).join(' ') || undefined,
      }),
    });

    if (response.status === 404) {
      console.log("Object does not exist");
      return null;
    }
    if (!response.ok) {
      // some other problem (auth, etc.)
      throw new Error(describeS3Error(response.status, await response.text()));
    }
    if (response.body == null) {
      return null;
    }

    // User-defined object metadata comes in x-amz-meta-* headers.
    const metadata: Record<string, string> = {};
    for (const [ name, value ] of response.headers.entries()) {
      if (name.startsWith('x-amz-meta-')) {
        metadata[name.slice('x-amz-meta-'.length)] = value;
      }
    }

    const body = concatReadableStreams([response.body]);
    const metadataText = JSON.stringify(metadata);

    return new StorageEntryImpl(body, metadataText);
  }
}
