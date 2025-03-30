/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

export const compressionTypes = [
  'br',
  'gzip',
] as const;

export type ContentCompressionTypes = typeof compressionTypes[number];

export function isCompressionType(value: string): value is ContentCompressionTypes {
  return (compressionTypes as Readonly<string[]>).includes(value);
}
