/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Checks that the scaffolder writes exactly the golden files of
// test/golden/ (the output of generateApp()). Needs network access for
// `npm install`. No credentials are necessary.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';

import { REPO_DIR, makeTempDir, removeDir, runCli } from './helpers.js';

const GOLDEN_DIR = path.resolve(REPO_DIR, 'test/golden');

// The same fixture as the golden cases.
function writeFixture(dir) {
  fs.mkdirSync(path.resolve(dir, 'public/static'), { recursive: true });
  fs.writeFileSync(path.resolve(dir, 'public/index.html'), '<h1>Home</h1>\n');
  fs.writeFileSync(path.resolve(dir, 'public/spa.html'), '<h1>SPA</h1>\n');
  fs.writeFileSync(path.resolve(dir, 'public/404.html'), '<h1>Not found</h1>\n');
  fs.writeFileSync(path.resolve(dir, 'public/static/app.js'), 'x\n');
  fs.writeFileSync(path.resolve(dir, 'package.json'), JSON.stringify({
    name: 'golden',
    private: true,
    devDependencies: { '@fastly/compute-js-static-publish': `file:${REPO_DIR}` },
  }));
}

// The files of a dir, without node_modules and package-lock.json. The
// dependency on this package, its version, and the date in generatedFrom are
// replaced with the placeholders of the golden files, and .gitignore is named
// _gitignore, as in test/golden/.
function readFiles(dir) {
  const files = {};
  const walk = (sub) => {
    for (const entry of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'package-lock.json') {
        continue;
      }
      const rel = path.posix.join(sub, entry.name);
      if (entry.isDirectory()) {
        walk(rel);
        continue;
      }
      let content = fs.readFileSync(path.join(dir, rel), 'utf-8');
      if (rel === 'package.json') {
        content = content.replace(/"file:[^"]*"/, '"<compute-js-static-publish>"');
      }
      if (rel === 'static-publish.rc.js') {
        content = content
          .replace(/staticPublishVersion: "[^"]*"/, 'staticPublishVersion: "<static-publish-version>"')
          .replace(/generatedAt: "\d{4}-\d{2}-\d{2}"/, 'generatedAt: "<generated-at>"');
      }
      files[rel.replace(/(^|\/)\.gitignore$/, '$1_gitignore')] = content;
    }
  };
  walk('');
  return files;
}

const cases = {
  'kv-basic': [ '--root-dir', './public', '--kv-store-name', 'site-content' ],
  'kv-full': [
    '--root-dir', './public', '--kv-store-name', 'site-content',
    '--spa', './public/spa.html', '--not-found-page', './public/404.html', '--static-dir', './public/static',
    '--service-id', 'SVC123', '--name', 'my-site', '--description', 'My site', '--author', 'me@example.com',
    '--publish-id', 'pub1', '--auto-index', 'index.htm', '--auto-ext', '.htm',
  ],
  'kv-default-collection': [ '--root-dir', './public', '--kv-store-name', 'site-content', '--default-collection-name', 'production' ],
};

describe('scaffold writes the golden files', () => {
  const dirs = [];
  after(() => {
    for (const dir of dirs) {
      removeDir(dir);
    }
  });

  for (const [ name, args ] of Object.entries(cases)) {
    test(name, () => {
      const dir = makeTempDir(`scaffold-golden-${name}`);
      dirs.push(dir);
      writeFixture(dir);
      runCli(args, { cwd: dir });
      const scaffolded = readFiles(path.resolve(dir, 'compute-js'));
      const golden = readFiles(path.resolve(GOLDEN_DIR, name));
      assert.deepEqual(Object.keys(scaffolded).sort(), Object.keys(golden).sort(), 'the list of files');
      for (const file of Object.keys(golden)) {
        assert.equal(scaffolded[file], golden[file], file);
      }
    });
  }

  test('a --default-collection-name that is not valid stops before anything is written', () => {
    const dir = makeTempDir('scaffold-golden-bad-name');
    dirs.push(dir);
    writeFixture(dir);
    const result = runCli([ '--root-dir', './public', '--kv-store-name', 'site-content', '--default-collection-name', 'Live' ], { cwd: dir, allowFailure: true });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /--default-collection-name is not a valid collection name/);
    assert.equal(fs.existsSync(path.resolve(dir, 'compute-js')), false);
  });
});
