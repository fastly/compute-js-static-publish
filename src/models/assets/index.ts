/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

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

export function isAssetVariantMetadata(obj: unknown): obj is AssetVariantMetadata {
  if (obj == null || typeof obj !== 'object') {
    return false;
  }
  if ('contentEncoding' in obj) {
    if (
        typeof obj.contentEncoding !== 'string' ||
        !isCompressionType(obj.contentEncoding)
    ) {
      return false;
    }
  }
  if (!('size' in obj) || typeof obj.size !== 'number') {
    return false;
  }
  if (!('hash' in obj) || typeof obj.hash !== 'string') {
    return false;
  }
  if ('numChunks' in obj) {
    if (typeof obj.numChunks !== 'number') {
      return false;
    }
  }

  return true;
}
