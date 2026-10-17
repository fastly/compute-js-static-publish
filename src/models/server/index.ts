/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { getMetadataFieldValue } from '../metadata/index.js';

export type IndexMetadata = {
  publishedTime?: number,
  expirationTime?: number,
  // The features that the server must support to serve this collection.
  // A newer CLI adds a feature only if the published content uses it.
  requires?: string[],
  // Fields that this version does not know. They are kept, so that a command
  // that writes the metadata again (for example promote) does not remove them.
  otherFields?: Record<string, string>,
};

// The features that this version of PublisherServer supports. A server does
// not serve a collection that requires a feature that is not in this list.
export const SUPPORTED_INDEX_FEATURES: readonly string[] = [];

const KNOWN_FIELDS = [ 'publishedTime', 'expirationTime', 'requires' ];

export function encodeIndexMetadata(indexMetadata: IndexMetadata): Record<string, string> {
  const result: Record<string, string> = { ...indexMetadata.otherFields };

  if (indexMetadata.publishedTime != null && !isNaN(indexMetadata.publishedTime)) {
    result['publishedTime'] = String(indexMetadata.publishedTime);
  }

  if (indexMetadata.expirationTime != null && !isNaN(indexMetadata.expirationTime)) {
    result['expirationTime'] = String(indexMetadata.expirationTime);
  }

  if (indexMetadata.requires != null && indexMetadata.requires.length > 0) {
    result['requires'] = indexMetadata.requires.join(',');
  }

  return result;
}

export function decodeIndexMetadata(obj: Record<string, string> | undefined): IndexMetadata | null {
  if (obj == null) {
    return null;
  }
  const publishedTime = parseFloat(getMetadataFieldValue(obj, 'publishedTime'));
  const expirationTime = parseFloat(getMetadataFieldValue(obj, 'expirationTime'));
  const requiresValue = getMetadataFieldValue(obj, 'requires');
  const requires = requiresValue != null
    ? String(requiresValue).split(',').map(x => x.trim()).filter(x => x !== '')
    : [];

  // S3 makes the metadata keys lowercase, so compare the keys without case.
  const knownKeys = KNOWN_FIELDS.map(x => x.toLowerCase());
  let otherFields: Record<string, string> | undefined;
  for (const [ key, value ] of Object.entries(obj)) {
    if (!knownKeys.includes(key.toLowerCase())) {
      otherFields ??= {};
      otherFields[key] = String(value);
    }
  }

  return {
    publishedTime: !isNaN(publishedTime) ? publishedTime : undefined,
    expirationTime: !isNaN(expirationTime) ? expirationTime : undefined,
    requires: requires.length > 0 ? requires : undefined,
    otherFields,
  };
}

// Returns the features in requires that are not in supportedFeatures.
export function getUnsupportedIndexFeatures(
  indexMetadata: IndexMetadata,
  supportedFeatures: readonly string[] = SUPPORTED_INDEX_FEATURES,
): string[] {
  return (indexMetadata.requires ?? []).filter(x => !supportedFeatures.includes(x));
}
