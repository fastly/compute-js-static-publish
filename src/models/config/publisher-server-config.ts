/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { type ContentCompressionTypes } from '../compression/index.js';

// Publisher Server configuration
export type PublisherServerConfig = {
  // Prefix to apply to web requests. Effectively, a directory within rootDir that is used
  // by the web server to determine the asset to respond with. Defaults to the empty string.
  publicDirPrefix?: string,

  // A test to apply to item names to decide whether to serve them as "static" files, in other
  // words, with a long TTL. These are used for files that are not expected to change.
  // They can be provided as a string or array of strings.
  // Items that contain asterisks, are interpreted as glob patterns.
  // Items that end with a trailing slash are interpreted as directory names,
  // Items that don't contain asterisks and that do not end in slash are checked for exact match.
  staticItems?: string[] | string | false | null,

  // Allowed encodings. If the request contains an Accept-Encoding header, they are checked in the order listed
  // in the header for the values listed here. The compression algorithm represented by the first match is applied.
  // Default value is [ 'br', 'gzip' ].
  allowedEncodings?: ContentCompressionTypes[],

  // Set to the asset key of a content item to serve this when a GET request comes in for an unknown asset, and
  // the Accept header includes text/html.
  spaFile?: string | false | null,

  // Set to the asset key of a content item to serve this when a request comes in for an unknown asset, and
  // the Accept header includes text/html.
  notFoundPageFile?: string | false | null,

  // When a file is not found, and it doesn't end in a slash, then try auto-ext: try to serve a file with the same name
  // postfixed with the specified strings, tested in the order listed.
  autoExt?: string[] | string | false | null,

  // When a file is not found, then try auto-index: treat it as a directory, then try to serve a file that has the
  // specified strings, tested in the order listed.
  autoIndex?: string[] | string | false | null,
};

export type PublisherServerConfigNormalized = {
  publicDirPrefix: string,
  staticItems: string[],
  allowedEncodings: ContentCompressionTypes[],
  spaFile: string | null,
  notFoundPageFile: string | null,
  autoExt: string[],
  autoIndex: string[],
};
