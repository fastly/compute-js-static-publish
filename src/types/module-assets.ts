export type ModuleAssetMapEntry = {
  isStaticImport: boolean;
  module: any | null,
  loadModule: () => Promise<any>,
};
export type ModuleAssetMap = {
  [assetKey: string]: ModuleAssetMapEntry,
};

export interface ModuleAsset {
  readonly assetKey: string;
  getModule(): Promise<any>;
  getStaticModule(): any | null;
  readonly isStaticImport: boolean;
}
