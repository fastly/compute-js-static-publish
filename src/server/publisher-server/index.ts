/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

/// <reference types="@fastly/js-compute" />
import { KVStore, type KVStoreEntry } from 'fastly:kv-store';

import {
  type StaticPublishRc,
} from '../../models/config/static-publish-rc.js';
import {
  type PublisherServerConfigNormalized,
} from '../../models/config/publisher-server-config.js';
import {
  type ContentCompressionTypes,
} from '../../models/compression/index.js';
import {
  isKVAssetVariantMetadata,
  type KVAssetEntry,
  type KVAssetEntryMap,
  type KVAssetVariantMetadata,
} from '../../models/assets/kvstore-assets.js';
import { getKVStoreEntry } from '../util/kv-store.js';
import { checkIfModifiedSince, getIfModifiedSinceHeader } from './serve-preconditions/if-modified-since.js';
import { checkIfNoneMatch, getIfNoneMatchHeader } from './serve-preconditions/if-none-match.js';

type KVAssetVariant = {
  kvStoreEntry: KVStoreEntry,
} & KVAssetVariantMetadata;

export function buildHeadersSubset(responseHeaders: Headers, keys: Readonly<string[]>) {
  const resultHeaders = new Headers();
  for (const value of keys) {
    if (value in responseHeaders) {
      const responseHeaderValue = responseHeaders.get(value);
      if (responseHeaderValue != null) {
        resultHeaders.set(value, responseHeaderValue);
      }
    }
  }
  return resultHeaders;
}

// https://httpwg.org/specs/rfc9110.html#rfc.section.15.4.5
// The server generating a 304 response MUST generate any of the following header fields that would have been sent in
// a 200 (OK) response to the same request:
// * Content-Location, Date, ETag, and Vary
// * Cache-Control and Expires
const headersToPreserveForUnmodified = ['Content-Location', 'ETag', 'Vary', 'Cache-Control', 'Expires'] as const;

function requestAcceptsTextHtml(req: Request) {
  const accept = (req.headers.get('Accept') ?? '')
    .split(',')
    .map(x => x.split(';')[0]);
  if(!accept.includes('text/html') && !accept.includes('*/*') && accept.includes('*')) {
    return false;
  }
  return true;
}

type AssetInit = {
  status?: number,
  headers?: Record<string, string>,
  cache?: 'extended' | 'never' | null,
};

export class PublisherServer {
  public constructor(
    publishId: string,
    kvStoreName: string,
    defaultCollectionName: string,
  ) {
    this.publishId = publishId;
    this.kvStoreName = kvStoreName;
    this.defaultCollectionName = defaultCollectionName;
    this.activeCollectionName = this.defaultCollectionName;
    this.collectionNameHeader = 'X-Publisher-Server-Collection';
  }

  static fromStaticPublishRc(config: StaticPublishRc) {
    return new PublisherServer(
      config.publishId,
      config.kvStoreName,
      config.defaultCollectionName,
    );
  }

  publishId: string;
  kvStoreName: string;
  defaultCollectionName: string;
  activeCollectionName: string;
  collectionNameHeader: string | null;

  setActiveCollectionName(collectionName: string) {
    this.activeCollectionName = collectionName;
  }

  setCollectionNameHeader(collectionHeader: string | null) {
    this.collectionNameHeader = collectionHeader;
  }

  // Server config is obtained from the KV Store, and cached for the duration of this object.
  // TODO get from simple cache
  async getServerConfig() {
    const settingsFileKey = `${this.publishId}_settings_${this.activeCollectionName}`;
    const kvStore = new KVStore(this.kvStoreName);
    const settingsFile = await getKVStoreEntry(kvStore, settingsFileKey);
    if (settingsFile == null) {
      console.error(`Settings File not found at ${settingsFileKey}.`);
      console.error(`You may need to publish your application.`);
      return null;
    }
    return (await settingsFile.json()) as PublisherServerConfigNormalized;
  }

  async getStaticItems() {
    const serverConfig = await this.getServerConfig();
    if (serverConfig == null) {
      return [];
    }
    return serverConfig.staticItems
      .map((x, i) => {
        if (x.startsWith('re:')) {
          const fragments = x.slice(3).match(/\/(.*?)\/([a-z]*)?$/i);
          if (fragments == null) {
            console.warn(`Cannot parse staticItems item index ${i}: '${x}', skipping...`);
            return '';
          }
          return new RegExp(fragments[1], fragments[2] || '');
        }
        return x;
      })
      .filter(x => Boolean(x));
  }

