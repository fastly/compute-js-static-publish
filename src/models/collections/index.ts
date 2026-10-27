/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// A collection name must be a DNS label: lowercase a-z, 0-9, and '-', from
// 1 to 63 characters, with no '-' at the start or the end. A collection name
// is used in storage keys, in the surrogate key of the purge, in a cookie,
// and in hostnames (preview URLs), and a DNS label is safe in all of them.
// It also cannot have a character that breaks a cookie (';', ',', '=',
// spaces, quotes, '\', or control characters).
const COLLECTION_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const COLLECTION_NAME_RULE =
  "Use lowercase a-z, 0-9, and '-', from 1 to 63 characters, with no '-' at the start or the end.";

export function isValidCollectionName(name: string): boolean {
  return COLLECTION_NAME_PATTERN.test(name);
}
