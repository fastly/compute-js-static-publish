import { AssetManager } from "./asset-manager.js";
import { InlineStoreEntry } from "../kv-store/inline-store-entry.js";

import type {
  ContentAsset,
  ContentAssetMetadataMap,
  ContentAssetMetadataMapEntry,
  ContentAssetMetadataMapEntryBytes,
  ContentAssetMetadataMapEntryString,
} from "../../types/content-assets.js";
import type { StoreEntry } from "../../types/compute.js";
import type { ContentCompressionTypes } from "../../constants/compression.js";

const decoder = new TextDecoder();

export type SourceAndInfo<TSource> = {
  source: TSource,
  hash: string,
  size: number,
};

type SourceAndInfoForEncodingFn<TSource> = (contentEncoding: ContentCompressionTypes) => SourceAndInfo<TSource> | undefined;
export function findMatchingSourceAndInfo<TSource>(acceptEncodingsGroups: ContentCompressionTypes[][], defaultSourceAndInfo: SourceAndInfo<TSource>, sourceAndInfoForEncodingFn: SourceAndInfoForEncodingFn<TSource>) {

  let sourceAndInfo: SourceAndInfo<TSource> | undefined;
  let contentEncoding: ContentCompressionTypes | null = null;
  if (acceptEncodingsGroups != null) {
    for(const encodingGroup of acceptEncodingsGroups) {
      const sourceAndInfosForEncodingsGroup = encodingGroup
        .map(encoding => ({ encoding, sourceAndInfo: sourceAndInfoForEncodingFn(encoding) }))
        .filter(x => x.sourceAndInfo != null) as {encoding: ContentCompressionTypes, sourceAndInfo: SourceAndInfo<TSource>}[];

      if (sourceAndInfosForEncodingsGroup.length === 0) {
        // If no encoding in this group is available then move to next group
        continue;
      }

      // Sort the items, putting the smallest size first
      sourceAndInfosForEncodingsGroup
        .sort((a, b) => a.sourceAndInfo.size - b.sourceAndInfo.size);

      // The first item is the one we want.
      sourceAndInfo = sourceAndInfosForEncodingsGroup[0].sourceAndInfo;
      contentEncoding = sourceAndInfosForEncodingsGroup[0].encoding;
      break;
    }
  }

  sourceAndInfo ??= defaultSourceAndInfo;

  return { sourceAndInfo, contentEncoding };
}

abstract class ContentRuntimeAsset<TMetadataMapEntry extends ContentAssetMetadataMapEntry> {
  protected readonly metadata: TMetadataMapEntry;
  protected sourceAndInfo: SourceAndInfo<Uint8Array>;
  protected constructor(metadata: TMetadataMapEntry, sourceAndInfo: SourceAndInfo<Uint8Array>) {
    this.metadata = metadata;
    this.sourceAndInfo = sourceAndInfo;
  }

  get isLocal() {
    return true;
  }

  get assetKey() {
    return this.metadata.assetKey;
  }

  async getStoreEntry(): Promise<StoreEntry> {
    const { source, hash, size } = this.sourceAndInfo;
    return new InlineStoreEntry(source, null, hash, size);
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

  getJson<T = unknown>(): T {
    const text = this.getText();
    return JSON.parse(text) as T;
  }

  getMetadata(): ContentAssetMetadataMapEntry {
    return this.metadata;
  }
}

export class ContentBytesAsset
    extends ContentRuntimeAsset<ContentAssetMetadataMapEntryBytes>
    implements ContentAsset {
  readonly type = 'bytes';

  constructor(metadata: ContentAssetMetadataMapEntryBytes) {
    super(metadata, {
      source: metadata.fileInfo.bytes,
      hash: metadata.fileInfo.hash,
      size: metadata.fileInfo.size,
    });
  }
}

export class ContentStringAsset
    extends ContentRuntimeAsset<ContentAssetMetadataMapEntryString>
    implements ContentAsset {
  readonly type = 'string';

  static encoder = new TextEncoder();
  constructor(metadata: ContentAssetMetadataMapEntryString) {
    super(metadata, {
      source: ContentStringAsset.encoder.encode(metadata.fileInfo.content),
      hash: metadata.fileInfo.hash,
      size: metadata.fileInfo.size,
    });
  }
}

export type AssetBuilder<TType extends string> = (metadata: ContentAssetMetadataMapEntry & { type: TType }, assetBuilderContext: AssetBuilderContext) => ContentAsset;
type AssetBuilderContext = any;

export class ContentAssets extends AssetManager<ContentAsset> {

  static builders: Record<string, AssetBuilder<any>> = {};

  constructor(contentAssetMetadataMap: ContentAssetMetadataMap, assetBuilderContext: AssetBuilderContext = {}) {
    super();

    for (const [assetKey, metadata] of Object.entries(contentAssetMetadataMap)) {

      if (!(metadata.type in ContentAssets.builders)) {
        throw new Error(`Unknown content asset type '${metadata.type}'`);
      }

      const asset = ContentAssets.builders[metadata.type](metadata, assetBuilderContext);
      this.initAsset(assetKey, asset);
    }
  }

  static registerAssetBuilder<TType extends string>(type: TType, builder: AssetBuilder<TType>) {
    this.builders[type] = builder;
  }
}

ContentAssets.registerAssetBuilder('bytes', metadata => new ContentBytesAsset(metadata));
ContentAssets.registerAssetBuilder('string', metadata => new ContentStringAsset(metadata));
