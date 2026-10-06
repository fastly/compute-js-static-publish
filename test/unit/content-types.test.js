/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mergeContentTypes, testFileContentType } from '../../build/cli/cli/util/content-types.js';

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

test('custom content types come before the defaults', () => {
  const contentTypes = mergeContentTypes([
    { test: /\.html$/, contentType: 'application/xhtml+xml', text: true },
    { test: (key) => key.endsWith('.custom'), contentType: 'application/x-custom' },
  ]);
  assert.equal(testFileContentType(contentTypes, '/a.html').contentType, 'application/xhtml+xml');
  assert.equal(testFileContentType(contentTypes, '/a.custom').contentType, 'application/x-custom');
  assert.equal(testFileContentType(contentTypes, '/a.css').contentType, 'text/css');
});

test('ignores custom content types that are not valid', () => {
  const contentTypes = mergeContentTypes([
    { test: 'not a test', contentType: 'text/plain' },
    { test: /\.a$/, contentType: 'no-slash' },
    { test: /\.b$/, contentType: 'text/plain', text: 'yes' },
  ]);
  assert.equal(testFileContentType(contentTypes, '/file.a'), null);
  assert.equal(testFileContentType(contentTypes, '/file.b'), null);
});
