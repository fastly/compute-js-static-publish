/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import {
  type ContentCompressionTypes,
  compressionTypes,
} from '../../models/compression/index.js';

export type ResponseCacheOptions = {
  // How long, in seconds, a cached response stays fresh. Publishing purges the
  // collection's surrogate key, so this mainly limits how long a response can
  // stay cached if that purge does not run.
  maxAge: number,
  // The largest body, in bytes, that is cached. A response is read completely
  // before it is cached, so this limits the memory that one request uses. A
  // larger response is served from storage. Default: DEFAULT_MAX_BODY_SIZE.
  maxBodySize?: number,
};

export const DEFAULT_MAX_BODY_SIZE = 8 * 1024 * 1024;

// What is stored as the user metadata of a cached response. A cached "not found"
// lets a missing path skip reading the settings and the index, too. A cached
// "too large" tells later requests to serve the path without the cache.
export type CachedResponseMetadata =
  | { notFound: true, tooLarge?: false }
  | { notFound?: false, tooLarge: true }
  | { notFound?: false, tooLarge?: false, status: number, headers: [string, string][] };

// Statuses that serveAsset() produces for a found file or a not-found page.
// Anything else (for example, a 500 when the settings are missing) is not cached.
export const CACHEABLE_STATUSES: Readonly<number[]> = [ 200, 404 ];

// Request headers that make a response depend on the client's cached copy.
// The response that is stored is always the full one.
const CONDITIONAL_REQUEST_HEADERS = [
  'If-Match',
  'If-None-Match',
  'If-Modified-Since',
  'If-Unmodified-Since',
  'If-Range',
  'Range',
] as const;

// Parses an Accept-Encoding header value into groups of the allowed encodings
// that have the same q value, highest first. For example, with both br and
// gzip allowed, 'br;q=1, gzip;q=0.5' gives [['br'], ['gzip']].
export function parseAcceptEncodingGroups(
  headerValue: string,
  allowedEncodings: Readonly<ContentCompressionTypes[]>,
): ContentCompressionTypes[][] {
  const trimmed = headerValue.trim();
  if (trimmed === '' || allowedEncodings.length === 0) {
    return [];
  }

  const priorityMap = new Map<number, ContentCompressionTypes[]>;

  for (const item of trimmed.split(',')) {
    let [encodingValue, qValueStr] = item.trim().split(';');
    encodingValue = encodingValue.trim();
    if (!allowedEncodings.includes(encodingValue as ContentCompressionTypes)) {
      continue;
    }
    let qValue; // q value multiplied by 1000
    if (qValueStr == null || !qValueStr.startsWith('q=')) {
      // use default of 1.0
      qValue = 1000;
    } else {
      qValueStr = qValueStr.slice(2); // remove the q=
      qValue = parseFloat(qValueStr);
      if (Number.isNaN(qValue) || qValue > 1) {
        qValue = 1;
      }
      if (qValue < 0) {
        qValue = 0;
      }
      // q values can have up to 3 decimal digits
      qValue = Math.floor(qValue * 1000);
    }

    let typesForQValue = priorityMap.get(qValue);
    if (typesForQValue == null) {
      typesForQValue = [];
      priorityMap.set(qValue, typesForQValue);
    }
    typesForQValue.push(encodingValue as ContentCompressionTypes);
  }

  // Sort keys, larger numbers to come first
  return [...priorityMap.keys()]
    .sort((qValueA, qValueB) => qValueB - qValueA)
    .map(qValue => priorityMap.get(qValue)!);
}

// Normalizes the request's Accept-Encoding into a short string for the cache
// key, using every encoding that the publisher can produce. The collection's
// allowedEncodings is left out on purpose: it would need the settings, and it
// only changes when the collection is published again, which purges the cache.
// For example, 'gzip, deflate, br' gives 'br+gzip'.
export function acceptEncodingCacheKeyPart(request: Request): string {
  const groups = parseAcceptEncodingGroups(request.headers.get('Accept-Encoding') ?? '', compressionTypes);
  if (groups.length === 0) {
    return 'identity';
  }
  return groups
    .map(group => [...group].sort().join('+'))
    .join('>');
}

export function buildResponseCacheKey(
  publishId: string,
  collectionName: string,
  keyPath: string,
  request: Request,
) {
  return `${publishId}_response_${collectionName}_${acceptEncodingCacheKeyPart(request)}_${keyPath}`;
}

// The request used to produce a response for the cache: always a GET, without
// conditional or range headers, so that the stored response is the full one.
export function buildCacheFillRequest(request: Request): Request {
  const headers = new Headers(request.headers);
  for (const name of CONDITIONAL_REQUEST_HEADERS) {
    headers.delete(name);
  }
  return new Request(request.url, { method: 'GET', headers });
}

export type ReadBodyResult =
  | { bytes: Uint8Array<ArrayBuffer> }
  | { body: ReadableStream<Uint8Array> };

// Reads body completely if it has maxLength bytes or fewer, and returns the bytes.
// Otherwise it stops reading, and returns a stream with all the bytes of body,
// including the bytes that it read. An error from body rejects the promise, or,
// after the limit, errors the stream.
export async function readBodyUpTo(
  body: ReadableStream<Uint8Array> | null,
  maxLength: number,
): Promise<ReadBodyResult> {
  if (body == null) {
    return { bytes: new Uint8Array(0) };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    length += value.byteLength;
    if (length > maxLength) {
      return {
        body: new ReadableStream<Uint8Array>({
          async pull(controller) {
            const chunk = chunks.shift();
            if (chunk != null) {
              controller.enqueue(chunk);
              return;
            }
            const result = await reader.read();
            if (result.done) {
              controller.close();
            } else {
              controller.enqueue(result.value);
            }
          },
          async cancel(reason) {
            await reader.cancel(reason);
          },
        }),
      };
    }
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes };
}

export function encodeCachedResponseMetadata(metadata: CachedResponseMetadata): string {
  return JSON.stringify(metadata);
}

export function decodeCachedResponseMetadata(buffer: ArrayBuffer): CachedResponseMetadata | null {
  try {
    const value = JSON.parse(new TextDecoder().decode(buffer));
    if (value?.notFound === true) {
      return { notFound: true };
    }
    if (value?.tooLarge === true) {
      return { tooLarge: true };
    }
    if (typeof value?.status === 'number' && Array.isArray(value.headers)) {
      return { status: value.status, headers: value.headers };
    }
  } catch {
    // Not valid JSON: treat the entry as a miss.
  }
  return null;
}
