/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface FilenameTest {
  test(name: string): boolean;
}

export type EnumerateFilesOpts = {
  publicDirRoot: string,
  excludeDirs: FilenameTest[],
  excludeDotFiles: boolean,
  includeWellKnown: boolean,
};

export function enumerateFiles(opts: EnumerateFilesOpts) {
  const results: string[] = [];
  enumerateFilesWorker(results, opts.publicDirRoot, opts);
  return results;
}

function enumerateFilesWorker(results: string[], dir: string, opts: EnumerateFilesOpts) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const { name } = entry;

    const {
      publicDirRoot,
      excludeDirs,
      excludeDotFiles,
      includeWellKnown,
    } = opts;

    const fullpath = path.resolve(dir, name);
    const relative = '/' + path.relative(publicDirRoot, fullpath);
    if (excludeDirs.some(excludeDir => excludeDir.test(relative))) {
      continue;
    }

    if (excludeDotFiles && name.startsWith('.')) {
      if (includeWellKnown && name === '.well-known') {
        // ok
      } else {
        continue;
      }
    }

    if (entry.isDirectory()) {
      enumerateFilesWorker(results, fullpath, opts);
    } else if (entry.isSymbolicLink()) {
      try {
        const stats = fs.statSync(fullpath);
        if (stats.isDirectory()) {
          enumerateFilesWorker(results, fullpath, opts);
        } else if (stats.isFile()) {
          results.push(fullpath);
        }
      } catch (err) {
        // Skip broken symlinks
        continue;
      }
    } else {
      results.push(fullpath);
    }
  }
}

export function getFileSize(filePath: string) {
  const stats = fs.statSync(filePath);
  return stats.size;
}

export function directoryExists(dirPath: string) {
  try {
    const stats = fs.statSync(dirPath);
    return stats.isDirectory();
  } catch (err) {
    if ((err as any).code === 'ENOENT') {
      return false; // Path doesn't exist
    }
    throw err; // Other errors, rethrow
  }
}

export async function calculateFileSizeAndHash(filePath: string) {

  const stream = fs.createReadStream(filePath);

  // Use createHash, rather than subtle, since it supports streaming.
  const hash = crypto.createHash('sha256');
  let size = 0;

  return new Promise<{ size: number, hash: string }>((resolve, reject) => {
    stream.on('data', chunk => {
      hash.update(chunk);
      size += chunk.length;
    });

    stream.on('end', () => {
      resolve({
        size,
        hash: hash.digest('hex'),
      });
    });

    stream.on('error', reject);
  });

}

export function rootRelative(itemPath: string) {
  return dotRelative(null, itemPath);
}

export function dotRelative(from: string | null, to: string) {
  const relPath = path.relative(from ?? path.resolve(), to); 
  return relPath.startsWith('..') ? relPath : './' + relPath;
}

