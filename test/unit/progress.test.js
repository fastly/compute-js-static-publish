/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PROGRESS_INTERVAL, ProgressLog } from '../../build/cli/cli/util/progress.js';
import { mockConsoleLog } from './mock-console.js';

test('logs each message with verbose', (t) => {
  const messages = mockConsoleLog(t);
  const progress = new ProgressLog('Files scanned', true);
  progress.add(1, () => 'one');
  progress.add(1, () => 'two');
  assert.deepEqual(messages(), [ 'one', 'two' ]);
});

test('without verbose, logs one line for each interval, and makes no message', (t) => {
  const messages = mockConsoleLog(t);
  const progress = new ProgressLog('Files scanned', false);
  for (let i = 0; i < PROGRESS_INTERVAL * 2 + 5; i++) {
    progress.add(1, () => assert.fail('the message is not made'));
  }
  assert.deepEqual(messages(), [
    `  | Files scanned: ${PROGRESS_INTERVAL}`,
    `  | Files scanned: ${PROGRESS_INTERVAL * 2}`,
  ]);
});

test('without verbose, logs one line when a count passes more than one interval', (t) => {
  const messages = mockConsoleLog(t);
  const progress = new ProgressLog('Entries uploaded', false, PROGRESS_INTERVAL * 5);
  progress.add(PROGRESS_INTERVAL - 1, () => '');
  progress.add(PROGRESS_INTERVAL * 2 + 1, () => '');
  progress.add(PROGRESS_INTERVAL, () => '');
  assert.deepEqual(messages(), [
    `  | Entries uploaded: ${PROGRESS_INTERVAL * 3} of ${PROGRESS_INTERVAL * 5}`,
    `  | Entries uploaded: ${PROGRESS_INTERVAL * 4} of ${PROGRESS_INTERVAL * 5}`,
  ]);
});

test('without verbose, logs nothing when the total is reached', (t) => {
  const messages = mockConsoleLog(t);
  const progress = new ProgressLog('Entries uploaded', false, PROGRESS_INTERVAL);
  progress.add(PROGRESS_INTERVAL, () => '');
  assert.deepEqual(messages(), []);
});
