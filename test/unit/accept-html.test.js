/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { requestAcceptsTextHtml } from '../../build/server/server/publisher-server/accept-html.js';

function acceptsHtml(accept) {
  const headers = accept != null ? { 'accept': accept } : {};
  return requestAcceptsTextHtml(new Request('https://example.com/', { headers }));
}

describe('requestAcceptsTextHtml', () => {
  test('a missing or empty header accepts HTML', () => {
    assert.equal(acceptsHtml(null), true);
    assert.equal(acceptsHtml(''), true);
    assert.equal(acceptsHtml('  '), true);
  });

  test('text/html, text/*, and */* accept HTML', () => {
    assert.equal(acceptsHtml('text/html'), true);
    assert.equal(acceptsHtml('text/*'), true);
    assert.equal(acceptsHtml('*/*'), true);
    assert.equal(acceptsHtml('*'), true);
    assert.equal(acceptsHtml('application/json, */*;q=0.1'), true);
  });

  test('a browser\'s Accept header accepts HTML', () => {
    assert.equal(acceptsHtml('text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'), true);
  });

  test('other media types do not accept HTML', () => {
    assert.equal(acceptsHtml('application/json'), false);
    assert.equal(acceptsHtml('text/plain'), false);
    assert.equal(acceptsHtml('image/*'), false);
    assert.equal(acceptsHtml('image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8'), false);
  });

  test('a q-value of 0 does not accept HTML', () => {
    assert.equal(acceptsHtml('text/html;q=0'), false);
    assert.equal(acceptsHtml('text/html; q=0.000'), false);
    assert.equal(acceptsHtml('*/*;q=0'), false);
  });

  test('the most specific media range gives the q-value', () => {
    assert.equal(acceptsHtml('text/html;q=0, */*'), false);
    assert.equal(acceptsHtml('text/*;q=0, */*'), false);
    assert.equal(acceptsHtml('text/html;q=0.5, text/*;q=0'), true);
    assert.equal(acceptsHtml('*/*;q=0, text/html;q=0.1'), true);
  });

  test('media ranges are not case-sensitive, and parameters other than q are ignored', () => {
    assert.equal(acceptsHtml('Text/HTML'), true);
    assert.equal(acceptsHtml('text/html;charset=utf-8'), true);
    assert.equal(acceptsHtml('text/html;level=1;Q=0'), false);
  });

  test('a q-value that is not a number is 1', () => {
    assert.equal(acceptsHtml('text/html;q=abc'), true);
  });
});
