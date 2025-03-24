import { ContentAssets } from "./assets/content-assets.js";
import { checkIfModifiedSince, getIfModifiedSinceHeader } from "./serve-preconditions/if-modified-since.js";
import { checkIfNoneMatch, getIfNoneMatchHeader } from "./serve-preconditions/if-none-match.js";
import { buildHeadersSubset } from "./util/http.js";

import type { PublisherServerConfigNormalized } from "../types/config-normalized.js";
import type { ContentAsset } from "../types/content-assets.js";
import type { ContentCompressionTypes } from "../constants/compression.js";

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
  private readonly serverConfig: PublisherServerConfigNormalized;
  private readonly staticItems: (string|RegExp)[];
  private readonly contentAssets: ContentAssets;

  public constructor(
    serverConfig: PublisherServerConfigNormalized,
    contentAssets: ContentAssets,
  ) {
    this.serverConfig = serverConfig;
    this.contentAssets = contentAssets;

    this.staticItems = serverConfig.staticItems
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

  getMatchingAsset(path: string): ContentAsset | null {
    const assetKey = this.serverConfig.publicDirPrefix + path;

    if(!assetKey.endsWith('/')) {
      // A path that does not end in a slash can match an asset directly
      const asset = this.contentAssets.getAsset(assetKey);
      if (asset != null) {
        return asset;
      }

      // ... or, we can try auto-ext:
      // looks for an asset that has the specified suffix (usually extension, such as .html)
      for (const extEntry of this.serverConfig.autoExt) {
        let assetKeyWithExt = assetKey + extEntry;
        const asset = this.contentAssets.getAsset(assetKeyWithExt);
        if (asset != null) {
          return asset;
        }
      }
    }

    if(this.serverConfig.autoIndex.length > 0) {
      // try auto-index:
      // treats the path as a directory, and looks for an asset with the specified
      // suffix (usually an index file, such as index.html)
      let assetNameAsDir = assetKey;
      // remove all slashes from end, and add one trailing slash
      while(assetNameAsDir.endsWith('/')) {
        assetNameAsDir = assetNameAsDir.slice(0, -1);
      }
      assetNameAsDir = assetNameAsDir + '/';
      for (const indexEntry of this.serverConfig.autoIndex) {
        let assetKeyIndex = assetNameAsDir + indexEntry;
        const asset = this.contentAssets.getAsset(assetKeyIndex);
        if (asset != null) {
          return asset;
        }
      }
    }

    return null;
  }

  findAcceptEncodings(request: Request): ContentCompressionTypes[][] {
    if (this.serverConfig.compression.length === 0) {
      return [];
    }
    const found = (request.headers.get('accept-encoding') ?? '')
      .split(',')
      .map(x => {
        let [encodingValue, qValueStr] = x.trim().split(';');
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
        return [encodingValue.trim(), qValue] as const;
      })
      .filter(([encoding]) =>
        this.serverConfig.compression.includes(encoding as ContentCompressionTypes)
      );

    const priorityMap = new Map<number, ContentCompressionTypes[]>;
    for (const [encoding, qValue] of found) {
      let typesForQValue = priorityMap.get(qValue);
      if (typesForQValue == null) {
        typesForQValue = [];
        priorityMap.set(qValue, typesForQValue);
      }
      typesForQValue.push(encoding as ContentCompressionTypes);
    }

    // Sort keys, larger numbers to come first
    const keysSorted = [...priorityMap.keys()]
      .sort((qValueA, qValueB) => qValueB - qValueA);

    return keysSorted
      .map(qValue => priorityMap.get(qValue)!);
  }

  testExtendedCache(pathname: string) {
    return this.staticItems
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

  handlePreconditions(request: Request, asset: ContentAsset, responseHeaders: Record<string, string>): Response | null {
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
        const result = checkIfNoneMatch(responseHeaders['ETag'], headerValue);
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
        const result = checkIfModifiedSince(asset, headerValue);
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

  async serveAsset(request: Request, asset: ContentAsset, init?: AssetInit): Promise<Response> {
    const metadata = asset.getMetadata();
    const headers: Record<string, string> = {
      'Content-Type': metadata.contentType,
    };
    Object.assign(headers, init?.headers);

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
      headers['Cache-Control'] = cacheControlValue;
    }

    const acceptEncodings = this.findAcceptEncodings(request);
    const storeEntry = await asset.getStoreEntry(acceptEncodings);
    if (storeEntry.contentEncoding != null) {
      headers['Content-Encoding'] = storeEntry.contentEncoding;
    }

    headers['ETag'] = `"${storeEntry.hash}"`;
    if (metadata.lastModifiedTime !== 0) {
      headers['Last-Modified'] = (new Date( metadata.lastModifiedTime * 1000 )).toUTCString();
    }

    const preconditionResponse = this.handlePreconditions(request, asset, headers);
    if (preconditionResponse != null) {
      return preconditionResponse;
    }

    return new Response(storeEntry.body, {
      status: init?.status ?? 200,
      headers,
    });
  }

  async serveRequest(request: Request): Promise<Response | null> {

    // Only handle GET and HEAD
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return null;
    }

    const url = new URL(request.url);
    const pathname = decodeURI(url.pathname);

    const asset = this.getMatchingAsset(pathname);
    if (asset != null) {
      return this.serveAsset(request, asset, {
        cache: this.testExtendedCache(pathname) ? 'extended' : null,
      });
    }

    // fallback HTML responses, like SPA and "not found" pages
    if (requestAcceptsTextHtml(request)) {

      // These are raw asset paths, not relative to public path
      const { spaFile } = this.serverConfig;

      if (spaFile != null) {
        const asset = this.contentAssets.getAsset(spaFile);
        if (asset != null) {
          return this.serveAsset(request, asset, {
            cache: 'never',
          });
        }
      }

      const { notFoundPageFile } = this.serverConfig;
      if (notFoundPageFile != null) {
        const asset = this.contentAssets.getAsset(notFoundPageFile);
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
