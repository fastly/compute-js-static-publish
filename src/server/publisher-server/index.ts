/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

/// <reference types="@fastly/js-compute" />

import type { FastlyBody } from 'fastly:body';
import { CoreCache } from 'fastly:cache';

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
  type AssetEntry,
  type AssetEntryMap,
  type AssetVariantMetadata,
  decodeAssetVariantMetadata,
} from '../../models/assets/index.js';
import { decodeIndexMetadata, } from '../../models/server/index.js';
import { isExpired } from '../../models/time/index.js';
import {
  type StorageEntry,
  type StorageProvider,
  loadStorageProviderFromStaticPublishRc,
} from '../storage/storage-provider.js';
import { checkIfModifiedSince, getIfModifiedSinceHeader } from './serve-preconditions/if-modified-since.js';
import { checkIfNoneMatch, getIfNoneMatchHeader } from './serve-preconditions/if-none-match.js';
import { ServerTiming } from '../util/server-timing.js';
import {
  type CachedResponseMetadata,
  type ResponseCacheOptions,
  CACHEABLE_STATUSES,
  buildCacheFillRequest,
  buildResponseCacheKey,
  decodeCachedResponseMetadata,
  encodeCachedResponseMetadata,
  parseAcceptEncodingGroups,
} from './response-cache.js';

type AssetVariant = {
  storageEntry: StorageEntry,
} & AssetVariantMetadata;

