import fs from "fs";
import path from "path";

export interface FilenameTest {
  test(name: string): boolean;
}

export type GetFilesOpts = {
  publicDirRoot: string,
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
      getFilesWorker(results, fullpath, opts);
    } else {
      results.push(fullpath);
    }
  }
}
