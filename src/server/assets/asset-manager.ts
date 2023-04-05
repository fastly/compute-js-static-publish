export abstract class AssetManager<TAsset> {

  protected readonly assets: Record<string, TAsset>;

  protected constructor() {
    this.assets = {};
  }

  protected initAsset(assetKey: string, asset: TAsset) {
    this.assets[assetKey] = asset;
  }

  getAsset(assetKey: string): TAsset | null {
    return this.assets[assetKey] ?? null;
  }

  getAssetKeys(): string[] {
    return Object.keys(this.assets);
  }

}
