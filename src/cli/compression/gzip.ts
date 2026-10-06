/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import fs from 'node:fs';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

import type { CompressOptions } from './index.js';

export const key = 'gzip';

// The async version runs on the libuv thread pool, so that more than one
// file can be compressed at the same time.
const gzip = promisify(zlib.gzip);

export async function compressTo(src: string, dest: string, _options: CompressOptions = {}): Promise<void> {

  const buffer = await fs.promises.readFile(src);
  const resultBuffer = await gzip(buffer);
  await fs.promises.writeFile(dest, resultBuffer);

}