  async getKvAssetsIndex() {
    const indexFileKey = `${this.publishId}_index_${this.activeCollectionName}`;
    const kvStore = new KVStore(this.kvStoreName);
    const indexFile = await getKVStoreEntry(kvStore, indexFileKey);
    if (indexFile == null) {
      console.error(`Index File not found at ${indexFileKey}.`);
      console.error(`You may need to publish your application.`);
      return null;
    }
    return (await indexFile.json()) as KVAssetEntryMap;
  }

  async getMatchingAsset(assetKey: string, applyAuto: boolean = false): Promise<KVAssetEntry | null> {

    const serverConfig = await this.getServerConfig();
    if (serverConfig == null) {
      return null;
    }
    const kvAssetsIndex = await this.getKvAssetsIndex();
    if (kvAssetsIndex == null) {
      return null;
    }

    if(!assetKey.endsWith('/')) {
      // A path that does not end in a slash can match an asset directly
      const asset = kvAssetsIndex[assetKey];
      if (asset != null) {
        return asset;
      }

      if (applyAuto) {
        // ... or, we can try auto-ext:
        // looks for an asset that has the specified suffix (usually extension, such as .html)
        for (const extEntry of serverConfig.autoExt) {
          let assetKeyWithExt = assetKey + extEntry;
          const asset = kvAssetsIndex[assetKeyWithExt];
          if (asset != null) {
            return asset;
          }
        }
      }
    }

    if (applyAuto) {
      if (serverConfig.autoIndex.length > 0) {
        // try auto-index:
        // treats the path as a directory, and looks for an asset with the specified
        // suffix (usually an index file, such as index.html)
        let assetNameAsDir = assetKey;
        // remove all slashes from end, and add one trailing slash
        while(assetNameAsDir.endsWith('/')) {
          assetNameAsDir = assetNameAsDir.slice(0, -1);
        }
        assetNameAsDir = assetNameAsDir + '/';
        for (const indexEntry of serverConfig.autoIndex) {
          let assetKeyIndex = assetNameAsDir + indexEntry;
          const asset = kvAssetsIndex[assetKeyIndex];
          if (asset != null) {
            return asset;
          }
        }
      }
    }

    return null;
  }

  // A pedantic function that returns all content types that are requested for in the accept-encoding header that are
  // accepted by the server config, grouped by descending order of q values.
  // For example, if accept-encoding had br;q=1,gzip;q=0.5, and the server accepts both br and gzip,
  // the result would be [['br'], ['gzip']]
  async findAcceptEncodingsGroups(request: Request): Promise<ContentCompressionTypes[][]> {
    const serverConfig = await this.getServerConfig();
    if (serverConfig == null || serverConfig.allowedEncodings.length === 0) {
      return [];
    }

    const acceptEncodingHeader = request.headers.get('accept-encoding')?.trim() ?? '';
    if (acceptEncodingHeader == '') {
      return [];
    }

    const priorityMap = new Map<number, ContentCompressionTypes[]>;

    for (const headerValue of acceptEncodingHeader.trim().split(',')) {
      let [encodingValue, qValueStr] = headerValue.trim().split(';');
      encodingValue = encodingValue.trim();
      if (!serverConfig.allowedEncodings.includes(encodingValue as ContentCompressionTypes)) {
        continue;
      }
      let qValue; // q value multiplied by 1000
      if (qValueStr == null || !qValueStr.startsWith('q=')) {
        // use default of 1.0
        qValue = 1000;
      } else {
        qValueStr = qValueStr.slice(2); // remove the q=
        qValue = parseFloat(qValueStr);
        if (Number.isNaN(qValue) || qValue > 1) {
          qValue = 1;
        }
        if (qValue < 0) {
          qValue = 0;
        }
        // q values can have up to 3 decimal digits
        qValue = Math.floor(qValue * 1000);
      }

      let typesForQValue = priorityMap.get(qValue);
      if (typesForQValue == null) {
        typesForQValue = [];
        priorityMap.set(qValue, typesForQValue);
      }
      typesForQValue.push(encodingValue as ContentCompressionTypes);
    }

    // Sort keys, larger numbers to come first
    const keysSorted = [...priorityMap.keys()]
      .sort((qValueA, qValueB) => qValueB - qValueA);

    return keysSorted
      .map(qValue => priorityMap.get(qValue)!);
  }

