import type { StoreEntry } from "../types/compute.js";

export type ContentAssetMetadataMapEntryBase = {
  assetKey: string;
  contentType: string,
  text: boolean,
};

export type ContentAssetMetadataMapEntryInline = ContentAssetMetadataMapEntryBase & {
  isInline: true,
  staticFilePath: string,
};
export type ContentAssetMetadataMapEntryObjectStore = ContentAssetMetadataMapEntryBase & {
  isInline: false;
  objectStoreKey: string;
};
export type ContentAssetMetadataMapEntry =
  ContentAssetMetadataMapEntryInline | ContentAssetMetadataMapEntryObjectStore;

export type ContentAssetMetadataMap = {
  [assetKey: string]: ContentAssetMetadataMapEntry,
};

export interface ContentAsset {
  readonly assetKey: string;
  getMetadata(): ContentAssetMetadataMapEntry;
  getStoreEntry(): Promise<StoreEntry>;
  getBytes(): Uint8Array;
  getText(): string;
  readonly isInline: boolean;
}
