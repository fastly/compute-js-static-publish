/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ServerTiming } from '../../build/server/server/util/server-timing.js';

test('formats entries as a Server-Timing header value', () => {
  const serverTiming = new ServerTiming();
  serverTiming.add('settings', 1.234);
  serverTiming.add('cache', 0.5, 'hit age=3s');
  assert.equal(serverTiming.toHeaderValue(), 'settings;dur=1.2, cache;dur=0.5;desc="hit age=3s"');
});

test('measure() adds an entry and returns the result, also if the function throws', async () => {
  const serverTiming = new ServerTiming();
  assert.equal(await serverTiming.measure('a', async () => 42), 42);
  await assert.rejects(serverTiming.measure('b', async () => { throw new Error('failed'); }), /failed/);
  assert.match(serverTiming.toHeaderValue(), /^a;dur=[\d.]+, b;dur=[\d.]+$/);
});

test('gives an empty value with no entries', () => {
  assert.equal(new ServerTiming().toHeaderValue(), '');
});
