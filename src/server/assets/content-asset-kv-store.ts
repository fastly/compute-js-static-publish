import { KVStore } from "fastly:kv-store";
import {
  ContentAsset,
  ContentAssetMetadataMapEntry,
  StoreEntry,
} from "../../types/index.js";
import {
  CompressedFileInfos,
  ContentAssetMetadataMapEntryKVStore,
} from "../../types/content-assets.js";
import { ContentCompressionTypes } from "../../constants/compression.js";
import { ContentAssets, findMatchingSourceAndInfo, SourceAndInfo } from "./content-assets.js";

export class ContentKVStoreAsset implements ContentAsset {
  readonly type = 'kv-store';

  private readonly metadata: ContentAssetMetadataMapEntryKVStore;

  private readonly kvStoreName: string;

  private readonly sourceAndInfo: SourceAndInfo<string>;
  private readonly compressedSourcesAndInfo: CompressedFileInfos<SourceAndInfo<string>>;

  constructor(metadata: ContentAssetMetadataMapEntryKVStore, kvStoreName: string) {
    this.metadata = metadata;
    this.kvStoreName = kvStoreName;

    this.sourceAndInfo = {
      source: metadata.fileInfo.kvStoreKey,
      hash: metadata.fileInfo.hash,
      size: metadata.fileInfo.size,
    };

    this.compressedSourcesAndInfo = Object.entries(metadata.compressedFileInfos)
      .reduce<CompressedFileInfos<SourceAndInfo<string>>>((obj, [key, value]) => {
        obj[key as ContentCompressionTypes] = {
          source: value.kvStoreKey,
          hash: value.hash,
          size: value.size,
        };
        return obj;
      }, {});
  }

  get isLocal() {
    return false;
  }

  get assetKey() {
    return this.metadata.assetKey;
  }

  async getStoreEntry(acceptEncodingsGroups: ContentCompressionTypes[][] = []): Promise<StoreEntry> {

    const { sourceAndInfo, contentEncoding } = findMatchingSourceAndInfo(acceptEncodingsGroups, this.sourceAndInfo, encoding => this.compressedSourcesAndInfo[encoding]);

    const kvStore = new KVStore(this.kvStoreName);
    let retries = 3;
    while (retries > 0) {
      const storeEntry = await kvStore.get(sourceAndInfo.source);
      if (storeEntry != null) {
        const { hash, size } = sourceAndInfo;
        return Object.assign(storeEntry, { contentEncoding, hash, size });
      }

      // Note the null does NOT mean 404. The fact that we are here means
      // metadata exists for this path, and we're just trying to get the data from
      // the KV Store.

      // So if we're here then the data is either not available yet (in which case
      // we can wait just a bit and try again), or the data was deleted.
      retries--;

      // We're going to wait 250ms/500ms/750ms and try again.
      const delay = (3-retries) * 250;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    throw new Error("Asset could not be retrieved from the KV Store.");
  }

  getBytes(): Uint8Array {
    throw new Error("Can't getBytes() for KV Store asset");
  }

  getText(): string {
    throw new Error("Can't getText() for KV Store asset");
  }

  getJson<T = unknown>(): T {
    throw new Error("Can't getJson() for KV Store asset");
  }

  getMetadata(): ContentAssetMetadataMapEntry {
    return this.metadata;
  }

}

ContentAssets.registerAssetBuilder('kv-store', (metadata, context) => {
  const { kvStoreName } = context;

  if (kvStoreName == null) {
    throw new Error("Unexpected! KV Store name should be specified!!");
  }

  return new ContentKVStoreAsset(metadata, kvStoreName);
});
