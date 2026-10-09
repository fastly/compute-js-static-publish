/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { after, before, test } from 'node:test';

import { algs } from '../../build/cli/cli/compression/index.js';

const TEXT = 'The quick brown fox jumps over the lazy dog.\n'.repeat(1000);

let tempDir;
let srcPath;
before(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cjsp-unit-'));
  srcPath = path.resolve(tempDir, 'src.txt');
  fs.writeFileSync(srcPath, TEXT);
});
after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('brotli output decompresses to the original', async () => {
  const dest = path.resolve(tempDir, 'out.br');
  await algs.br(srcPath, dest);
  assert.equal(zlib.brotliDecompressSync(fs.readFileSync(dest)).toString(), TEXT);
});

test('brotliQuality changes the output', async () => {
  const destDefault = path.resolve(tempDir, 'default.br');
  const destLow = path.resolve(tempDir, 'low.br');
  await algs.br(srcPath, destDefault);
  await algs.br(srcPath, destLow, { brotliQuality: 0 });
  assert.equal(zlib.brotliDecompressSync(fs.readFileSync(destLow)).toString(), TEXT);
  // Without brotliQuality, the output is the same as the zlib default (quality 11).
  assert.ok(fs.readFileSync(destDefault).equals(zlib.brotliCompressSync(Buffer.from(TEXT))));
  assert.ok(!fs.readFileSync(destLow).equals(fs.readFileSync(destDefault)));
});

test('gzip output decompresses to the original', async () => {
  const dest = path.resolve(tempDir, 'out.gz');
  await algs.gzip(srcPath, dest);
  assert.equal(zlib.gunzipSync(fs.readFileSync(dest)).toString(), TEXT);
});
