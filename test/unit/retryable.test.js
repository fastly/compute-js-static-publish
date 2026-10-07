/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  attemptWithRetries,
  concurrentMap,
  concurrentParallel,
  isRetryableError,
  makeRetryable,
} from '../../build/cli/cli/util/retryable.js';

describe('attemptWithRetries', () => {
  test('retries a retryable error', async () => {
    let calls = 0;
    const result = await attemptWithRetries(async () => {
      calls++;
      if (calls < 3) {
        throw makeRetryable(new Error('try again'));
      }
      return 'ok';
    }, { initialDelay: 1 });
    assert.equal(result, 'ok');
    assert.equal(calls, 3);
  });

  test('does not retry other errors', async () => {
    let calls = 0;
    await assert.rejects(attemptWithRetries(async () => {
      calls++;
      throw new Error('fatal');
    }, { initialDelay: 1 }), /fatal/);
    assert.equal(calls, 1);
  });

  test('stops after maxRetries', async () => {
    let calls = 0;
    await assert.rejects(attemptWithRetries(async () => {
      calls++;
      throw makeRetryable(new Error('try again'));
    }, { initialDelay: 1, maxRetries: 2 }), /try again/);
    assert.equal(calls, 3);
  });

  test('isRetryableError', () => {
    assert.equal(isRetryableError(makeRetryable(new Error('a'))), true);
    assert.equal(isRetryableError(new Error('a')), false);
    assert.equal(isRetryableError('a'), false);
  });
});

describe('concurrentParallel', () => {
  const objects = [ 'a', 'b', 'c', 'd' ].map(key => ({ key }));

  test('runs the function for each object', async () => {
    const done = [];
    await concurrentParallel(objects, async (_, key) => { done.push(key); }, () => null, 2);
    assert.deepEqual(done.sort(), [ 'a', 'b', 'c', 'd' ]);
  });

  test('by default, continues after a failure', async (t) => {
    t.mock.method(console, 'error', () => {});
    const done = [];
    await concurrentParallel(objects, async (_, key) => {
      if (key === 'b') {
        throw new Error('failed');
      }
      done.push(key);
    }, () => null, 2);
    assert.deepEqual(done.sort(), [ 'a', 'c', 'd' ]);
  });

  test('with throwOnError, throws and names the failed keys', async (t) => {
    t.mock.method(console, 'error', () => {});
    await assert.rejects(
      concurrentParallel(objects, async (_, key) => {
        if (key === 'b' || key === 'd') {
          throw new Error('failed');
        }
      }, () => null, 2, true),
      /2 of 4 operation\(s\) failed: (b, d|d, b)/,
    );
  });
});

describe('concurrentMap', () => {
  test('keeps the order of the results', async () => {
    const result = await concurrentMap([ 30, 10, 20 ], async (ms) => {
      await new Promise(resolve => setTimeout(resolve, ms));
      return ms * 2;
    }, 3);
    assert.deepEqual(result, [ 60, 20, 40 ]);
  });

  test('runs at most maxConcurrent at the same time', async () => {
    let running = 0;
    let maxRunning = 0;
    await concurrentMap(Array.from({ length: 10 }, (_, i) => i), async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise(resolve => setTimeout(resolve, 5));
      running--;
    }, 3);
    assert.equal(maxRunning, 3);
  });

  test('names the item that failed, and does not start more items', async () => {
    const started = [];
    await assert.rejects(
      concurrentMap([ 'a', 'b', 'c', 'd' ], async (item) => {
        started.push(item);
        if (item === 'a') {
          throw new Error('bad file');
        }
      }, 1),
      /Failed to process 'a': bad file/,
    );
    assert.deepEqual(started, [ 'a' ]);
  });
});
