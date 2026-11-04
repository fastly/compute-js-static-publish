/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  isCollectionNameAllowed,
  maxCollectionNameLengthForHost,
  previewUrl,
  validateCollectionSelection,
} from '../../build/server/models/config/collection-selection.js';
import { resolveCollection, sameSiteLocation } from '../../build/server/server/collection-selection/index.js';

const req = (url, { headers = {}, method = 'GET' } = {}) => new Request(url, { headers, method });

describe('resolveCollection', () => {
  test('no config: the default collection', () => {
    assert.deepEqual(resolveCollection(req('https://example.com/'), undefined), { collectionName: null });
    assert.deepEqual(resolveCollection(req('https://example.com/'), { sources: [] }), { collectionName: null });
  });

  describe('host', () => {
    const config = { sources: [ { type: 'host', pattern: '{collection}.preview.example.com' } ] };

    test('selects the collection from the hostname', () => {
      assert.deepEqual(resolveCollection(req('https://pr-42.preview.example.com/a.html'), config),
        { collectionName: 'pr-42', matchedBy: 'host' });
    });

    test('ignores case', () => {
      assert.equal(resolveCollection(req('https://PR-42.Preview.Example.com/'), config).collectionName, 'pr-42');
    });

    test('the fixed text must match exactly', () => {
      assert.equal(resolveCollection(req('https://pr-42.preview.example.org/'), config).collectionName, null);
      assert.equal(resolveCollection(req('https://www.example.com/'), config).collectionName, null);
      assert.equal(resolveCollection(req('https://a.b.preview.example.com/'), config).collectionName, null);
    });

    test('fixed text in the label', () => {
      const branch = { sources: [ { type: 'host', pattern: 'branch-{collection}.preview.example.com' } ] };
      assert.equal(resolveCollection(req('https://branch-main.preview.example.com/'), branch).collectionName, 'main');
      assert.equal(resolveCollection(req('https://main.preview.example.com/'), branch).collectionName, null);
    });
  });

  describe('path', () => {
    const config = { sources: [ { type: 'path', prefix: '/_preview/{collection}' } ] };

    test('selects the collection and removes the prefix', () => {
      assert.deepEqual(resolveCollection(req('https://example.com/_preview/pr-42/assets/app.css'), config),
        { collectionName: 'pr-42', pathname: '/assets/app.css', matchedBy: 'path' });
    });

    test('the prefix alone gives /', () => {
      assert.equal(resolveCollection(req('https://example.com/_preview/pr-42'), config).pathname, '/');
      assert.equal(resolveCollection(req('https://example.com/_preview/pr-42/'), config).pathname, '/');
    });

    test('decodes the path', () => {
      assert.equal(resolveCollection(req('https://example.com/_preview/pr-42/a%20b.html'), config).pathname, '/a b.html');
    });

    test('does not match another path', () => {
      assert.equal(resolveCollection(req('https://example.com/_previewx/pr-42/'), config).collectionName, null);
      assert.equal(resolveCollection(req('https://example.com/a/_preview/pr-42/'), config).collectionName, null);
      assert.equal(resolveCollection(req('https://example.com/'), config).pathname, undefined);
    });

    test('fixed text after the placeholder', () => {
      const pr = { sources: [ { type: 'path', prefix: '/_preview/pr-{collection}' } ] };
      assert.deepEqual(resolveCollection(req('https://example.com/_preview/pr-42/x'), pr),
        { collectionName: '42', pathname: '/x', matchedBy: 'path' });
    });
  });

  describe('query', () => {
    const config = { sources: [ { type: 'query', param: 'collection' } ] };

    test('selects the collection from the parameter', () => {
      assert.deepEqual(resolveCollection(req('https://example.com/?collection=staging'), config),
        { collectionName: 'staging', matchedBy: 'query' });
    });

    test('no parameter: the default collection', () => {
      assert.equal(resolveCollection(req('https://example.com/'), config).collectionName, null);
    });
  });

  describe('cookie', () => {
    const config = { sources: [ { type: 'cookie' } ] };

    test('selects the collection from the cookie', () => {
      assert.deepEqual(resolveCollection(req('https://example.com/', { headers: { cookie: 'a=b; publisher-collection=pr-1' } }), config),
        { collectionName: 'pr-1', matchedBy: 'cookie' });
    });

    test('a custom cookie name', () => {
      const custom = { sources: [ { type: 'cookie', cookieName: 'c' } ] };
      assert.equal(resolveCollection(req('https://example.com/', { headers: { cookie: 'c=pr-2' } }), custom).collectionName, 'pr-2');
    });

    test('activate sets the cookie and redirects', () => {
      const result = resolveCollection(req('https://example.com/activate?collection=pr-1&redirectTo=/docs/'),
        { sources: [ { type: 'cookie', maxAge: 600 } ] });
      assert.equal(result.collectionName, 'pr-1');
      assert.equal(result.response.status, 302);
      assert.equal(result.response.headers.get('location'), '/docs/');
      assert.equal(result.response.headers.get('cache-control'), 'no-store');
      assert.equal(result.response.headers.get('set-cookie'), 'publisher-collection=pr-1; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax');
    });

    test('activate redirects only to a path on this site', () => {
      for (const redirectTo of [ 'https://evil.example/', '//evil.example/', '/\\evil.example/', 'evil', '/a\r\nX: y' ]) {
        const url = new URL('https://example.com/activate?collection=pr-1');
        url.searchParams.set('redirectTo', redirectTo);
        const result = resolveCollection(req(url.href), config);
        assert.equal(result.response.headers.get('location'), '/', redirectTo);
      }
    });

    test('activate refuses a missing, invalid, or not allowed name', () => {
      assert.equal(resolveCollection(req('https://example.com/activate'), config).response.status, 400);
      assert.equal(resolveCollection(req('https://example.com/activate?collection=Bad_Name'), config).response.status, 400);
      const allow = { sources: [ { type: 'cookie' } ], allow: [ 'pr-*' ] };
      const result = resolveCollection(req('https://example.com/activate?collection=staging'), allow);
      assert.equal(result.response.status, 403);
      assert.equal(result.response.headers.get('set-cookie'), null);
    });

    test('reset removes the cookie and redirects', () => {
      const result = resolveCollection(req('http://example.com/reset'), config);
      assert.equal(result.collectionName, null);
      assert.equal(result.response.status, 302);
      assert.equal(result.response.headers.get('location'), '/');
      assert.equal(result.response.headers.get('set-cookie'), 'publisher-collection=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
    });

    test('custom activate and reset paths', () => {
      const custom = { sources: [ { type: 'cookie', activatePath: '/_on', resetPath: '/_off' } ] };
      assert.equal(resolveCollection(req('https://example.com/_on?collection=pr-1'), custom).response.status, 302);
      assert.equal(resolveCollection(req('https://example.com/_off'), custom).response.status, 302);
      assert.equal(resolveCollection(req('https://example.com/activate?collection=pr-1'), custom).response, undefined);
    });

    test('a method other than GET and HEAD does not activate', () => {
      assert.equal(resolveCollection(req('https://example.com/activate?collection=pr-1', { method: 'POST' }), config).response, undefined);
    });
  });

  describe('header', () => {
    const config = { sources: [ { type: 'header', name: 'x-publisher-collection' } ] };

    test('selects the collection from the header', () => {
      assert.deepEqual(resolveCollection(req('https://example.com/', { headers: { 'x-publisher-collection': 'pr-9' } }), config),
        { collectionName: 'pr-9', matchedBy: 'header' });
    });
  });

  describe('order of sources', () => {
    const config = {
      sources: [
        { type: 'header', name: 'x-c' },
        { type: 'query', param: 'c' },
        { type: 'cookie' },
      ],
    };

    test('the first source that gives a collection wins', () => {
      const headers = { 'x-c': 'from-header', cookie: 'publisher-collection=from-cookie' };
      assert.equal(resolveCollection(req('https://example.com/?c=from-query', { headers }), config).collectionName, 'from-header');
      assert.equal(resolveCollection(req('https://example.com/?c=from-query', { headers: { cookie: headers.cookie } }), config).collectionName, 'from-query');
      assert.equal(resolveCollection(req('https://example.com/', { headers: { cookie: headers.cookie } }), config).collectionName, 'from-cookie');
    });

    test('a source with a name that is not valid is skipped', () => {
      const headers = { 'x-c': 'Bad_Name', cookie: 'publisher-collection=from-cookie' };
      assert.equal(resolveCollection(req('https://example.com/', { headers }), config).collectionName, 'from-cookie');
    });
  });

  describe('sticky', () => {
    test('path: sets the cookie and redirects to the path without the prefix', () => {
      const config = { sources: [ { type: 'path', prefix: '/_preview/{collection}', sticky: 'cookie' }, { type: 'cookie' } ] };
      const result = resolveCollection(req('https://example.com/_preview/pr-42/docs/a.html?x=1'), config);
      assert.equal(result.collectionName, 'pr-42');
      assert.equal(result.pathname, '/docs/a.html');
      assert.equal(result.response.status, 302);
      assert.equal(result.response.headers.get('location'), '/docs/a.html?x=1');
      assert.match(result.response.headers.get('set-cookie'), /^publisher-collection=pr-42; /);
    });

    test('path: a path that starts with // redirects to /', () => {
      const config = { sources: [ { type: 'path', prefix: '/_preview/{collection}', sticky: 'cookie' }, { type: 'cookie' } ] };
      const result = resolveCollection(req('https://example.com/_preview/pr-42//evil.example/'), config);
      assert.equal(result.response.headers.get('location'), '/');
    });

    test('query: sets the cookie and redirects to the URL without the parameter', () => {
      const config = { sources: [ { type: 'query', param: 'collection', sticky: 'cookie' }, { type: 'cookie', cookieName: 'c', maxAge: 60 } ] };
      const result = resolveCollection(req('https://example.com/docs/?a=1&collection=pr-42&b=2'), config);
      assert.equal(result.collectionName, 'pr-42');
      assert.equal(result.response.headers.get('location'), '/docs/?a=1&b=2');
      assert.equal(result.response.headers.get('set-cookie'), 'c=pr-42; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Lax');

      const only = resolveCollection(req('https://example.com/docs/?collection=pr-42'), config);
      assert.equal(only.response.headers.get('location'), '/docs/');
    });

    test('is an error without a cookie source', () => {
      const config = { sources: [ { type: 'query', param: 'collection', sticky: 'cookie' } ] };
      assert.throws(() => resolveCollection(req('https://example.com/'), config), /needs a 'cookie' source/);
    });
  });

  describe('allow', () => {
    const config = { sources: [ { type: 'query', param: 'c' } ], allow: [ 'pr-*', 'staging' ] };

    test('selects only the allowed collections', () => {
      assert.equal(resolveCollection(req('https://example.com/?c=pr-1'), config).collectionName, 'pr-1');
      assert.equal(resolveCollection(req('https://example.com/?c=staging'), config).collectionName, 'staging');
      assert.equal(resolveCollection(req('https://example.com/?c=staging-2'), config).collectionName, null);
      assert.equal(resolveCollection(req('https://example.com/?c=feature'), config).collectionName, null);
    });
  });

  test('the name rule applies to each source', () => {
    const config = { sources: [ { type: 'query', param: 'c' } ] };
    for (const name of [ 'Live', 'feature_x', 'a.b', '-a', 'a-', 'x'.repeat(64), '' ]) {
      assert.equal(resolveCollection(req(`https://example.com/?c=${encodeURIComponent(name)}`), config).collectionName, null, name);
    }
  });

  test('a config that is not valid throws', () => {
    assert.throws(() => resolveCollection(req('https://example.com/'), { sources: [ { type: 'nope' } ] }), TypeError);
  });
});

describe('sameSiteLocation', () => {
  test('keeps a path on this site', () => {
    assert.equal(sameSiteLocation('/a/b?c=d'), '/a/b?c=d');
    assert.equal(sameSiteLocation('/'), '/');
  });

  test('changes anything else to /', () => {
    for (const value of [ '', 'a', '//evil', '/\\evil', 'https://evil/', '/a\nb', '/a\u0000' ]) {
      assert.equal(sameSiteLocation(value), '/', JSON.stringify(value));
    }
  });
});

describe('isCollectionNameAllowed', () => {
  test('any valid name without allow', () => {
    assert.equal(isCollectionNameAllowed('pr-1', undefined), true);
    assert.equal(isCollectionNameAllowed('Bad', undefined), false);
  });

  test('globs', () => {
    assert.equal(isCollectionNameAllowed('pr-1', [ 'pr-*' ]), true);
    assert.equal(isCollectionNameAllowed('x-pr-1', [ 'pr-*' ]), false);
    assert.equal(isCollectionNameAllowed('a-preview', [ '*-preview' ]), true);
    assert.equal(isCollectionNameAllowed('anything', [ '*' ]), true);
  });
});

describe('validateCollectionSelection', () => {
  const valid = {
    sources: [
      { type: 'host', pattern: '{collection}.preview.example.com' },
      { type: 'path', prefix: '/_preview/{collection}', sticky: 'cookie' },
      { type: 'query', param: 'collection', sticky: 'cookie' },
      { type: 'cookie', cookieName: 'publisher-collection', activatePath: '/activate', resetPath: '/reset', maxAge: 604800 },
      { type: 'header', name: 'x-publisher-collection' },
    ],
    allow: [ 'pr-*', 'staging' ],
    onMissing: 'not-found',
    noindex: true,
  };

  test('accepts the full example', () => {
    assert.deepEqual(validateCollectionSelection(valid), []);
  });

  const cases = [
    [ 'not an object', null, /must be an object/ ],
    [ 'no sources', {}, /sources must be an array/ ],
    [ 'unknown type', { sources: [ { type: 'x' } ] }, /type must be one of/ ],
    [ 'host without placeholder', { sources: [ { type: 'host', pattern: 'preview.example.com' } ] }, /exactly one \{collection\}/ ],
    [ 'host with two placeholders', { sources: [ { type: 'host', pattern: '{collection}.{collection}.com' } ] }, /exactly one/ ],
    [ 'host with a slash', { sources: [ { type: 'host', pattern: '{collection}.example.com/x' } ] }, /must be a hostname/ ],
    [ 'host label too long', { sources: [ { type: 'host', pattern: `${'a'.repeat(63)}{collection}.example.com` } ] }, /no room/ ],
    [ 'path without /', { sources: [ { type: 'path', prefix: '_preview/{collection}' } ] }, /must start with '\/'/ ],
    [ 'path that ends with /', { sources: [ { type: 'path', prefix: '/_preview/{collection}/' } ] }, /must not end with/ ],
    [ 'query without param', { sources: [ { type: 'query' } ] }, /param must be/ ],
    [ 'bad cookie name', { sources: [ { type: 'cookie', cookieName: 'a b' } ] }, /cookieName/ ],
    [ 'bad activate path', { sources: [ { type: 'cookie', activatePath: 'on' } ] }, /activatePath/ ],
    [ 'bad maxAge', { sources: [ { type: 'cookie', maxAge: -1 } ] }, /maxAge/ ],
    [ 'two cookie sources', { sources: [ { type: 'cookie' }, { type: 'cookie' } ] }, /at most one 'cookie'/ ],
    [ 'bad header name', { sources: [ { type: 'header', name: 'a b' } ] }, /valid header name/ ],
    [ 'sticky on a header', { sources: [ { type: 'header', name: 'x', sticky: 'cookie' }, { type: 'cookie' } ] }, /only for the 'path' and 'query'/ ],
    [ 'sticky not cookie', { sources: [ { type: 'query', param: 'c', sticky: 'yes' }, { type: 'cookie' } ] }, /must be 'cookie'/ ],
    [ 'sticky without cookie source', { sources: [ { type: 'query', param: 'c', sticky: 'cookie' } ] }, /needs a 'cookie' source/ ],
    [ 'bad allow', { sources: [], allow: [ 'Pr-*' ] }, /allow must be/ ],
    [ 'bad onMissing', { sources: [], onMissing: 'x' }, /onMissing/ ],
    [ 'bad noindex', { sources: [], noindex: 'yes' }, /noindex/ ],
  ];
  for (const [ name, config, error ] of cases) {
    test(`refuses: ${name}`, () => {
      assert.match(validateCollectionSelection(config).join('\n'), error);
    });
  }
});

describe('previewUrl', () => {
  const base = 'https://example.edgecompute.app';

  test('host', () => {
    const config = { sources: [ { type: 'host', pattern: '{collection}.preview.example.com' } ] };
    assert.equal(previewUrl('pr-42', base, config), 'https://pr-42.preview.example.com/');
  });

  test('path', () => {
    const config = { sources: [ { type: 'path', prefix: '/_preview/{collection}' } ] };
    assert.equal(previewUrl('pr-42', base, config), 'https://example.edgecompute.app/_preview/pr-42/');
  });

  test('query', () => {
    const config = { sources: [ { type: 'query', param: 'collection' } ] };
    assert.equal(previewUrl('pr-42', base, config), 'https://example.edgecompute.app/?collection=pr-42');
  });

  test('cookie', () => {
    const config = { sources: [ { type: 'cookie' } ] };
    assert.equal(previewUrl('pr-42', base, config), 'https://example.edgecompute.app/activate?collection=pr-42&redirectTo=%2F');
  });

  test('header alone: no URL', () => {
    assert.equal(previewUrl('pr-42', base, { sources: [ { type: 'header', name: 'x-c' } ] }), null);
  });

  test('the first source that can make a URL is used', () => {
    const config = { sources: [ { type: 'header', name: 'x-c' }, { type: 'query', param: 'c' }, { type: 'cookie' } ] };
    assert.equal(previewUrl('pr-42', base, config), 'https://example.edgecompute.app/?c=pr-42');
  });

  test('a name that is too long for the host label is an error', () => {
    const config = { sources: [ { type: 'host', pattern: 'branch-{collection}.preview.example.com' } ] };
    assert.equal(maxCollectionNameLengthForHost('branch-{collection}.preview.example.com'), 56);
    assert.equal(previewUrl('a'.repeat(56), base, config), `https://branch-${'a'.repeat(56)}.preview.example.com/`);
    assert.throws(() => previewUrl('a'.repeat(57), base, config), /at most 56/);
  });

  test('a name that is not valid or not allowed is an error', () => {
    const config = { sources: [ { type: 'query', param: 'c' } ], allow: [ 'pr-*' ] };
    assert.throws(() => previewUrl('Bad', base, config), /not a valid collection name/);
    assert.throws(() => previewUrl('staging', base, config), /not in collectionSelection.allow/);
  });

  test('previewUrl and resolveCollection agree', () => {
    const configs = [
      { sources: [ { type: 'host', pattern: 'b-{collection}.preview.example.com' } ] },
      { sources: [ { type: 'path', prefix: '/_p/{collection}' } ] },
      { sources: [ { type: 'query', param: 'c' } ] },
    ];
    for (const config of configs) {
      const url = previewUrl('pr-7', base, config);
      assert.equal(resolveCollection(req(url), config).collectionName, 'pr-7', url);
    }
  });
});
