import type { ContentAssetMetadataMap } from "../types/content-assets.js";

export function getObjectStoreKeys(contentAssetMetadataMap: ContentAssetMetadataMap): Set<string> {

  const results = new Set<string>();

  for (const metadata of Object.values(contentAssetMetadataMap)) {
    if (!metadata.isInline) {
      results.add(metadata.objectStoreKey);
    }
  }

  return results;

}
