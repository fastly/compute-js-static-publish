/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// A stored body that does not have the size that its metadata gives. Storage can
// return such a body for a short time, for example a KV Store entry whose
// metadata reached the POP before its body.
export class BodyLengthError extends Error {
  constructor(description: string, expectedLength: number, actualLength: number, complete: boolean) {
    super(`${description}: expected ${expectedLength} bytes, got ${complete ? '' : 'at least '}${actualLength}`);
    this.name = 'BodyLengthError';
  }
}

// The runtime does not log the message of an error from the request handler or
// from a response body stream. Thus log the error here.
function logged(err: BodyLengthError): BodyLengthError {
  console.error(err.message);
  return err;
}

// Returns a stream with the bytes of body. The stream errors with a
// BodyLengthError if body has a different number of bytes than expectedLength.
// This function reads the first chunk before it returns, so it throws for an
// empty body before a response is made from the stream.
export async function checkBodyLength(
  body: ReadableStream<Uint8Array>,
  expectedLength: number,
  description: string,
): Promise<ReadableStream<Uint8Array>> {
  const reader = body.getReader();
  const first = await reader.read();
  let length = first.done ? 0 : first.value.byteLength;
  if ((first.done && expectedLength !== 0) || length > expectedLength) {
    await reader.cancel();
    throw logged(new BodyLengthError(description, expectedLength, length, first.done));
  }

  let firstChunk = first.done ? null : first.value;
  let done = first.done;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (firstChunk != null) {
        controller.enqueue(firstChunk);
        firstChunk = null;
        return;
      }
      const result = done ? { done: true as const } : await reader.read();
      if (!result.done) {
        length += result.value.byteLength;
        if (length > expectedLength) {
          await reader.cancel();
          controller.error(logged(new BodyLengthError(description, expectedLength, length, false)));
          return;
        }
        controller.enqueue(result.value);
        return;
      }
      done = true;
      if (length !== expectedLength) {
        controller.error(logged(new BodyLengthError(description, expectedLength, length, true)));
        return;
      }
      controller.close();
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}
