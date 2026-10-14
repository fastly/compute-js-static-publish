/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import fs from 'node:fs';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

import type { CompressOptions } from './index.js';

export const key = 'br';

// The async version runs on the libuv thread pool, so that more than one
// file can be compressed at the same time.
const brotliCompress = promisify(zlib.brotliCompress);

export async function compressTo(src: string, dest: string, options: CompressOptions = {}): Promise<void> {

  const buffer = await fs.promises.readFile(src);

  // If no quality is specified, use the zlib default (11, the maximum).
  const zlibOptions: zlib.BrotliOptions = {};
  if (options.brotliQuality != null) {
    zlibOptions.params = {
      [zlib.constants.BROTLI_PARAM_QUALITY]: options.brotliQuality,
    };
  }

  const resultBuffer = await brotliCompress(buffer, zlibOptions);
  await fs.promises.writeFile(dest, resultBuffer);

}
