/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

let _globalBackoffUntil = 0;

const retryableSymbol = Symbol();
export function makeRetryable(error: Error) {
  (error as any)[retryableSymbol] = true;
  return error;
}
export function isRetryableError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return (error as any)[retryableSymbol] ?? false;
}

type RetryWithBackoffOptions = {
  maxRetries?: number,
  initialDelay?: number,
  onAttempt?: (attempt: number) => void,
  onSuccess?: (attempt: number) => void,
  onRetry?: (attempt: number, err: unknown, delay: number) => void,
};
export async function attemptWithRetries<TResult>(
  fn: () => Promise<TResult>,
  options: RetryWithBackoffOptions = {},
) {
  const {
    maxRetries = 5,
    initialDelay = 60000,
    onAttempt,
    onSuccess,
    onRetry,
  } = options;

  let attempt = 0;
  let result: TResult;

  while (true) {
    const waitTime = _globalBackoffUntil - Date.now();
    if (waitTime > 0) {
      await new Promise(res => setTimeout(res, waitTime));
    }

    try {
      onAttempt?.(attempt);
      result = await fn();
      onSuccess?.(attempt);
      break;
    } catch (err) {
      if (!isRetryableError(err) || attempt >= maxRetries) {
        throw err;
      }

      const delay = initialDelay * (attempt + 1);
      _globalBackoffUntil = Date.now() + delay;
      onRetry?.(attempt, err, delay);
    }

    attempt++;
  }

  return result;
}
