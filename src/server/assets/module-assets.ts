import { AssetManager } from "./asset-manager.js";

import type { ModuleAsset, ModuleAssetMap } from "../../types/module-assets.js";

export class ModuleAssetDynamic implements ModuleAsset {
  readonly assetKey: string;
  readonly isStaticImport: boolean = false;

  private readonly loadModule: () => Promise<any>;

  constructor(assetKey: string, loadModule: () => Promise<any>) {
    this.assetKey = assetKey;
    this.loadModule = loadModule;
  }

  private _modulePromise: Promise<any> | undefined;
  getModule(): Promise<any> {
    if (this._modulePromise === undefined) {
      this._modulePromise = this.loadModule();
    }
    return this._modulePromise;
  }

  getStaticModule(): any {
    return null;
  }

}

export class ModuleAssetStatic implements ModuleAsset {
  readonly assetKey: string;
  readonly isStaticImport: boolean = true;

  private readonly module: any;
  constructor(assetKey: string, module: any) {
    this.assetKey = assetKey;
    this.module = module;
  }

  getModule(): Promise<any> {
    return Promise.resolve(this.module);
  }

  getStaticModule(): any {
    return this.module;
  }

}

export class ModuleAssets extends AssetManager<ModuleAsset> {

  constructor(moduleAssetMap: ModuleAssetMap) {
    super();

    for (const [assetKey, moduleEntry] of Object.entries(moduleAssetMap)) {

      let asset: ModuleAsset;
      if (moduleEntry.isStaticImport) {

        asset = new ModuleAssetStatic(assetKey, moduleEntry.module);

      } else {

        asset = new ModuleAssetDynamic(assetKey, moduleEntry.loadModule);

      }

      this.setAsset(assetKey, asset);
    }
  }
}
