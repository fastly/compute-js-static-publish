import { includeBytes } from "fastly:experimental";
import { ObjectStore } from "fastly:object-store";

import { AssetManager } from "./asset-manager.js";
import { IncludeBytesStoreEntry } from "../include-bytes-store-entry.js";

import type { StoreEntry } from "../types/compute.js";
import type {
  ContentAsset,
  ContentAssetMetadataMap,
  ContentAssetMetadataMapEntry,
  ContentAssetMetadataMapEntryInline,
  ContentAssetMetadataMapEntryObjectStore
} from "../types/content-assets.js";

const decoder = new TextDecoder();

export class ContentInlineAsset implements ContentAsset {
  readonly isInline: boolean = true;

  private readonly metadata: ContentAssetMetadataMapEntryInline;

  private readonly bytes: Uint8Array;

  constructor(metadata: ContentAssetMetadataMapEntryInline, bytes: Uint8Array) {
    this.metadata = metadata;
    this.bytes = bytes;
  }

  get assetKey() {
    return this.metadata.assetKey;
  }

  getStoreEntry(): Promise<StoreEntry> {
    return Promise.resolve(new IncludeBytesStoreEntry(this.bytes));
  }

  getBytes(): Uint8Array {
    return this.bytes;
  }

  getText(): string {
    if (!this.metadata.text) {
      throw new Error("Can't getText() for non-text content");
    }
    return decoder.decode(this.bytes);
  }

  getMetadata(): ContentAssetMetadataMapEntry {
    return this.metadata;
  }

}

export class ContentObjectStoreAsset implements ContentAsset {
  readonly isInline: boolean = false;

  private readonly metadata: ContentAssetMetadataMapEntryObjectStore;

  private readonly objectStoreName: string;

  constructor(metadata: ContentAssetMetadataMapEntryObjectStore, objectStoreName: string) {
    this.metadata = metadata;
    this.objectStoreName = objectStoreName;
  }

  get assetKey() {
    return this.metadata.assetKey;
  }

  async getStoreEntry(): Promise<StoreEntry> {
    const objectStore = new ObjectStore(this.objectStoreName);
    let retries = 3;
    while (retries > 0) {
      const entry = await objectStore.get(this.metadata.objectStoreKey);
      if (entry != null) {
        return entry;
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

        const bytes = includeBytes(metadata.staticFilePath);
        asset = new ContentInlineAsset(metadata, bytes);

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
