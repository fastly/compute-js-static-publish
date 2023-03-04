import crypto from 'crypto';
import fs from 'fs';

export function calculateFileHash(filename: string) {

  const fileBuffer = fs.readFileSync(filename);
  const hash = crypto.createHash('sha256');

  hash.update(fileBuffer);

  return hash.digest('hex');

}
