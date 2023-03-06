import fs from 'fs';
import brotliCompress from 'brotli-compress';

export const key = 'br';

export async function compressTo(src: string, dest: string, isText: boolean): Promise<boolean> {

  const buffer = fs.readFileSync(src);
  const resultBuffer = await brotliCompress.compress(buffer);

  // Don't actually create the file if it would be bigger
  if (resultBuffer.length < buffer.length) {
    fs.writeFileSync(dest, resultBuffer);
    return true;
  } else {
    return false;
  }

}
