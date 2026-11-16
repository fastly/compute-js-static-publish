/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import { prereleaseDocs, prereleaseDocsFiles } from '../../scripts/prerelease-docs.mjs';

const options = { distTag: 'beta', gitRef: 'beta/8.1' };
const change = (text) => prereleaseDocs(text, options);

describe('prereleaseDocs()', () => {
  test('npx commands get the dist-tag', () => {
    assert.deepEqual(change('npx @fastly/compute-js-static-publish --root-dir=./public'),
      { text: 'npx @fastly/compute-js-static-publish@beta --root-dir=./public', count: 1 });
    assert.equal(change('npx @fastly/compute-js-static-publish@latest \\').text, 'npx @fastly/compute-js-static-publish@beta \\');
    assert.equal(change('`npx @fastly/compute-js-static-publish`').text, '`npx @fastly/compute-js-static-publish@beta`');
    assert.equal(change('npx @fastly/compute-js-static-publish\n').text, 'npx @fastly/compute-js-static-publish@beta\n');
  });

  test('npm install of @latest gets the dist-tag', () => {
    assert.equal(change('   npm install @fastly/compute-js-static-publish@latest').text, '   npm install @fastly/compute-js-static-publish@beta');
  });

  test('links to main point at the git ref', () => {
    assert.equal(change('(https://github.com/fastly/compute-js-static-publish/tree/main/examples/hono)').text,
      '(https://github.com/fastly/compute-js-static-publish/tree/beta/8.1/examples/hono)');
    assert.equal(change('(https://github.com/fastly/compute-js-static-publish/blob/main/README.md#x)').text,
      '(https://github.com/fastly/compute-js-static-publish/blob/beta/8.1/README.md#x)');
  });

  test('other text does not change', () => {
    for (const text of [
      'npx @fastly/compute-js-static-publish@7 --root-dir=./public',
      'npx @fastly/compute-js-static-publish@beta dev',
      'npm install @fastly/compute-js-static-publish',
      '"@fastly/compute-js-static-publish": "^8.1.0"',
      'import { defineExtension } from \'@fastly/compute-js-static-publish/hono\';',
      'https://github.com/fastly/compute-js-static-publish/pull/158',
      'Thus a new release of this package never changes your app by itself, also with `npx @fastly/compute-js-static-publish@latest`.',
    ]) {
      assert.deepEqual(change(text), { text, count: 0 }, text);
    }
  });

  test('a second run changes nothing', () => {
    const once = change('npx @fastly/compute-js-static-publish dev\nhttps://github.com/fastly/compute-js-static-publish/blob/main/README.md').text;
    assert.deepEqual(change(once), { text: once, count: 0 });
  });
});

describe('prereleaseDocsFiles()', () => {
  test('the READMEs, MIGRATING.md, and the READMEs in examples/', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cjsp-prerelease-docs-'));
    for (const file of [ 'README.md', 'README.short.md', 'MIGRATING.md', 'CHANGELOG.md',
      'examples/hono/grip/README.md', 'examples/hono/grip/hono-extensions/grip.ts',
      'examples/hono/grip/hono-extensions/node_modules/x/README.md' ]) {
      fs.mkdirSync(path.dirname(path.resolve(dir, file)), { recursive: true });
      fs.writeFileSync(path.resolve(dir, file), '');
    }
    try {
      assert.deepEqual(prereleaseDocsFiles(dir).sort(), [ 'MIGRATING.md', 'README.md', 'README.short.md', 'examples/hono/grip/README.md' ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
