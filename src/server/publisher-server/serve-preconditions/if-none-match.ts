/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// https://httpwg.org/specs/rfc9110.html#field.if-none-match

export function getIfNoneMatchHeader(request: Request): string[] {

  return (request.headers.get('If-None-Match') ?? '')
    .split(',')
    .map(x => x.trim())
    .filter(x => Boolean(x));

}

export function checkIfNoneMatch(etag: string, headerValue: string[]): boolean {
  // 1. If the field value is "*", the condition is false if the origin server has a
  // current representation for the target resource.
  if (headerValue.includes('*')) {
    return false;
  }

  // 2. If the field value is a list of entity tags, the condition is false if one of the listed tags matches the
  // entity tag of the selected representation. A recipient MUST use the weak comparison function when comparing
  // entity tags for If-None-Match (Section 8.8.3.2), since weak entity tags can be used for cache validation even
  // if there have been changes to the representation data.

  // But in our system we don't use weak tags, so we do a compare
  if (headerValue.includes(etag)) {
    return false;
  }

  // 3. Otherwise, the condition is true.
  return true;
}
