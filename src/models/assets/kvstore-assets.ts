/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { type ContentCompressionTypes, isCompressionType } from '../compression/index.js';

export type KVAssetEntry = {
  key: string,
  size: number,
  contentType: string,
  lastModifiedTime: number,
  variants: ContentCompressionTypes[],
};

export type KVAssetEntryMap = Record<string, KVAssetEntry>;

export type KVAssetVariantMetadata = {
  contentEncoding?: ContentCompressionTypes,
  size: number,
  hash: string,
  numChunks?: number,
};

export function isKVAssetVariantMetadata(obj: unknown): obj is KVAssetVariantMetadata {
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
