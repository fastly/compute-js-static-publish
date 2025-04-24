/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// https://httpwg.org/specs/rfc9110.html#field.if-modified-since

export function getIfModifiedSinceHeader(request: Request): number | null {
  // A recipient MUST ignore the If-Modified-Since header field if the received
  // field value is not a valid HTTP-date, the field value has more than one
  // member, or if the request method is neither GET nor HEAD.

  const headerValue = request.headers.get('If-Modified-Since');
  if (headerValue == null || headerValue === '') {
    return null;
  }
  const dateValueMs = Date.parse(headerValue);
  if (Number.isNaN(dateValueMs)) {
    // Date.parse returns NaN if the date cannot be parsed.
    return null;
  }
  // We want to return this as a number of seconds;
  return Math.floor(dateValueMs / 1000);
}

export function checkIfModifiedSince(lastModifiedTime: number, ifModifiedSince: number): boolean {

  // 1. If the selected representation's last modification date is earlier or equal to the
  // date provided in the field value, the condition is false.
  if (lastModifiedTime <= ifModifiedSince) {
    return false;
  }

  // 2. Otherwise, the condition is true.
  return true;

}
