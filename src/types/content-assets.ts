import type { ContentCompressionTypes } from "../constants/compression.js";
import type { StoreEntry } from "../types/compute.js";

export type CompressedFileInfos<TData> = Partial<Record<ContentCompressionTypes, TData>>;

export type ContentFileInfo = {
  hash: string, // same as hash of file
  size: number,
};

// For runtime use e.g., testing
export type ContentFileInfoForBytes = ContentFileInfo & {
  bytes: Uint8Array,
};
export type ContentFileInfoForString = ContentFileInfo & {
  content: string,
};

// For static publishing
export type ContentFileInfoForStaticPublishing = ContentFileInfo & {
  staticFilePath: string,
};

export type ContentFileInfoForWasmInline = ContentFileInfoForStaticPublishing;

export type ContentFileInfoForKVStore = ContentFileInfoForStaticPublishing & {
  kvStoreKey: string,
};

export type ContentAssetMetadataMapEntryBase<TFileInfo> = {
  assetKey: string,
  contentType: string,
  text: boolean,
  lastModifiedTime: number, // as unix time
  fileInfo: TFileInfo,
  compressedFileInfos: CompressedFileInfos<TFileInfo>
};

export type ContentAssetMetadataMapEntryBytes = {
  type: 'bytes',
} & ContentAssetMetadataMapEntryBase<ContentFileInfoForBytes>;
export type ContentAssetMetadataMapEntryString = {
  type: 'string',
} & ContentAssetMetadataMapEntryBase<ContentFileInfoForString>;

export type ContentAssetMetadataMapEntryWasmInline = {
  type: 'wasm-inline',
} & ContentAssetMetadataMapEntryBase<ContentFileInfoForWasmInline>;

export type ContentAssetMetadataMapEntryKVStore = {
  type: 'kv-store',
} & ContentAssetMetadataMapEntryBase<ContentFileInfoForKVStore>;

export type ContentAssetMetadataMapEntry =
  | ContentAssetMetadataMapEntryBytes
  | ContentAssetMetadataMapEntryString
  | ContentAssetMetadataMapEntryWasmInline
  | ContentAssetMetadataMapEntryKVStore;

export type ContentAssetMetadataMap = {
  [assetKey: string]: ContentAssetMetadataMapEntry,
};

export interface ContentAsset {
  readonly type: string;
  readonly isLocal: boolean;
  readonly assetKey: string;
  getMetadata(): ContentAssetMetadataMapEntry;
  getStoreEntry(acceptEncodingsGroups?: ContentCompressionTypes[][]): Promise<StoreEntry>;
  getBytes(): Uint8Array;
  getText(): string;
  getJson<T = unknown>(): T;
}
