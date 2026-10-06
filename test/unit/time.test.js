/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calcExpirationTime, isExpired } from '../../build/cli/models/time/index.js';

test('--expires-in adds a duration to the current time', (t) => {
  t.mock.method(console, 'log', () => {});
  const now = Math.floor(Date.now() / 1000);
  const result = calcExpirationTime({ expiresIn: '1d2h30m' });
  const expected = now + 86400 + 7200 + 1800;
  assert.ok(Math.abs(result - expected) <= 1, `${result} is close to ${expected}`);
});

test('--expires-at gives the time in seconds', (t) => {
  t.mock.method(console, 'log', () => {});
  assert.equal(calcExpirationTime({ expiresAt: '2030-01-01T00:00:00Z' }), 1893456000);
});

test('--expires-never gives null, and no option gives undefined', () => {
  assert.equal(calcExpirationTime({ expiresNever: true }), null);
  assert.equal(calcExpirationTime({}), undefined);
});

test('rejects values that are not valid', () => {
  assert.throws(() => calcExpirationTime({ expiresIn: '1x' }), /Invalid duration format/);
  assert.throws(() => calcExpirationTime({ expiresAt: 'later' }), /Invalid expiresAt value/);
  assert.throws(() => calcExpirationTime({ expiresIn: '1d', expiresNever: true }), /Only one of/);
});

test('isExpired', () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(isExpired(now - 10), true);
  assert.equal(isExpired(now + 10), false);
});