export function buildHeadersSubset(responseHeaders: Headers, keys: Readonly<string[]>) {
  const resultHeaders = new Headers();
  for (const value of keys) {
    if (responseHeaders.has(value)) {
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

export type ServeRequestOptions = {
  // The collection for this call. null selects the default collection. If not
  // set, the active collection is used (see setActiveCollectionName()).
  collectionName?: string | null,
  // The path to look up, in place of the path of the request URL. It must be
  // decoded, and start with a slash.
  pathname?: string,
  // false: when no file matches, do not serve the SPA file or the 404 page.
  // Call serveFallback() for them. The default is true.
  fallback?: boolean,
  // false: do not answer /healthz. The default is true.
  healthCheck?: boolean,
};

export type ServeFallbackOptions = {
  // The collection for this call, as in ServeRequestOptions.
  collectionName?: string | null,
};

// The state of one request for one collection: the settings and the index that
// the request read, and the Server-Timing of the request. A sandbox can be reused
// for more than one request, so this state is not kept from one request to the next.
type CollectionScope = {
  collectionName: string,
  serverTiming: ServerTiming | null,
  settings: PublisherServerConfigNormalized | null | undefined,
  assetEntryMap: AssetEntryMap | null | undefined,
};

export class PublisherServer {
  public constructor(
    publishId: string,
    storageProvider: StorageProvider,
    defaultCollectionName: string,
  ) {
    this.publishId = publishId;
    this.storageProvider = storageProvider;
    this.defaultCollectionName = defaultCollectionName;
    this.activeCollectionName = this.defaultCollectionName;
    this.collectionNameHeader = 'X-Publisher-Server-Collection';
    this.serverTimingRequestHeader = null;
    this.responseCache = null;
    this.currentScope = this.newScope(this.activeCollectionName, null);
    this.requestScopes = new WeakMap();
  }

  static fromStaticPublishRc(config: StaticPublishRc) {
    const storeProvider = loadStorageProviderFromStaticPublishRc(config);
    return new PublisherServer(
      config.publishId,
      storeProvider,
      config.defaultCollectionName,
    );
  }

  publishId: string;
  storageProvider: StorageProvider;
  defaultCollectionName: string;
  activeCollectionName: string;
  collectionNameHeader: string | null;

  // When set, a request that has this header gets a Server-Timing response header.
  serverTimingRequestHeader: string | null;

  // When set, responses are cached with the Core Cache API. See setResponseCache().
  responseCache: ResponseCacheOptions | null;

  // The scope of the methods that do not take a request, such as getServerConfig()
  // and getMatchingAsset(). beginRequest() and setActiveCollectionName() replace it.
  private currentScope: CollectionScope;

  // The scopes of serveRequest() and serveFallback(), for each request and collection.
  // Thus, two calls for one request (for example, a file lookup and then the
  // fallback) read the index one time.
  private requestScopes: WeakMap<Request, Map<string, CollectionScope>>;

  // null selects the default collection. A sandbox can be reused for more than
  // one request, so call this for each request, also when no collection is
  // selected. Otherwise, the collection of the previous request stays active.
  // To select a collection for one call only, use the collectionName option of
  // serveRequest() and serveFallback().
  setActiveCollectionName(collectionName: string | null) {
    this.activeCollectionName = collectionName ?? this.defaultCollectionName;
    this.currentScope = this.newScope(this.activeCollectionName, this.currentScope.serverTiming);
  }

  setCollectionNameHeader(collectionHeader: string | null) {
    this.collectionNameHeader = collectionHeader;
  }

  // Set the request header that turns on the Server-Timing response header.
  // null (the default) turns timing off.
  setServerTimingRequestHeader(requestHeader: string | null) {
    this.serverTimingRequestHeader = requestHeader;
  }

  // Cache whole responses with the Core Cache API, keyed by collection, path,
  // and the client's Accept-Encoding. A cache hit does not read the settings,
  // the index, or the file from storage. Entries have the surrogate key
  // `<publishId>-<collectionName>`, which publish-content purges. null (the
  // default) turns the cache off.
  setResponseCache(options: ResponseCacheOptions | null) {
    this.responseCache = options;
  }

  // Start handling a new request with getMatchingAsset() and serveAsset(). Call
  // this first if you call them directly. serveRequest() and serveFallback() do
  // not need it.
  // A sandbox can be reused for more than one request, so this also clears the
  // settings and the index that a previous request read. Without this, a reused
  // sandbox serves an old index after a publish, and serves an expired collection.
  beginRequest(request: Request) {
    this.currentScope = this.newScope(this.activeCollectionName, this.newServerTiming(request));
  }

  private newServerTiming(request: Request) {
    const header = this.serverTimingRequestHeader;
    return header != null && request.headers.has(header) ? new ServerTiming() : null;
  }

  private newScope(collectionName: string, serverTiming: ServerTiming | null): CollectionScope {
    return {
      collectionName,
      serverTiming,
      settings: undefined,
      assetEntryMap: undefined,
    };
  }

  // The scope of a request for a collection. collectionName is as in ServeRequestOptions.
  private scopeForRequest(request: Request, collectionName: string | null | undefined): CollectionScope {
    const name = collectionName === undefined ?
      this.activeCollectionName :
      collectionName ?? this.defaultCollectionName;
    let scopes = this.requestScopes.get(request);
    if (scopes == null) {
      scopes = new Map();
      this.requestScopes.set(request, scopes);
    }
    let scope = scopes.get(name);
    if (scope == null) {
      // All the collections of one request share one Server-Timing.
      const otherScope = scopes.values().next().value;
      scope = this.newScope(name, otherScope != null ? otherScope.serverTiming : this.newServerTiming(request));
      scopes.set(name, scope);
    }
    return scope;
  }

  private timed<T>(scope: CollectionScope, name: string, fn: () => Promise<T>): Promise<T> {
    return scope.serverTiming != null ? scope.serverTiming.measure(name, fn) : fn();
  }

  // Server config is obtained from storage, and cached until the next beginRequest()
  // or setActiveCollectionName().
  async getServerConfig() {
    return this.getServerConfigFor(this.currentScope);
  }

  private async getServerConfigFor(scope: CollectionScope) {
    if (scope.settings !== undefined) {
      return scope.settings;
    }
    const settingsFileKey = `${this.publishId}_settings_${scope.collectionName}`;
    scope.settings = await this.timed(scope, 'settings', async () => {
      const settingsFile = await this.storageProvider.getEntry(settingsFileKey, [`${this.publishId}-${scope.collectionName}`, 'settings']);
      if (settingsFile == null) {
        console.error(`Settings File not found at ${settingsFileKey}.`);
        console.error(`You may need to publish your application.`);
        return null;
      }
      return (await settingsFile.json()) as PublisherServerConfigNormalized;
    });
    return scope.settings;
  }

  async getStaticItems() {
    return this.getStaticItemsFor(this.currentScope);
  }

  private async getStaticItemsFor(scope: CollectionScope) {
    const serverConfig = await this.getServerConfigFor(scope);
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

  async getAssetEntryMap() {
    return this.getAssetEntryMapFor(this.currentScope);
  }

  private async getAssetEntryMapFor(scope: CollectionScope) {
    if (scope.assetEntryMap !== undefined) {
      return scope.assetEntryMap;
    }
    const indexFileKey = `${this.publishId}_index_${scope.collectionName}`;
    const indexFile = await this.timed(scope, 'index', () =>
      this.storageProvider.getEntry(indexFileKey, [`${this.publishId}-${scope.collectionName}`, 'index']),
    );
    if (indexFile == null) {
      console.error(`Index File not found at ${indexFileKey}.`);
      console.error(`You may need to publish your application.`);
      scope.assetEntryMap = null;
      return null;
    }

    let collectionIsExpired = false;
    if (scope.collectionName !== this.defaultCollectionName) {
      let metadata;
      const metadataText = indexFile.metadataText()
      if (metadataText != null) {
        try {
          metadata = JSON.parse(metadataText);
        } catch {
        }
        metadata = decodeIndexMetadata(metadata);
      }
      if (metadata != null) {
        collectionIsExpired = metadata.expirationTime != null && isExpired(metadata.expirationTime);
      }
    }

    if (collectionIsExpired) {
      console.error(`Requested collection expired at ${indexFileKey}.`);
      scope.assetEntryMap = null;
      return null;
    }

    // Read and parse in two steps, so that Server-Timing can report each one.
    const indexText = await this.timed(scope, 'index-body', () => indexFile.text());
    scope.assetEntryMap = await this.timed(scope, 'index-parse', async () => JSON.parse(indexText) as AssetEntryMap);
    return scope.assetEntryMap;
  }

  async getMatchingAsset(assetKey: string, applyAuto: boolean = false): Promise<AssetEntry | null> {
    return this.getMatchingAssetFor(this.currentScope, assetKey, applyAuto);
  }

  private async getMatchingAssetFor(scope: CollectionScope, assetKey: string, applyAuto: boolean): Promise<AssetEntry | null> {

    const serverConfig = await this.getServerConfigFor(scope);
    if (serverConfig == null) {
      return null;
    }
    const assetEntryMap = await this.getAssetEntryMapFor(scope);
    if (assetEntryMap == null) {
      return null;
    }

    if(!assetKey.endsWith('/')) {
      // A path that does not end in a slash can match an asset directly
      const asset = assetEntryMap[assetKey];
      if (asset != null) {
        return asset;
      }

      if (applyAuto) {
        // ... or, we can try auto-ext:
        // looks for an asset that has the specified suffix (usually extension, such as .html)
        for (const extEntry of serverConfig.autoExt) {
          let assetKeyWithExt = assetKey + extEntry;
          const asset = assetEntryMap[assetKeyWithExt];
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
          const asset = assetEntryMap[assetKeyIndex];
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
    return this.findAcceptEncodingsGroupsFor(this.currentScope, request);
  }

  private async findAcceptEncodingsGroupsFor(scope: CollectionScope, request: Request): Promise<ContentCompressionTypes[][]> {
    const serverConfig = await this.getServerConfigFor(scope);
    if (serverConfig == null || serverConfig.allowedEncodings.length === 0) {
      return [];
    }

    return parseAcceptEncodingGroups(request.headers.get('accept-encoding') ?? '', serverConfig.allowedEncodings);
  }

  async testExtendedCache(pathname: string) {
    return this.testExtendedCacheFor(this.currentScope, pathname);
  }

  private async testExtendedCacheFor(scope: CollectionScope, pathname: string) {
    const staticItems = await this.getStaticItemsFor(scope);
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

  handlePreconditions(request: Request, asset: AssetEntry, responseHeaders: Headers): Response | null {
    return this.handlePreconditionsForLastModified(request, asset.lastModifiedTime, responseHeaders);
  }

  // lastModifiedTime is in seconds since the epoch, as in AssetEntry. A cached
  // response has its headers, but not its AssetEntry.
  private handlePreconditionsForLastModified(request: Request, lastModifiedTime: number, responseHeaders: Headers): Response | null {
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
        const result = checkIfModifiedSince(lastModifiedTime, headerValue);
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
  
  public async loadAssetVariant(entry: AssetEntry, variant: ContentCompressionTypes | null): Promise<AssetVariant | null> {
    return this.loadAssetVariantFor(this.currentScope, entry, variant);
  }

  private async loadAssetVariantFor(scope: CollectionScope, entry: AssetEntry, variant: ContentCompressionTypes | null): Promise<AssetVariant | null> {

    const baseHash = entry.key.slice(7);
    const baseKey = `${this.publishId}_files_sha256_${baseHash}`;
    const variantKey = variant != null ? `${baseKey}_${variant}` : baseKey;

    const storageEntry = await this.timed(scope, 'asset', () => this.storageProvider.getEntry(variantKey));
    if (storageEntry == null) {
      return null;
    }
    const metadataText = storageEntry.metadataText();
    if (metadataText == null) {
      return null;
    }
    let metadata;
    try {
      metadata = JSON.parse(metadataText);
    } catch {
      return null;
    }
    metadata = decodeAssetVariantMetadata(metadata);
    if (metadata == null) {
      return null;
    }
    return {
      storageEntry,
      ...metadata,
    };
  }

  private async findAssetVariantForAcceptEncodingsGroups(scope: CollectionScope, entry: AssetEntry, acceptEncodingsGroups: ContentCompressionTypes[][] = []): Promise<AssetVariant> {

    if (!entry.key.startsWith('sha256:')) {
      throw new TypeError(`Key must start with 'sha256:': ${entry.key}`);
    }

    // Each encodingGroup is an array of Accept-Encodings that have the same q value,
    // with the highest first
    for (const encodingGroup of acceptEncodingsGroups) {

      let smallestSize: number | undefined = undefined;
      let smallestVariant: AssetVariant | undefined = undefined;

      for (const encoding of encodingGroup) {
        if (!entry.variants.includes(encoding)) {
          continue;
        }

        const assetVariant = await this.loadAssetVariantFor(scope, entry, encoding);
        if (assetVariant == null) {
          continue;
        }
        if (smallestSize == null || assetVariant.size < smallestSize) {
          smallestSize = assetVariant.size;
          smallestVariant = assetVariant;
        }
      }

      if (smallestVariant != null) {
        return smallestVariant;
      }
    }

    const baseAssetVariant = await this.loadAssetVariantFor(scope, entry, null);
    if (baseAssetVariant == null) {
      throw new TypeError('Key not found: ' + entry.key);
    }

    return baseAssetVariant;
  }

  async serveAsset(request: Request, asset: AssetEntry, init?: AssetInit): Promise<Response> {
    return this.serveAssetFor(this.currentScope, request, asset, init);
  }

  private async serveAssetFor(scope: CollectionScope, request: Request, asset: AssetEntry, init?: AssetInit): Promise<Response> {

    const headers = new Headers(init?.headers);
    headers.set('Content-Type', asset.contentType);

    if (this.collectionNameHeader) {
      headers.set(this.collectionNameHeader, scope.collectionName);
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

    const acceptEncodings = await this.findAcceptEncodingsGroupsFor(scope, request);
    const assetVariant = await this.findAssetVariantForAcceptEncodingsGroups(scope, asset, acceptEncodings);
    if (assetVariant.contentEncoding != null) {
      headers.append('Content-Encoding', assetVariant.contentEncoding);
    }

    headers.set('ETag', `"${assetVariant.hash}"`);
    if (asset.lastModifiedTime !== 0) {
      headers.set('Last-Modified', (new Date( asset.lastModifiedTime * 1000 )).toUTCString());
    }

    if (scope.serverTiming != null) {
      headers.append('Server-Timing', scope.serverTiming.toHeaderValue());
    }

    const preconditionResponse = this.handlePreconditions(request, asset, headers);
    if (preconditionResponse != null) {
      return preconditionResponse;
    }

    const storageEntry = assetVariant.storageEntry;
    return new Response(
      storageEntry.body,
      {
        status: init?.status ?? 200,
        headers,
      }
    );
  }

  // Serve a response through the response cache (see setResponseCache()).
  // keyPath identifies the response in the active collection. Include in it
  // anything other than the path and the Accept-Encoding that changes the response.
  // On a miss, produce() is called with a GET request that has no conditional or
  // range headers, and its result is cached if it is a 200 or 404 response, or
  // null (not found). Conditional requests and HEAD are then answered from the
  // cached response. If the cache is off, produce() gets the original request.
  async serveCached(
    request: Request,
    keyPath: string,
    produce: (request: Request) => Promise<Response | null>,
  ): Promise<Response | null> {
    return this.serveCachedFor(this.currentScope, request, keyPath, produce);
  }

  private async serveCachedFor(
    scope: CollectionScope,
    request: Request,
    keyPath: string,
    produce: (request: Request) => Promise<Response | null>,
  ): Promise<Response | null> {
    if (this.responseCache == null) {
      return produce(request);
    }

    const key = buildResponseCacheKey(this.publishId, scope.collectionName, keyPath, request);
    const lookupStart = performance.now();
    const entry = CoreCache.transactionLookup(key);
    const state = entry.state();

    if (!state.mustInsertOrUpdate()) {
      const metadata = state.found() && state.usable() ? decodeCachedResponseMetadata(entry.userMetadata()) : null;
      if (metadata != null) {
        // age() is in milliseconds. A hit younger than the time since a purge proves the entry was refilled.
        scope.serverTiming?.add('cache', performance.now() - lookupStart, `hit age=${Math.round(entry.age() / 1000)}s`);
        return this.responseFromCache(scope, request, metadata, entry.body());
      }
      // Not usable, and another request is not filling it for us: serve without the cache.
      scope.serverTiming?.add('cache', performance.now() - lookupStart, 'bypass');
      return produce(request);
    }

    // This request must fill the entry (a miss, or a stale entry after a soft purge).
    scope.serverTiming?.add('cache', performance.now() - lookupStart, 'miss');
    let response: Response | null;
    try {
      response = await produce(buildCacheFillRequest(request));
    } catch (err) {
      entry.cancel();
      throw err;
    }

    const insertOptions = {
      // The Core Cache takes maxAge in milliseconds. ResponseCacheOptions.maxAge is in seconds.
      maxAge: this.responseCache.maxAge * 1000,
      surrogateKeys: [`${this.publishId}-${scope.collectionName}`],
    };

    if (response == null) {
      const metadata: CachedResponseMetadata = { notFound: true };
      const writer = entry.insert({
        ...insertOptions,
        userMetadata: encodeCachedResponseMetadata(metadata),
        length: 0,
      });
      writer.close();
      return null;
    }

    if (!CACHEABLE_STATUSES.includes(response.status)) {
      entry.cancel();
      return response;
    }

    const headers = new Headers(response.headers);
    // Server-Timing describes one request, so it is not stored.
    headers.delete('Server-Timing');
    const metadata: CachedResponseMetadata = { status: response.status, headers: [...headers] };
    const contentLength = Number(headers.get('Content-Length'));

    // Stream the body into the cache entry, and give the client (and any requests
    // waiting on this key) the entry's own stream as it fills. FastlyBody.append()
    // can take only host-backed streams, and the storage providers build their
    // bodies in JavaScript, so copy the chunks.
    const [writer, streamedEntry] = entry.insertAndStreamBack({
      ...insertOptions,
      userMetadata: encodeCachedResponseMetadata(metadata),
      length: Number.isInteger(contentLength) && headers.has('Content-Length') ? contentLength : undefined,
    });
    const copied = this.copyBodyToCache(response, writer);

    const cachedResponse = this.responseFromCache(scope, request, metadata, streamedEntry.body());
    // A response without a body (HEAD, 304) does not keep the request running
    // until the copy finishes. If the copy is cut short, the entry can be stored
    // with a partial body, so wait for it.
    if (cachedResponse?.body == null) {
      await copied;
    }
    return cachedResponse;
  }

  private async copyBodyToCache(response: Response, writer: FastlyBody) {
    try {
      if (response.body != null) {
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          writer.append(value);
        }
      }
      writer.close();
    } catch (err) {
      // Without close(), the cache treats the insertion as incomplete, so a
      // partial body is not kept. Readers of this entry get a stream error.
      console.error('Could not write the response to the cache:', err);
    }
  }

  private responseFromCache(scope: CollectionScope, request: Request, metadata: CachedResponseMetadata, body: BodyInit): Response | null {
    if (metadata.notFound) {
      return null;
    }

    const headers = new Headers(metadata.headers);
    if (scope.serverTiming != null) {
      headers.append('Server-Timing', scope.serverTiming.toHeaderValue());
    }

    const lastModified = headers.get('Last-Modified');
    const lastModifiedMs = lastModified != null ? Date.parse(lastModified) : NaN;
    const lastModifiedTime = Number.isNaN(lastModifiedMs) ? 0 : Math.floor(lastModifiedMs / 1000);
    const preconditionResponse = this.handlePreconditionsForLastModified(request, lastModifiedTime, headers);
    if (preconditionResponse != null) {
      return preconditionResponse;
    }

    return new Response(request.method === 'HEAD' ? null : body, {
      status: metadata.status,
      headers,
    });
  }

  // Serve the file that matches the request, or with options.fallback, the SPA
  // file or the 404 page. Returns null if there is no response for the request,
  // for example for a method other than GET and HEAD.
  async serveRequest(request: Request, options: ServeRequestOptions = {}): Promise<Response | null> {

    // Only handle GET and HEAD
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return null;
    }

    const pathname = options.pathname ?? decodeURI(new URL(request.url).pathname);

    // Custom health check route
    if (options.healthCheck !== false && pathname === '/healthz') {
      return new Response("OK", { status: 200 });
    }

    const scope = this.scopeForRequest(request, options.collectionName);

    // The fallback pages (SPA, not found) depend on whether the client accepts HTML.
    // Without them, the response is the same as for a client that does not accept HTML.
    const fallback = options.fallback !== false && requestAcceptsTextHtml(request);
    const keyPath = fallback ? pathname : `${pathname}|no-html`;
    return this.serveCachedFor(scope, request, keyPath, (fillRequest) => this.serveRequestFromStorage(scope, fillRequest, pathname, fallback));
  }

  // Serve the SPA file or the 404 page, as serveRequest() does when no file
  // matches. Use it after serveRequest() with fallback: false. Returns null if
  // the client does not accept HTML, or if the collection has no fallback page.
  async serveFallback(request: Request, options: ServeFallbackOptions = {}): Promise<Response | null> {

    // Only handle GET and HEAD
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return null;
    }

    if (!requestAcceptsTextHtml(request)) {
      return null;
    }

    const scope = this.scopeForRequest(request, options.collectionName);

    // The fallback response is the same for all paths, so it has one cache key.
    // A path always starts with a slash, so this key is not the key of a path.
    return this.serveCachedFor(scope, request, '|fallback', async (fillRequest) => {
      const serverConfig = await this.getServerConfigFor(scope);
      if (serverConfig == null) {
        return null;
      }
      return this.serveFallbackFromStorage(scope, fillRequest, serverConfig);
    });
  }

  private async serveRequestFromStorage(scope: CollectionScope, request: Request, pathname: string, fallback: boolean): Promise<Response | null> {

    const serverConfig = await this.getServerConfigFor(scope);
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

    const asset = await this.getMatchingAssetFor(scope, serverConfig.publicDirPrefix + pathname, true);
    if (asset != null) {
      return this.serveAssetFor(scope, request, asset, {
        cache: await this.testExtendedCacheFor(scope, pathname) ? 'extended' : null,
      });
    }

    if (fallback) {
      return this.serveFallbackFromStorage(scope, request, serverConfig);
    }

    return null;
  }

  // fallback HTML responses, like SPA and "not found" pages
  private async serveFallbackFromStorage(scope: CollectionScope, request: Request, serverConfig: PublisherServerConfigNormalized): Promise<Response | null> {

    const assetEntryMap = await this.getAssetEntryMapFor(scope);
    if (assetEntryMap == null) {
      return null;
    }

    // These are raw asset paths, not relative to public path
    const { spaFile } = serverConfig;

    if (spaFile != null) {
      const asset = assetEntryMap[spaFile];
      if (asset != null) {
        return this.serveAssetFor(scope, request, asset, {
          cache: 'never',
        });
      }
    }

    const { notFoundPageFile } = serverConfig;
    if (notFoundPageFile != null) {
      const asset = assetEntryMap[notFoundPageFile];
      if (asset != null) {
        return this.serveAssetFor(scope, request, asset, {
          status: 404,
          cache: 'never',
        });
      }
    }

    return null;
  }
}
