import { ObjectStore } from "fastly:object-store";
import {
  ContentAsset,
  ContentAssetMetadataMapEntry,
  StoreEntry,
} from "../../types/index.js";
import {
  CompressedFileInfos,
  ContentAssetMetadataMapEntryObjectStore,
} from "../../types/content-assets.js";
import { ContentCompressionTypes } from "../../constants/compression.js";
import { ContentAssets, findMatchingSourceAndInfo, SourceAndInfo } from "./content-assets.js";

export class ContentObjectStoreAsset implements ContentAsset {
  readonly type = 'object-store';

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

  get isLocal() {
    return false;
  }

  get assetKey() {
    return this.metadata.assetKey;
  }

  async getStoreEntry(acceptEncodingsGroups: ContentCompressionTypes[][] = []): Promise<StoreEntry> {

    const { sourceAndInfo, contentEncoding } = findMatchingSourceAndInfo(acceptEncodingsGroups, this.sourceAndInfo, encoding => this.compressedSourcesAndInfo[encoding]);

    const objectStore = new ObjectStore(this.objectStoreName);
    let retries = 3;
    while (retries > 0) {
      const storeEntry = await objectStore.get(sourceAndInfo.source);
      if (storeEntry != null) {
        const { hash, size } = sourceAndInfo;
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

ContentAssets.registerAssetBuilder('object-store', (metadata, context) => {
  const { objectStoreName } = context;

  if (objectStoreName == null) {
    throw new Error("Unexpected! Object Store should be specified!!");
  }

  return new ContentObjectStoreAsset(metadata, objectStoreName);
});
