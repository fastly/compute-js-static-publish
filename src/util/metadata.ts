import type { ContentAssetMetadataMap } from "../types/content-assets.js";

export function getObjectStoreKeysFromMetadata(contentAssetMetadataMap: ContentAssetMetadataMap): Set<string> {

  const results = new Set<string>();

  for (const metadata of Object.values(contentAssetMetadataMap)) {
    if (metadata.type === 'object-store') {
      results.add(metadata.fileInfo.objectStoreKey);
      for (const fileInfo of Object.values(metadata.compressedFileInfos)) {
        results.add(fileInfo.objectStoreKey);
      }
    }
  }

  return results;

}
