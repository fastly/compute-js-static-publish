import crypto from 'crypto';
import fs from 'fs';

export function calculateFileSizeAndHash(filename: string) {

  const fileBuffer = fs.readFileSync(filename);
  const size = fileBuffer.length;
  const hash = crypto.createHash('sha256');

  hash.update(fileBuffer);

  return { size, hash: hash.digest('hex') };

}
