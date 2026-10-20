/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// publish-content with many files that have the same content: each variant is
// prepared one time, and each key is in the batch one time. Uses --local with
// a hand-written static-publish.rc.js. No network and no credentials are
// necessary.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { makeTempDir, removeDir, runCli } from './helpers.js';

const SAME_FILE_COUNT = 40;

function countMatches(output, regex) {
  return output.split('\n').filter(line => regex.test(line)).length;
}

describe('publish-content: files with the same content', () => {
  let dir;
  let output;

  before(() => {
    dir = makeTempDir('same-content');
    const publicDir = path.resolve(dir, 'public');
    fs.mkdirSync(publicDir, { recursive: true });
    // Text that compresses, but not too fast, so that the files overlap in time.
    const words = Array.from({ length: 20000 }, () => crypto.randomBytes(4).toString('hex'));
    const sameContent = words.join(' ');
    for (let i = 0; i < SAME_FILE_COUNT; i++) {
      fs.writeFileSync(path.resolve(publicDir, `page-${i}.html`), sameContent);
    }
    fs.writeFileSync(path.resolve(publicDir, 'other.html'), sameContent + ' other');

    fs.writeFileSync(path.resolve(dir, 'static-publish.rc.js'), `\
export default {
  kvStoreName: 'same-content',
  publishId: 'default',
  defaultCollectionName: 'live',
  staticPublisherWorkingDir: './static-publisher',
};
`);
    fs.writeFileSync(path.resolve(dir, 'publish-content.config.js'), `\
export default {
  rootDir: './public',
};
`);
    ({ output } = runCli([ 'publish-content', '--local', '--verbose' ], { cwd: dir }));
  });

  after(() => {
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('prepares each variant one time', () => {
    assert.equal(countMatches(output, /Copied file/), 2, output);
    assert.equal(countMatches(output, /Compressed file .*\[br\]/), 2, output);
    assert.equal(countMatches(output, /Compressed file .*\[gzip\]/), 2, output);
  });

  test('has each key one time in the batch', () => {
    // 2 originals, 2 br, and 2 gzip.
    assert.match(output, /\| 6 variant\(s\) to upload\./);
  });

  test('indexes all files', () => {
    const index = JSON.parse(fs.readFileSync(path.resolve(dir, 'static-publisher/storage-content/index_live.json'), 'utf-8'));
    assert.equal(Object.keys(index).length, SAME_FILE_COUNT + 1);
    const keys = new Set(Object.values(index).map(entry => entry.key));
    assert.equal(keys.size, 2);
    for (const entry of Object.values(index)) {
      assert.deepEqual([ ...entry.variants ].sort(), [ 'br', 'gzip' ]);
    }
  });
});
