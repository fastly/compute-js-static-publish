import { ContentAssets } from "../assets/content-assets.js";

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

async function buildAssetResponse(asset: ContentAsset, status: number, headers: Record<string, string>): Promise<Response> {
  const storeEntry = await asset.getStoreEntry();
  return new Response(storeEntry.body, {
    status,
    headers,
  });
}

export class PublisherServer {
  private readonly serverConfig: PublisherServerConfigNormalized;
  private readonly contentAssets: ContentAssets;

  public constructor(
    serverConfig: PublisherServerConfigNormalized,
    contentAssets: ContentAssets,
  ) {
    this.serverConfig = serverConfig;
    this.contentAssets = contentAssets;
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

  async getFallbackHtmlResponse(): Promise<Response | null> {

    // These are raw asset paths, not relative to public path
    const { spaFile, notFoundPageFile } = this.serverConfig;

    if (spaFile != null) {
      const asset = this.contentAssets.getAsset(spaFile);
      if (asset != null) {
        return buildAssetResponse(asset, 200, {
          'Cache-Control': 'no-cache',
          'Content-Type': 'text/html',
        });
      }
    }

    if (notFoundPageFile != null) {
      const asset = this.contentAssets.getAsset(notFoundPageFile);
      if (asset != null) {
        return buildAssetResponse(asset, 404, {
          'Cache-Control': 'no-cache',
          'Content-Type': 'text/html',
        });
      }
    }

    return null;
  }

  async serveAsset(asset: ContentAsset): Promise<Response> {
    const metadata = asset.getMetadata();
    const headers = {
      'Content-Type': metadata.contentType,
      'Cache-Control': metadata.extendedCache ? 'max-age=31536000' : 'no-cache',
    };
    return buildAssetResponse(asset, 200, headers);
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
      return this.serveAsset(asset);
    }

    if (requestAcceptsTextHtml(request)) {
      // fallback HTML responses, like SPA and "not found" pages
      const fallbackResponse = await this.getFallbackHtmlResponse();
      if (fallbackResponse != null) {
        return fallbackResponse;
      }
    }

    return null;
  }
}