  async testExtendedCache(pathname: string) {
    const staticItems = await this.getStaticItems();
    return staticItems
      .some(x => {
        if (x instanceof RegExp) {
          return x.test(pathname);
        }
        if (x.endsWith('/')) {
          return pathname.startsWith(x);
        }
        return x === pathname;
      });
  }

  handlePreconditions(request: Request, asset: KVAssetEntry, responseHeaders: Headers): Response | null {
    // Handle preconditions according to https://httpwg.org/specs/rfc9110.html#rfc.section.13.2.2

    // A recipient cache or origin server MUST evaluate the request preconditions defined by this specification in the following order:
    // 1. When recipient is the origin server and If-Match is present, evaluate the If-Match precondition:
    // - if true, continue to step 3
    // - if false, respond 412 (Precondition Failed) unless it can be determined that the state-changing request has already succeeded (see Section 13.1.1)

    // 2. When recipient is the origin server, If-Match is not present, and If-Unmodified-Since is present, evaluate the If-Unmodified-Since precondition:
    // - if true, continue to step 3
    // - if false, respond 412 (Precondition Failed) unless it can be determined that the state-changing request has already succeeded (see Section 13.1.4)

    // 3. When If-None-Match is present, evaluate the If-None-Match precondition:
    // - if true, continue to step 5
    // - if false for GET/HEAD, respond 304 (Not Modified)
    // - if false for other methods, respond 412 (Precondition Failed)

    let skipIfNoneMatch = false;
    {
      const headerValue = getIfNoneMatchHeader(request);
      if (headerValue.length > 0) {
        const result = checkIfNoneMatch(responseHeaders.get('ETag')!, headerValue);
        if (result) {
          skipIfNoneMatch = true;
        } else {
          return new Response(null, {
            status: 304,
            headers: buildHeadersSubset(responseHeaders, headersToPreserveForUnmodified),
          });
        }
      }
    }

    // 4. When the method is GET or HEAD, If-None-Match is not present, and If-Modified-Since is present, evaluate the
    // If-Modified-Since precondition:
    // - if true, continue to step 5
    // - if false, respond 304 (Not Modified)

    if (!skipIfNoneMatch) {
      // For us, method is always GET or HEAD here.
      const headerValue = getIfModifiedSinceHeader(request);
      if (headerValue != null) {
        const result = checkIfModifiedSince(asset.lastModifiedTime, headerValue);
        if (!result) {
          return new Response(null, {
            status: 304,
            headers: buildHeadersSubset(responseHeaders, headersToPreserveForUnmodified),
          });
        }
      }
    }

    // 5. When the method is GET and both Range and If-Range are present, evaluate the If-Range precondition:
    // - if true and the Range is applicable to the selected representation, respond 206 (Partial Content)
    // - otherwise, ignore the Range header field and respond 200 (OK)

    // 6. Otherwise,
    // - perform the requested method and respond according to its success or failure.
    return null;
  }
  
  public async loadKvAssetVariant(entry: KVAssetEntry, variant: ContentCompressionTypes | null): Promise<KVAssetVariant | null> {

    const kvStore = new KVStore(this.kvStoreName);
    
    const baseHash = entry.key.slice(7);
    const baseKey = `${this.publishId}_files_sha256_${baseHash}`;
    const variantKey = variant != null ? `${baseKey}_${variant}` : baseKey;

    const kvStoreEntry = await getKVStoreEntry(kvStore, variantKey);
    if (kvStoreEntry == null) {
      return null;
    }
    const metadataText = kvStoreEntry.metadataText() ?? '';
    if (metadataText === '') {
      return null;
    }
    let metadata;
    try {
      metadata = JSON.parse(metadataText);
    } catch {
      return null;
    }
    if (!isKVAssetVariantMetadata(metadata)) {
      return null;
    }
    if (metadata.size == null) {
      return null;
    }
    return {
      kvStoreEntry,
      ...metadata,
    };
  }

