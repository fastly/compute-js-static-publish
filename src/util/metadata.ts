import type { ContentAssetMetadataMap } from "../types/content-assets.js";

export function getKVStoreKeysFromMetadata(contentAssetMetadataMap: ContentAssetMetadataMap): Set<string> {

  const results = new Set<string>();

  for (const metadata of Object.values(contentAssetMetadataMap)) {
    if (metadata.type === 'kv-store') {
      results.add(metadata.fileInfo.kvStoreKey);
      for (const fileInfo of Object.values(metadata.compressedFileInfos)) {
        results.add(fileInfo.kvStoreKey);
      }
    }
  }

  return results;

}
