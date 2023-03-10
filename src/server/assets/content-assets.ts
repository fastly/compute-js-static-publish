import { includeBytes } from "fastly:experimental";
import { ObjectStore } from "fastly:object-store";

import { AssetManager } from "./asset-manager.js";
import { InlineStoreEntry } from "../object-store/inline-store-entry.js";

import type {
  CompressedFileInfos,
  ContentAsset,
  ContentAssetMetadataMap,
  ContentAssetMetadataMapEntry,
  ContentAssetMetadataMapEntryInline,
  ContentAssetMetadataMapEntryObjectStore
} from "../../types/content-assets.js";
import type { StoreEntry } from "../../types/compute.js";
import type { ContentCompressionTypes } from "../../constants/compression.js";

const decoder = new TextDecoder();

type SourceAndInfo<TSource> = {
  source: TSource,
  hash: string,
  size: number,
};

export class ContentInlineAsset implements ContentAsset {
  readonly isInline: boolean = true;

  private readonly metadata: ContentAssetMetadataMapEntryInline;

  private readonly sourceAndInfo: SourceAndInfo<Uint8Array>;
  private readonly compressedSourcesAndInfo: CompressedFileInfos<SourceAndInfo<Uint8Array>>;

  constructor(metadata: ContentAssetMetadataMapEntryInline) {
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

  get assetKey() {
    return this.metadata.assetKey;
  }

  async getStoreEntry(acceptEncodings?: ContentCompressionTypes[]): Promise<StoreEntry> {
    let sourceAndInfo: SourceAndInfo<Uint8Array> | undefined;
    let contentEncoding: ContentCompressionTypes | null = null;
    if (acceptEncodings != null) {
      for(const encoding of acceptEncodings) {
        sourceAndInfo = this.compressedSourcesAndInfo[encoding];
        if (sourceAndInfo != null) {
          contentEncoding = encoding;
          break;
        }
      }
    }
    sourceAndInfo ??= this.sourceAndInfo;

    return new InlineStoreEntry(sourceAndInfo.source, contentEncoding, sourceAndInfo.hash, sourceAndInfo.size);
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

export class ContentObjectStoreAsset implements ContentAsset {
  readonly isInline: boolean = false;

  private readonly metadata: ContentAssetMetadataMapEntryObjectStore;

  private readonly objectStoreName: string;

  private readonly sourceAndInfo: SourceAndInfo<string>;
  private readonly compressedSourcesAndInfo: CompressedFileInfos<SourceAndInfo<string>>;

  constructor(metadata: ContentAssetMetadataMapEntryObjectStore, objectStoreName: string) {
    this.metadata = metadata;
    this.objectStoreName = objectStoreName;

    this.sourceAndInfo = {
      source: metadata.fileInfo.objectStoreKey,
      hash: metadata.fileInfo.hash,
      size: metadata.fileInfo.size,
    };

    this.compressedSourcesAndInfo = Object.entries(metadata.compressedFileInfos)
      .reduce<CompressedFileInfos<SourceAndInfo<string>>>((obj, [key, value]) => {
        obj[key as ContentCompressionTypes] = {
          source: value.objectStoreKey,
          hash: value.hash,
          size: value.size,
        };
        return obj;
      }, {});
  }

  get assetKey() {
    return this.metadata.assetKey;
  }

  async getStoreEntry(acceptEncodings: ContentCompressionTypes[] = []): Promise<StoreEntry> {
    let sourceAndInfo: SourceAndInfo<string> | undefined;
    let contentEncoding: ContentCompressionTypes | null = null;
    if (acceptEncodings != null) {
      for(const encoding of acceptEncodings) {
        sourceAndInfo = this.compressedSourcesAndInfo[encoding];
        if (sourceAndInfo != null) {
          contentEncoding = encoding;
          break;
        }
      }
    }
    sourceAndInfo ??= this.sourceAndInfo;
    const hash = sourceAndInfo.hash;
    const size = sourceAndInfo.size;

    const objectStore = new ObjectStore(this.objectStoreName);
    let retries = 3;
    while (retries > 0) {
      const storeEntry = await objectStore.get(sourceAndInfo.source);
      if (storeEntry != null) {
        return Object.assign(storeEntry, { contentEncoding, hash, size });
      }

      // Note the null does NOT mean 404. The fact that we are here means
      // metadata exists for this path, and we're just trying to get the data from
      // the object store.

      // So if we're here then the data is either not available yet (in which case
      // we can wait just a bit and try again), or the data was deleted.
      retries--;

      // We're going to wait 250ms/500ms/750ms and try again.
      const delay = (3-retries) * 250;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    throw new Error("Asset could not be retrieved from the Object Store.");
  }

  getBytes(): Uint8Array {
    throw new Error("Can't getBytes() for Object Store asset");
  }

  getText(): string {
    throw new Error("Can't getText() for Object Store asset");
  }

  getMetadata(): ContentAssetMetadataMapEntry {
    return this.metadata;
  }

}

export class ContentAssets extends AssetManager<ContentAsset> {

  constructor(objectStoreName: string | null, contentAssetMetadataMap: ContentAssetMetadataMap) {
    super();

    for (const [assetKey, metadata] of Object.entries(contentAssetMetadataMap)) {

      let asset: ContentAsset;
      if (metadata.isInline) {

        asset = new ContentInlineAsset(metadata);

      } else {

        if (objectStoreName == null) {
          throw new Error("Unexpected! Object Store should be specified!!");
        }

        asset = new ContentObjectStoreAsset(metadata, objectStoreName);
      }

      this.setAsset(assetKey, asset);
    }
  }
}
