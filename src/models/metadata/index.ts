/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// To work with some platforms such as S3 that insist on lowercasing their metadata keys
export function getMetadataFieldValue(metadata: Record<string, string>, key: string) {

  return metadata[key] ?? metadata[key.toLowerCase()] ?? undefined;

}
