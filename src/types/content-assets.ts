import type { ContentCompressionTypes } from "../constants/compression.js";
import type { StoreEntryInfo } from "../types/compute.js";

export type CompressedFileInfos<TData> = Partial<Record<ContentCompressionTypes, TData>>;

export type ContentFileInfo = {
  hash: string, // same as hash of file
  staticFilePath: string,
};

export type ContentFileInfoForObjectStore = ContentFileInfo & {
  objectStoreKey: string,
}

export type ContentAssetMetadataMapEntryBase<TFileInfo> = {
  assetKey: string,
  contentType: string,
  text: boolean,
  lastModifiedTime: number, // as unix time
  fileInfo: TFileInfo,
  compressedFileInfos: CompressedFileInfos<TFileInfo>
};

export type ContentAssetMetadataMapEntryInline = {
  isInline: true,
} & ContentAssetMetadataMapEntryBase<ContentFileInfo>;

export type ContentAssetMetadataMapEntryObjectStore = {
  isInline: false,
} & ContentAssetMetadataMapEntryBase<ContentFileInfoForObjectStore>;

export type ContentAssetMetadataMapEntry =
  ContentAssetMetadataMapEntryInline | ContentAssetMetadataMapEntryObjectStore;

export type ContentAssetMetadataMap = {
  [assetKey: string]: ContentAssetMetadataMapEntry,
};

export interface ContentAsset {
  readonly assetKey: string;
  getMetadata(): ContentAssetMetadataMapEntry;
  getStoreEntryInfo(acceptEncodings?: ContentCompressionTypes[]): Promise<StoreEntryInfo>;
  getBytes(): Uint8Array;
  getText(): string;
  readonly isInline: boolean;
}
