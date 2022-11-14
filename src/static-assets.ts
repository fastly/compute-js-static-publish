import { AssetsMap } from "./types.js";

export class StaticAssets {
  readonly assetsMap: AssetsMap;

  constructor(assetsMap: AssetsMap) {
    this.assetsMap = assetsMap;
  }

  public serveAsset(event: FetchEvent, pathPrefix: string = '') {
    const { request } = event;
    const { pathname } = new URL(request.url);

    const asset = this.assetsMap[`${pathPrefix}${pathname}`];
    if (!asset) {
      return null;
    }

    // Aggressive caching for static files, and no caching for everything else.
    const headers: HeadersInit = {
      'Cache-Control': asset.isStatic ? 'max-age=31536000' : 'no-cache',
    };
    if (asset.contentType != null) {
      headers['Content-Type'] = asset.contentType;
    }
    return new Response(asset.content, {
      status: 200,
      headers,
    });
  }
}
