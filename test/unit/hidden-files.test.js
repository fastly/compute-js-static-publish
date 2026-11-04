/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  countHiddenEntries,
  findAssetEntry,
  hiddenIndexKey,
  isHiddenIndexKey,
} from '../../build/cli/models/assets/index.js';
import { parseItemPatterns, testItemPatterns } from '../../build/cli/models/config/item-patterns.js';
import { normalizePublishContentConfig } from '../../build/cli/cli/util/config.js';

const entry = (hash) => ({ key: `sha256:${hash}`, size: 1, contentType: 'text/html', lastModifiedTime: 0, variants: [] });

describe('hidden index keys', () => {
  test('a hidden key is the prefix and the asset key', () => {
    assert.equal(hiddenIndexKey('/404.html'), 'hidden:/404.html');
    assert.equal(isHiddenIndexKey('hidden:/404.html'), true);
  });

  test('a file named hidden:x has a key that starts with a slash, so it is not hidden', () => {
    assert.equal(isHiddenIndexKey('/hidden:x'), false);
  });

  test('countHiddenEntries counts only the hidden keys', () => {
    assert.equal(countHiddenEntries({ '/a.html': entry('a'), 'hidden:/b.html': entry('b'), '/hidden:c': entry('c') }), 1);
    assert.equal(countHiddenEntries({}), 0);
  });
});

describe('findAssetEntry', () => {
  const map = {
    '/index.html': entry('a'),
    'hidden:/404.html': entry('b'),
    '/hidden:x': entry('c'),
  };

  test('finds a file that is not hidden', () => {
    assert.equal(findAssetEntry(map, '/index.html', false)?.key, 'sha256:a');
    assert.equal(findAssetEntry(map, '/index.html', true)?.key, 'sha256:a');
  });

  test('finds a hidden file only with includeHidden', () => {
    assert.equal(findAssetEntry(map, '/404.html', false), null);
    assert.equal(findAssetEntry(map, '/404.html', true)?.key, 'sha256:b');
  });

  test('never looks up a hidden key directly', () => {
    assert.equal(findAssetEntry(map, 'hidden:/404.html', false), null);
    assert.equal(findAssetEntry(map, 'hidden:/404.html', true), null);
  });

  test('finds a file named hidden:x by its real key', () => {
    assert.equal(findAssetEntry(map, '/hidden:x', false)?.key, 'sha256:c');
  });

  test('gives null for a missing file', () => {
    assert.equal(findAssetEntry(map, '/missing.html', true), null);
  });
});

describe('item patterns', () => {
  test('a directory, an exact path, and a regex', () => {
    const patterns = parseItemPatterns([ '/templates/', '/404.html', 're:/\\.tpl$/i' ]);
    assert.equal(testItemPatterns(patterns, '/templates/a.html'), true);
    assert.equal(testItemPatterns(patterns, '/templates/sub/b.html'), true);
    assert.equal(testItemPatterns(patterns, '/templates'), false);
    assert.equal(testItemPatterns(patterns, '/404.html'), true);
    assert.equal(testItemPatterns(patterns, '/404.html.bak'), false);
    assert.equal(testItemPatterns(patterns, '/x/page.TPL'), true);
    assert.equal(testItemPatterns(patterns, '/index.html'), false);
  });

  test('an item that cannot be parsed is skipped and reported', () => {
    const reported = [];
    const patterns = parseItemPatterns([ 're:nope', 're:/(/', '/a.html' ], (i, x) => reported.push([ i, x ]));
    assert.deepEqual(reported, [ [ 0, 're:nope' ], [ 1, 're:/(/' ] ]);
    assert.deepEqual(patterns, [ '/a.html' ]);
  });

  test('no items select nothing', () => {
    assert.equal(testItemPatterns(parseItemPatterns([]), '/a.html'), false);
  });
});

describe('hiddenItems in publish-content.config.js', () => {
  const normalize = (config) => {
    const errors = [];
    const result = normalizePublishContentConfig({ rootDir: './public', ...config }, errors);
    return { result, errors };
  };

  test('defaults to no items', () => {
    assert.deepEqual(normalize({}).result.hiddenItems, []);
    assert.deepEqual(normalize({ hiddenItems: null }).result.hiddenItems, []);
    assert.deepEqual(normalize({ hiddenItems: false }).result.hiddenItems, []);
  });

  test('accepts a string or an array of strings', () => {
    assert.deepEqual(normalize({ hiddenItems: '/404.html' }).result.hiddenItems, [ '/404.html' ]);
    assert.deepEqual(normalize({ hiddenItems: [ '/templates/', '/404.html' ] }).result.hiddenItems, [ '/templates/', '/404.html' ]);
  });

  test('changes a glob pattern into a regex', () => {
    const { result } = normalize({ hiddenItems: [ '/drafts/**/*.html' ] });
    assert.match(result.hiddenItems[0], /^re:\//);
    const patterns = parseItemPatterns(result.hiddenItems);
    assert.equal(testItemPatterns(patterns, '/drafts/a/b.html'), true);
    assert.equal(testItemPatterns(patterns, '/public/a.html'), false);
  });

  test('refuses other values', () => {
    const { result, errors } = normalize({ hiddenItems: [ '/a.html', 42 ] });
    assert.equal(result, null);
    assert.match(errors.join('\n'), /hiddenItems, if specified, must be/);
  });

  test('staticItems uses the same rules', () => {
    const { result } = normalize({ server: { staticItems: [ '/assets/', '/x/*.js' ] } });
    assert.equal(result.server.staticItems[0], '/assets/');
    assert.match(result.server.staticItems[1], /^re:\//);
  });
});
