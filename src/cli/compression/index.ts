/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import * as brotli from './brotli.js';
import * as gzip from './gzip.js';

import { type ContentCompressionTypes } from '../../models/compression/index.js';

export type CompressAlg = (src: string, dest: string) => Promise<void>;

const algs: Record<ContentCompressionTypes, CompressAlg> = {
  br: brotli.compressTo,
  gzip: gzip.compressTo,
};

export { algs };
