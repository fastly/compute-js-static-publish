/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { getMetadataFieldValue } from '../metadata/index.js';

export type IndexMetadata = {
  publishedTime?: number,
  expirationTime?: number,
};

export function encodeIndexMetadata(indexMetadata: IndexMetadata): Record<string, string> {
  const result: Record<string, string> = {};

  if (indexMetadata.publishedTime != null && !isNaN(indexMetadata.publishedTime)) {
    result['publishedTime'] = String(indexMetadata.publishedTime);
  }

  if (indexMetadata.expirationTime != null && !isNaN(indexMetadata.expirationTime)) {
    result['expirationTime'] = String(indexMetadata.expirationTime);
  }

  return result;
}

export function decodeIndexMetadata(obj: Record<string, string> | undefined): IndexMetadata | null {
  if (obj == null) {
    return null;
  }
  const publishedTime = parseFloat(getMetadataFieldValue(obj, 'publishedTime'));
  const expirationTime = parseFloat(getMetadataFieldValue(obj, 'expirationTime'));
  return {
    publishedTime: !isNaN(publishedTime) ? publishedTime : undefined,
    expirationTime: !isNaN(expirationTime) ? expirationTime : undefined,
  };
}
