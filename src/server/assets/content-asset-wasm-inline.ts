import { includeBytes } from "fastly:experimental";
import {
  ContentAsset,
  ContentAssetMetadataMapEntry,
  StoreEntry,
} from "../../types/index.js";
import {
  CompressedFileInfos,
  ContentAssetMetadataMapEntryWasmInline,
} from "../../types/content-assets.js";
import { ContentCompressionTypes } from "../../constants/compression.js";
import { InlineStoreEntry } from "../object-store/inline-store-entry.js";
import { ContentAssets, findMatchingSourceAndInfo, SourceAndInfo } from "./content-assets.js";

const decoder = new TextDecoder();

export class ContentWasmInlineAsset implements ContentAsset {
  readonly type = 'wasm-inline';

  private readonly metadata: ContentAssetMetadataMapEntryWasmInline;

  private readonly sourceAndInfo: SourceAndInfo<Uint8Array>;
  private readonly compressedSourcesAndInfo: CompressedFileInfos<SourceAndInfo<Uint8Array>>;

  constructor(metadata: ContentAssetMetadataMapEntryWasmInline) {
    this.metadata = metadata;

    this.sourceAndInfo = {
      source: includeBytes(metadata.fileInfo.staticFilePath),
      hash: metadata.fileInfo.hash,
      size: metadata.fileInfo.size,
    };

    this.compressedSourcesAndInfo = Object.entries(metadata.compressedFileInfos)
      .reduce<CompressedFileInfos<SourceAndInfo<Uint8Array>>>((obj, [key, value]) => {
        obj[key as ContentCompressionTypes] = {
          source: includeBytes(value.staticFilePath),
          hash: value.hash,
          size: value.size,
        };
        return obj;
      }, {});
  }

  get isLocal() {
    return true;
  }

  get assetKey() {
    return this.metadata.assetKey;
  }

  async getStoreEntry(acceptEncodingsGroups: ContentCompressionTypes[][] = []): Promise<StoreEntry> {
    const { sourceAndInfo, contentEncoding } = findMatchingSourceAndInfo(acceptEncodingsGroups, this.sourceAndInfo, encoding => this.compressedSourcesAndInfo[encoding]);
    const { source, hash, size } = sourceAndInfo;
    return new InlineStoreEntry(source, contentEncoding, hash, size);
  }

  getBytes(): Uint8Array {
    return this.sourceAndInfo.source;
  }

  getText(): string {
    if (!this.metadata.text) {
      throw new Error("Can't getText() for non-text content");
    }
    return decoder.decode(this.sourceAndInfo.source);
  }

  getMetadata(): ContentAssetMetadataMapEntry {
    return this.metadata;
  }
}

ContentAssets.registerAssetBuilder('wasm-inline', metadata => new ContentWasmInlineAsset(metadata));
