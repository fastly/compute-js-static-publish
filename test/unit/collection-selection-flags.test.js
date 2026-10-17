/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { collectionSelectionFromFlags } from '../../build/cli/cli/util/collection-selection-flags.js';
import { normalizeStaticPublisherRc } from '../../build/cli/cli/util/config.js';

describe('collectionSelectionFromFlags', () => {
  test('no flags: no collectionSelection', () => {
    assert.deepEqual(collectionSelectionFromFlags({}), { collectionSelection: undefined, errors: [] });
  });

  test('each source, in order', () => {
    const { collectionSelection, errors } = collectionSelectionFromFlags({
      sources: [
        'host:{collection}.preview.example.com',
        'path:/_preview/{collection},sticky',
        'query:collection,sticky',
        'cookie:c,maxAge=600,activatePath=/on,resetPath=/off',
        'header:x-publisher-collection',
      ],
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(collectionSelection, {
      sources: [
        { type: 'host', pattern: '{collection}.preview.example.com' },
        { type: 'path', prefix: '/_preview/{collection}', sticky: 'cookie' },
        { type: 'query', param: 'collection', sticky: 'cookie' },
        { type: 'cookie', cookieName: 'c', maxAge: 600, activatePath: '/on', resetPath: '/off' },
        { type: 'header', name: 'x-publisher-collection' },
      ],
    });
  });

  test('cookie with no value uses the defaults', () => {
    assert.deepEqual(collectionSelectionFromFlags({ sources: [ 'cookie' ] }).collectionSelection, { sources: [ { type: 'cookie' } ] });
  });

  test('allow, on-missing, and noindex', () => {
    const { collectionSelection, errors } = collectionSelectionFromFlags({
      sources: [ 'cookie' ],
      allow: [ 'pr-*,staging', 'preview-*' ],
      onMissing: 'default',
      noindex: 'false',
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(collectionSelection.allow, [ 'pr-*', 'staging', 'preview-*' ]);
    assert.equal(collectionSelection.onMissing, 'default');
    assert.equal(collectionSelection.noindex, false);
  });

  const bad = [
    [ 'unknown source', { sources: [ 'dns:x' ] }, /unknown source 'dns'/ ],
    [ 'missing value', { sources: [ 'host' ] }, /give the pattern/ ],
    [ 'unknown option', { sources: [ 'query:c,always' ] }, /unknown option 'always'/ ],
    [ 'bad cookie option', { sources: [ 'cookie,maxAge=x' ] }, /invalid option 'maxAge=x'/ ],
    [ 'sticky without cookie', { sources: [ 'query:c,sticky' ] }, /needs a 'cookie' source/ ],
    [ 'bad on-missing', { sources: [ 'cookie' ], onMissing: 'x' }, /onMissing/ ],
    [ 'bad noindex', { sources: [ 'cookie' ], noindex: 'yes' }, /'true' or 'false'/ ],
    [ 'options without sources', { allow: [ 'pr-*' ] }, /need --collection-selection/ ],
    [ 'bad pattern', { sources: [ 'host:preview.example.com' ] }, /exactly one \{collection\}/ ],
  ];
  for (const [ name, flags, error ] of bad) {
    test(`refuses: ${name}`, () => {
      const result = collectionSelectionFromFlags(flags);
      assert.equal(result.collectionSelection, undefined);
      assert.match(result.errors.join('\n'), error);
    });
  }
});

describe('collectionSelection in static-publish.rc.js', () => {
  const rc = {
    storageMode: 'kv-store',
    kvStore: { kvStoreName: 'content' },
    publishId: 'default',
    defaultCollectionName: 'live',
    staticPublisherWorkingDir: './static-publisher',
  };

  test('keeps a valid collectionSelection', () => {
    const collectionSelection = { sources: [ { type: 'cookie' } ], allow: [ 'pr-*' ] };
    const errors = [];
    assert.deepEqual(normalizeStaticPublisherRc({ ...rc, collectionSelection }, errors).collectionSelection, collectionSelection);
    assert.deepEqual(errors, []);
  });

  test('no collectionSelection', () => {
    assert.equal(normalizeStaticPublisherRc(rc, []).collectionSelection, undefined);
  });

  test('a collectionSelection that is not valid is an error', () => {
    const errors = [];
    assert.equal(normalizeStaticPublisherRc({ ...rc, collectionSelection: { sources: [ { type: 'x' } ] } }, errors), null);
    assert.match(errors.join('\n'), /type must be one of/);
  });
});
