/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { getMetadataFieldValue } from '../metadata/index.js';
import { type ContentCompressionTypes, isCompressionType } from '../compression/index.js';

export type AssetEntry = {
  key: string,
  size: number,
  contentType: string,
  lastModifiedTime: number,
  variants: ContentCompressionTypes[],
};

export type AssetEntryMap = Record<string, AssetEntry>;

// A hidden file is published, but PublisherServer does not serve it for a
// request. Its key in the index is this prefix and then the asset key, for
// example 'hidden:/404.html'. A real asset key always starts with '/', so no
// request path can match such a key. A collection that has a hidden file
// requires the 'hidden' feature.
export const HIDDEN_INDEX_KEY_PREFIX = 'hidden:';
export const HIDDEN_INDEX_FEATURE = 'hidden';

export function hiddenIndexKey(assetKey: string): string {
  return HIDDEN_INDEX_KEY_PREFIX + assetKey;
}

export function isHiddenIndexKey(indexKey: string): boolean {
  return indexKey.startsWith(HIDDEN_INDEX_KEY_PREFIX);
}

// Find the entry for an asset key. With includeHidden, also find a hidden file.
export function findAssetEntry(assetEntryMap: AssetEntryMap, assetKey: string, includeHidden: boolean): AssetEntry | null {
  if (isHiddenIndexKey(assetKey)) {
    return null;
  }
  return assetEntryMap[assetKey] ?? (includeHidden ? assetEntryMap[hiddenIndexKey(assetKey)] : undefined) ?? null;
}

// The number of hidden files in an index.
export function countHiddenEntries(assetEntryMap: AssetEntryMap): number {
  return Object.keys(assetEntryMap).filter(isHiddenIndexKey).length;
}

export type AssetVariantMetadata = {
  contentEncoding?: ContentCompressionTypes,
  size: number,
  hash: string,
  numChunks?: number,
};

export function decodeAssetVariantMetadata(obj: Record<string, string> | undefined): AssetVariantMetadata | null {
  if (obj == null) {
    return null;
  }

  const contentEncoding = getMetadataFieldValue(obj, 'contentEncoding');
  if (contentEncoding != null && !isCompressionType(contentEncoding)) {
    return null;
  }

  const size = parseFloat(getMetadataFieldValue(obj, 'size'));
  if (isNaN(size)) {
    return null;
  }

  const hash = getMetadataFieldValue(obj, 'hash');
  if (hash == null) {
    return null;
  }

  const numChunks = parseInt(getMetadataFieldValue(obj, 'numChunks'), 10);

  const assetVariantMetadata: AssetVariantMetadata = {
    size,
    hash,
    numChunks: !isNaN(numChunks) ? numChunks : undefined,
  };

  if (contentEncoding != null) {
    assetVariantMetadata.contentEncoding = contentEncoding;
  }

  return assetVariantMetadata;
}
