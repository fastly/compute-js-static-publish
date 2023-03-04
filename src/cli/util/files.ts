import fs from "fs";
import path from "path";

export interface FilenameTest {
  test(name: string): boolean;
}

export type GetFilesOpts = {
  excludeDirs: FilenameTest[],
  excludeDotFiles: boolean,
  includeWellKnown: boolean,
};

export function getFiles(dir: string, opts: GetFilesOpts) {
  const results: string[] = [];
  getFilesWorker(results, dir, opts);
  return results;
}

function getFilesWorker(results: string[], dir: string, opts: GetFilesOpts) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const { name } = entry;

    const {
      excludeDirs,
      excludeDotFiles,
      includeWellKnown,
    } = opts;

    if (excludeDirs.some(excludeDir => excludeDir.test(name))) {
      continue;
    }

    if (excludeDotFiles && name.startsWith('.')) {
      if (includeWellKnown && name === '.well-known') {
        // ok
      } else {
        continue;
      }
    }

    const fullpath = path.resolve(dir, name);
    if (entry.isDirectory()) {
      getFilesWorker(results, fullpath, opts);
    } else {
      results.push(fullpath);
    }
  }
}
