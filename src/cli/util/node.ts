/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

export function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  if (err == null || typeof err !== 'object' || !('code' in err)) {
    return false;
  }
  return true;
}
