import type { ContentCompressionTypes } from "../constants/compression.js";
import type { StoreEntryAndContentType } from "../types/compute.js";

export type StaticPublisherCompressedFilePaths = Partial<Record<ContentCompressionTypes, string>>;

export type ContentAssetMetadataMapEntryBase = {
  assetKey: string;
  contentType: string,
  text: boolean,
  lastModifiedTime: number, // as unix time
  etag: string, // same as hash of file
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
  getStoreEntryAndContentType(acceptEncodings?: ContentCompressionTypes[]): Promise<StoreEntryAndContentType>;
  getBytes(): Uint8Array;
  getText(): string;
  readonly isInline: boolean;
}
