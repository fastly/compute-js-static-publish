/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// This exists because some platforms such as AWS insist on lowercasing their metadata keys
export function getMetadataFieldValue(metadata: Record<string, string>, key: string) {

  return metadata[key] ?? metadata[key.toLowerCase()] ?? undefined;

}
