/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import fs from 'node:fs';
import { type ContentCompressionTypes } from '../../models/compression/index.js';
import { algs } from '../compression/index.js';
import { rootRelative } from './files.js';

export type Variants = 'original' | ContentCompressionTypes;

export async function ensureVariantFileExists(
  variantFilePath: string,
  variant: Variants,
  file: string,
) {

  // Compress/prepare the asset if it doesn't already exist
  // We disregard chunked copies of the file and only check for the existence
  // of the main copy of the file at this point.
  if (!fs.existsSync(variantFilePath)) {
    if (variant === 'original') {

      fs.cpSync(file, variantFilePath);
      console.log(` 📄→📄 Copied file '${rootRelative(file)}' to '${rootRelative(variantFilePath)}'.`);

    } else {

      const compressTo = algs[variant];
      await compressTo(file, variantFilePath);
      console.log(` 📄→🗄️ Compressed file '${rootRelative(file)}' to '${rootRelative(variantFilePath)}' [${variant}].`);

    }

    // However, if we did just create the file,
    // we delete any chunked copies that may exist as they can be out of date.
    // (They will be recreated in a later step)
    fs.rmSync(`${variantFilePath}_chunks`, { recursive: true, force: true });
  }
}
