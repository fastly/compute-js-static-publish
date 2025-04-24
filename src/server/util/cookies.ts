/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

export function getCookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) {
    return null;
  }

  return cookieHeader
    .split(';')
    .map(v => v.trim().split('='))
    .find(([key]) => key === name)?.[1] ?? null;
}
