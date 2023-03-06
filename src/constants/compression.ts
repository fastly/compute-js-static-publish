export const compressionTypes = [
  'br',
  'gzip',
] as const;

export type ContentCompressionTypes = typeof compressionTypes[number];
