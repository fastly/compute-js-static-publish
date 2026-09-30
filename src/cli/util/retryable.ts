/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { availableParallelism } from 'node:os';

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

export async function concurrentParallel<TObject extends { key: string }>(
  objects: TObject[],
  fn: (obj: TObject, key: string, index: number) => Promise<void>,
  buildStatusMessage: (err: unknown) => (string | null),
  maxConcurrent: number = 12,
  throwOnError: boolean = false,
) {

  let index = 0; // Shared among workers
  const failures: string[] = [];

  async function worker() {
    while (index < objects.length) {
      const currentIndex = index;
      index = index + 1;

      const object = objects[currentIndex];
      const { key } = object;

      try {
        await attemptWithRetries(
          async() => {
            await fn(object, key, currentIndex);
          },
          {
            onAttempt(attempt) {
              if (attempt > 0) {
                console.log(`  Attempt ${attempt + 1} for: ${key}`);
              }
            },
            onRetry(attempt, err, delay) {
              const statusMessage = buildStatusMessage(err) ?? 'unknown';
              console.log(`  ‼️ Attempt ${attempt + 1} for ${key} gave retryable error (${statusMessage}), delaying ${delay} ms`);
            },
          }
        );
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        console.error(`  ❌ Failed: ${key} → ${e.message}`);
        console.error(e.stack);
        failures.push(key);
      }
    }
  }

  const workers = Array.from({ length: maxConcurrent }, () => worker());
  await Promise.all(workers);

  if (throwOnError && failures.length > 0) {
    const shown = failures.slice(0, 10).join(', ');
    const more = failures.length > 10 ? `, and ${failures.length - 10} more` : '';
    throw new Error(`${failures.length} of ${objects.length} operation(s) failed: ${shown}${more}`);
  }
}

export async function concurrentMap<TItem, TResult>(
  items: TItem[],
  fn: (item: TItem, index: number) => Promise<TResult>,
  maxConcurrent: number = availableParallelism(),
): Promise<TResult[]> {

  const results: TResult[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index = index + 1;
      results[currentIndex] = await fn(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(maxConcurrent, items.length) }, () => worker());
  await Promise.all(workers);

  return results;
}
