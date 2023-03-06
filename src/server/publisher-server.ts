import { ContentAssets } from "./assets/content-assets.js";

import type { PublisherServerConfigNormalized } from "../types/config-normalized.js";
import type { ContentAsset } from "../types/content-assets.js";

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

  async serveAsset(asset: ContentAsset, init?: AssetInit): Promise<Response> {
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

    const storeEntry = await asset.getStoreEntry();
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
    const pathname = url.pathname;

    const asset = this.getMatchingAsset(pathname);
    if (asset != null) {
      return this.serveAsset(asset, {
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
          return this.serveAsset(asset, { cache: 'never' });
        }
      }

      const { notFoundPageFile } = this.serverConfig;
      if (notFoundPageFile != null) {
        const asset = this.contentAssets.getAsset(notFoundPageFile);
        if (asset != null) {
          return this.serveAsset(asset, { status: 404, cache: 'never' });
        }
      }
    }

    return null;
  }
}
