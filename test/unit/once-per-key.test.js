/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { OncePerKey } from '../../build/cli/cli/util/variants.js';

test('concurrent calls with the same key run the function one time', async () => {
  const once = new OncePerKey();
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const fn = async () => {
    calls++;
    await gate;
    return 'result';
  };

  const results = [ once.run('a', fn), once.run('a', fn), once.run('a', fn) ];
  assert.deepEqual(results.map(r => r.first), [ true, false, false ]);
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await Promise.all(results.map(r => r.promise)), [ 'result', 'result', 'result' ]);

  // A call after the function completes gets the same result.
  const later = once.run('a', fn);
  assert.equal(later.first, false);
  assert.equal(await later.promise, 'result');
  assert.equal(calls, 1);
});

test('each key runs its own function', async () => {
  const once = new OncePerKey();
  const a = once.run('a', async () => 1);
  const b = once.run('b', async () => 2);
  assert.equal(a.first, true);
  assert.equal(b.first, true);
  assert.equal(await a.promise, 1);
  assert.equal(await b.promise, 2);
});

test('a rejection goes to all callers of the key', async () => {
  const once = new OncePerKey();
  const fn = async () => { throw new Error('failed'); };
  const first = once.run('a', fn);
  const second = once.run('a', fn);
  await assert.rejects(first.promise, /failed/);
  await assert.rejects(second.promise, /failed/);
});
