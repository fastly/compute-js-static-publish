/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Returns true if the request accepts a text/html response.
// https://httpwg.org/specs/rfc9110.html#field.accept
// * A missing or empty Accept header accepts all media types.
// * The most specific media range that matches text/html gives the q-value:
//   text/html, then text/*, then */*. A q-value of 0 means "not acceptable".
// * The media type parameters other than q are ignored.
// * A bare '*' is the same as '*/*'.
export function requestAcceptsTextHtml(request: Request): boolean {
  const header = (request.headers.get('Accept') ?? '').trim();
  if (header === '') {
    return true;
  }

  // The highest q-value for each media range that matches text/html
  let htmlQValue: number | null = null;
  let textQValue: number | null = null;
  let anyQValue: number | null = null;

  for (const item of header.split(',')) {
    const [rangeStr, ...paramStrs] = item.split(';');
    const range = rangeStr.trim().toLowerCase();
    if (range === '') {
      continue;
    }

    let qValue = 1;
    for (const paramStr of paramStrs) {
      const [name, value] = paramStr.split('=');
      if (name.trim().toLowerCase() !== 'q' || value == null) {
        continue;
      }
      const parsed = parseFloat(value.trim());
      if (!Number.isNaN(parsed)) {
        qValue = Math.min(Math.max(parsed, 0), 1);
      }
    }

    if (range === 'text/html') {
      htmlQValue = Math.max(htmlQValue ?? 0, qValue);
    } else if (range === 'text/*') {
      textQValue = Math.max(textQValue ?? 0, qValue);
    } else if (range === '*/*' || range === '*') {
      anyQValue = Math.max(anyQValue ?? 0, qValue);
    }
  }

  const qValue = htmlQValue ?? textQValue ?? anyQValue;
  return qValue != null && qValue > 0;
}
