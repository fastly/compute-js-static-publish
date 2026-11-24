/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Changes the docs for a prerelease (a beta or a release candidate), in the
// version commit of that prerelease:
//
//   node scripts/prerelease-docs.mjs <dist-tag> <git-ref>
//   node scripts/prerelease-docs.mjs beta beta/8.1
//
// - The npx commands of this package get the dist-tag: `npx <package>` and
//   `npx <package>@latest` become `npx <package>@beta`. Without it, npx runs
//   the latest stable version, which does not have the features of the
//   prerelease.
// - The links to this repository on GitHub point at <git-ref> in place of
//   main, so that they show the docs and the examples of the prerelease.
//
// It changes README.md, README.short.md, MIGRATING.md, and the README.md files
// in examples/. It does not change CHANGELOG.md, the roadmap, or the code.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE = '@fastly/compute-js-static-publish';
const REPO_URL = 'https://github.com/fastly/compute-js-static-publish';

// Lines that are about the dist-tag latest itself. They stay as they are.
const KEEP_LINES = [
  'never changes your app by itself',
];

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The text with the changes for the prerelease. Returns the changed text and
// the number of changes.
export function prereleaseDocs(text, { distTag, gitRef }) {
  const command = new RegExp(`(npx ${escapeRegExp(PACKAGE)})(@latest)?(?![@\\w/-])`, 'g');
  const install = new RegExp(`(npm install(?: -D| --save-dev)? ${escapeRegExp(PACKAGE)})@latest`, 'g');
  const link = new RegExp(`(${escapeRegExp(REPO_URL)}/(?:blob|tree))/main/`, 'g');
  let count = 0;
  const lines = text.split('\n').map((line) => {
    if (KEEP_LINES.some(keep => line.includes(keep))) {
      return line;
    }
    return line
      .replace(command, (_, npx) => { count++; return `${npx}@${distTag}`; })
      .replace(install, (_, npm) => { count++; return `${npm}@${distTag}`; })
      .replace(link, (_, base) => { count++; return `${base}/${gitRef}/`; });
  });
  return { text: lines.join('\n'), count };
}

// The files that the script changes, relative to the root of the repository.
export function prereleaseDocsFiles(rootDir) {
  const files = [ 'README.md', 'README.short.md', 'MIGRATING.md' ]
    .filter(file => fs.existsSync(path.resolve(rootDir, file)));
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.resolve(rootDir, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        walk(rel);
      } else if (entry.isFile() && entry.name === 'README.md') {
        files.push(rel);
      }
    }
  };
  if (fs.existsSync(path.resolve(rootDir, 'examples'))) {
    walk('examples');
  }
  return files;
}

function main(args) {
  const [ distTag, gitRef ] = args;
  if (distTag == null || gitRef == null || !/^[a-z][a-z0-9-]*$/.test(distTag) || distTag === 'latest') {
    console.error('Usage: node scripts/prerelease-docs.mjs <dist-tag> <git-ref>');
    console.error('  For example: node scripts/prerelease-docs.mjs beta beta/8.1');
    console.error('  The dist-tag is the first prerelease identifier of the version, and not latest.');
    process.exit(2);
  }
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let total = 0;
  for (const file of prereleaseDocsFiles(rootDir)) {
    const filePath = path.resolve(rootDir, file);
    const { text, count } = prereleaseDocs(fs.readFileSync(filePath, 'utf-8'), { distTag, gitRef });
    if (count > 0) {
      fs.writeFileSync(filePath, text);
      console.log(`${file}: ${count} change(s)`);
    }
    total += count;
  }
  console.log(`${total} change(s) for @${distTag} and ${gitRef}.`);
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}
