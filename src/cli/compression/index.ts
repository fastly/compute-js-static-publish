/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import * as brotli from './brotli.js';
import * as gzip from './gzip.js';

import { type ContentCompressionTypes } from '../../models/compression/index.js';

export type CompressOptions = {
  // Brotli quality, 0 to 11. If not set, the zlib default (11) is used.
  brotliQuality?: number,
};

export type CompressAlg = (src: string, dest: string, options?: CompressOptions) => Promise<void>;

const algs: Record<ContentCompressionTypes, CompressAlg> = {
  br: brotli.compressTo,
  gzip: gzip.compressTo,
};

export { algs };
