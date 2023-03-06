import type { StoreEntry } from "../types/compute.js";
import type { ContentCompressionTypes } from "../constants/compression.js";

export type StaticPublisherCompressedFilePaths = Partial<Record<ContentCompressionTypes, string>>;

export type ContentAssetMetadataMapEntryBase = {
  assetKey: string;
  contentType: string,
  text: boolean,
  staticFilePath: string,
  staticFilePathsCompressed: StaticPublisherCompressedFilePaths,
};

export type ContentAssetMetadataMapEntryInline = ContentAssetMetadataMapEntryBase & {
  isInline: true,
};
export type ContentAssetMetadataMapEntryObjectStore = ContentAssetMetadataMapEntryBase & {
  isInline: false,
  objectStoreKey: string,
  objectStoreKeysCompressed: StaticPublisherCompressedFilePaths,
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
