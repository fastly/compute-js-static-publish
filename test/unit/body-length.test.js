/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BodyLengthError, checkBodyLength } from '../../build/server/server/util/body-length.js';
import { mockConsoleError } from './mock-console.js';

function streamOf(chunks) {
  return new ReadableStream({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk != null) {
        controller.enqueue(new TextEncoder().encode(chunk));
      } else {
        controller.close();
      }
    },
  });
}

test('gives the bytes of a body that has the expected length', async (t) => {
  const messages = mockConsoleError(t);
  const body = await checkBodyLength(streamOf([ 'abc', 'def' ]), 6, 'file');
  assert.equal(await new Response(body).text(), 'abcdef');
  assert.deepEqual(messages(), []);
});

test('accepts an empty body with an expected length of 0', async () => {
  const body = await checkBodyLength(streamOf([]), 0, 'file');
  assert.equal(await new Response(body).text(), '');
});

test('throws for an empty body before it gives a stream, and logs the error', async (t) => {
  const messages = mockConsoleError(t);
  await assert.rejects(
    checkBodyLength(streamOf([]), 6, 'file'),
    (err) => err instanceof BodyLengthError && err.message === 'file: expected 6 bytes, got 0',
  );
  assert.deepEqual(messages(), [ 'file: expected 6 bytes, got 0' ]);
});

test('throws if the first chunk is larger than the expected length', async (t) => {
  mockConsoleError(t);
  await assert.rejects(checkBodyLength(streamOf([ 'abcdefg' ]), 6, 'file'), BodyLengthError);
});

test('errors the stream for a short body, and logs the error', async (t) => {
  const messages = mockConsoleError(t);
  const body = await checkBodyLength(streamOf([ 'abc', 'de' ]), 6, 'file');
  await assert.rejects(
    new Response(body).text(),
    (err) => err instanceof BodyLengthError && err.message === 'file: expected 6 bytes, got 5',
  );
  assert.deepEqual(messages(), [ 'file: expected 6 bytes, got 5' ]);
});

test('errors the stream for a long body', async (t) => {
  mockConsoleError(t);
  const body = await checkBodyLength(streamOf([ 'abc', 'defg' ]), 6, 'file');
  await assert.rejects(
    new Response(body).text(),
    (err) => err instanceof BodyLengthError && err.message === 'file: expected 6 bytes, got at least 7',
  );
});
