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

  const numChunks = parseFloat(getMetadataFieldValue(obj, 'contentEncoding'));

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
