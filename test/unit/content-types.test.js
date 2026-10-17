/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mergeContentTypes, testFileContentType } from '../../build/cli/cli/util/content-types.js';
import { mockConsoleLog } from './mock-console.js';

test('default content types', () => {
  for (const [ file, contentType, text ] of [
    [ '/index.html', 'text/html', true ],
    [ '/style.css', 'text/css', true ],
    [ '/image.tif', 'image/tiff', false ],
    [ '/image.tiff', 'image/tiff', false ],
    [ '/image.avif', 'image/avif', false ],
    [ '/image.jxl', 'image/jxl', false ],
    [ '/module.wasm', 'application/wasm', false ],
  ]) {
    const result = testFileContentType(null, file);
    assert.equal(result?.contentType, contentType, file);
    assert.equal(result?.text, text, file);
  }
});

test('text files and some binary files are compressed', () => {
  assert.equal(testFileContentType(null, '/a.html').precompressAsset, true);
  assert.equal(testFileContentType(null, '/a.bmp').precompressAsset, true);
  assert.equal(testFileContentType(null, '/a.png').precompressAsset, false);
});

test('gives null for an unknown extension', () => {
  assert.equal(testFileContentType(null, '/file.unknown'), null);
});

test('custom content types come before the defaults', (t) => {
  const messages = mockConsoleLog(t);
  const contentTypes = mergeContentTypes([
    { test: /\.html$/, contentType: 'application/xhtml+xml', text: true },
    { test: (key) => key.endsWith('.custom'), contentType: 'application/x-custom' },
  ]);
  assert.equal(testFileContentType(contentTypes, '/a.html').contentType, 'application/xhtml+xml');
  assert.equal(testFileContentType(contentTypes, '/a.custom').contentType, 'application/x-custom');
  assert.equal(testFileContentType(contentTypes, '/a.css').contentType, 'text/css');
  assert.deepEqual(messages(), [
    '✔️ Applying 2 custom content type(s).',
  ]);
});

test('ignores custom content types that are not valid', (t) => {
  const messages = mockConsoleLog(t);
  const contentTypes = mergeContentTypes([
    { test: 'not a test', contentType: 'text/plain' },
    { test: /\.a$/, contentType: 'no-slash' },
    { test: /\.b$/, contentType: 'text/plain', text: 'yes' },
  ]);
  assert.equal(testFileContentType(contentTypes, '/file.a'), null);
  assert.equal(testFileContentType(contentTypes, '/file.b'), null);
  assert.deepEqual(messages(), [
    `⚠️ Ignoring contentTypes[0]: 'test' must be a function or regular expression.`,
    `⚠️ Ignoring contentTypes[1]: 'contentType' must be a string representing a MIME type.`,
    `⚠️ Ignoring contentTypes[2]: optional 'text' must be a boolean value.`,
    '✔️ Applying 0 custom content type(s).',
  ]);
});
