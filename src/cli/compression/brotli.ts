/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import fs from 'node:fs';
import zlib from 'node:zlib';

export const key = 'br';

export async function compressTo(src: string, dest: string): Promise<void> {

  const buffer = fs.readFileSync(src);
  const resultBuffer = zlib.brotliCompressSync(buffer);
  fs.writeFileSync(dest, resultBuffer);

}