  private async findKVAssetVariantForAcceptEncodingsGroups(entry: KVAssetEntry, acceptEncodingsGroups: ContentCompressionTypes[][] = []): Promise<KVAssetVariant> {

    if (!entry.key.startsWith('sha256:')) {
      throw new TypeError(`Key must start with 'sha256:': ${entry.key}`);
    }

    // Each encodingGroup is an array of Accept-Encodings that have the same q value,
    // with the highest first
    for (const encodingGroup of acceptEncodingsGroups) {

      let smallestSize: number | undefined = undefined;
      let smallestEntry: KVAssetVariant | undefined = undefined;

      for (const encoding of encodingGroup) {
        if (!entry.variants.includes(encoding)) {
          continue;
        }

        const variantKvStoreEntry = await this.loadKvAssetVariant(entry, encoding);
        if (variantKvStoreEntry == null) {
          continue;
        }
        if (smallestSize == null || variantKvStoreEntry.size < smallestSize) {
          smallestSize = variantKvStoreEntry.size;
          smallestEntry = variantKvStoreEntry;
        }
      }

      if (smallestEntry != null) {
        return smallestEntry;
      }
    }

    const baseKvStoreEntry = await this.loadKvAssetVariant(entry, null);
    if (baseKvStoreEntry == null) {
      throw new TypeError('Key not found: ' + entry.key);
    }

    return baseKvStoreEntry;
  }

  async serveAsset(request: Request, asset: KVAssetEntry, init?: AssetInit): Promise<Response> {

    const headers = new Headers(init?.headers);
    headers.set('Content-Type', asset.contentType);

    if (this.collectionNameHeader) {
      headers.set(this.collectionNameHeader, this.activeCollectionName);
      headers.append('Vary', this.collectionNameHeader);
    }

    if (init?.cache != null) {
      let cacheControlValue;
      switch(init.cache) {
      case 'extended':
        cacheControlValue = 'max-age=31536000';
        break;
      case 'never':
        cacheControlValue = 'no-store';
        break;
      }
      headers.append('Cache-Control', cacheControlValue);
    }

    const acceptEncodings = await this.findAcceptEncodingsGroups(request);
    const kvAssetVariant = await this.findKVAssetVariantForAcceptEncodingsGroups(asset, acceptEncodings);
    if (kvAssetVariant.contentEncoding != null) {
      headers.append('Content-Encoding', kvAssetVariant.contentEncoding);
    }

    headers.set('ETag', `"${kvAssetVariant.hash}"`);
    if (asset.lastModifiedTime !== 0) {
      headers.set('Last-Modified', (new Date( asset.lastModifiedTime * 1000 )).toUTCString());
    }

    const preconditionResponse = this.handlePreconditions(request, asset, headers);
    if (preconditionResponse != null) {
      return preconditionResponse;
    }

    const kvStoreEntry = kvAssetVariant.kvStoreEntry;
    return new Response(
      kvStoreEntry.body,
      {
        status: init?.status ?? 200,
        headers,
      }
    );
  }

  async serveRequest(request: Request): Promise<Response | null> {

    // Only handle GET and HEAD
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return null;
    }

    const url = new URL(request.url);
    const pathname = decodeURI(url.pathname);
    const serverConfig = await this.getServerConfig();
    if (serverConfig == null) {
      return new Response(
        `Settings not found. You may need to publish your application.`,
        {
          status: 500,
          headers: {
            'content-type': 'text/plain',
          },
        },
      );
    }

    const asset = await this.getMatchingAsset(serverConfig.publicDirPrefix + pathname, true);
    if (asset != null) {
      return this.serveAsset(request, asset, {
        cache: await this.testExtendedCache(pathname) ? 'extended' : null,
      });
    }

    // fallback HTML responses, like SPA and "not found" pages
    if (requestAcceptsTextHtml(request)) {

      const kvAssetsIndex = await this.getKvAssetsIndex();
      if (kvAssetsIndex == null) {
        return null;
      }

      // These are raw asset paths, not relative to public path
      const { spaFile } = serverConfig;

      if (spaFile != null) {
        const asset = kvAssetsIndex[spaFile];
        if (asset != null) {
          return this.serveAsset(request, asset, {
            cache: 'never',
          });
        }
      }

      const { notFoundPageFile } = serverConfig;
      if (notFoundPageFile != null) {
        const asset = kvAssetsIndex[notFoundPageFile];
        if (asset != null) {
          return this.serveAsset(request, asset, {
            status: 404,
            cache: 'never',
          });
        }
      }
    }

    return null;
  }
}
