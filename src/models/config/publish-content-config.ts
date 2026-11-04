/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import {
  type PublisherServerConfig,
  type PublisherServerConfigNormalized,
} from './publisher-server-config.js';
import {
  type ContentCompressionTypes,
} from '../compression/index.js';

export type ContentTypeTest = (name: string) => boolean;

// Content Type definition
export type ContentTypeDef = {
  // A test on the asset key to perform on this content type.
  test: RegExp | ContentTypeTest,

  // The Content-Type header value to provide for this content type.
  contentType: string,

  // Whether this content type represents a text value encoded in utf-8.
  // If so, conveniences can be provided.
  text?: boolean,

  // Binary formats are usually not candidates for compression, but certain
  // types can benefit from it.
  precompressAsset?: boolean,
};

export type ContentTypeTestResult = {
  contentType: string,
  text: boolean,
  precompressAsset: boolean,
};

export interface ExcludeDirTest {
  test(name: string): boolean;
}

// The result of an AssetInclusionTest. false leaves the file out. true, or an
// object, includes it. { hidden: true } includes it as a hidden file.
export type AssetInclusionTestResult = boolean | { hidden?: boolean };

export type AssetInclusionTest = (assetKey: string, contentType?: string) => AssetInclusionTestResult;

export type PublishContentConfig = {
  // Set to a directory that acts as the root of all files that will be included in this publish.
  rootDir: string,

  // An array of values used to exclude files and directories (as well as files within those directories) from being
  // included in this publish. Each entry in the array can be a string or a RegExp and will be tested against the relative
  // path from 'rootDir' of each file or directory.
  // Defaults to [ './node_modules' ].  Set to an empty array or specifically to null to include all files.
  excludeDirs?: (string | ExcludeDirTest)[] | string | ExcludeDirTest | null,

  // If true, then files whose names begin with a dot, as well as files in directories whose names begin with a .dot,
  // are excluded from this publish. Defaults to true.
  excludeDotFiles?: boolean,

  // If true, include .well-known even if excludeDotFiles is true.
  // Defaults to true.
  includeWellKnown?: boolean,

  // A test to run on each asset key to determine whether and how to include the file.
  // Return false to leave the file out, true to include it, or { hidden: true }
  // to include it as a hidden file.
  assetInclusionTest?: AssetInclusionTest | null,

  // The files to publish as hidden files. PublisherServer does not serve a hidden
  // file for a request. Code can get it with getMatchingAsset(key, { includeHidden: true }),
  // and the SPA file and the 404 page can be hidden files. This is not access control.
  // The same format as server.staticItems, tested against the asset key (the path
  // relative to rootDir): a directory that ends with '/', an exact path, a glob
  // pattern, or 're:/<regex>/<flags>'.
  hiddenItems?: string[] | string | false | null,

  // A test to run on each asset key to determine whether and how to include the file.
  // DEPRECATED: Use assetInclusionTest instead
  kvStoreAssetInclusionTest?: AssetInclusionTest | null,

  // Pre-generate content in these formats as well and serve them in tandem with the
  // allowedEncodings setting in the server settings. Default value is [ 'br' | 'gzip' ].
  contentCompression?: ('br' | 'gzip')[],

  // Brotli quality for the 'br' variants, an integer from 0 to 11. Lower values
  // compress much faster and give slightly larger files. Default value is 11.
  brotliQuality?: number,

  // Additional / override content types.
  contentTypes?: ContentTypeDef[],

  // Server settings
  server?: PublisherServerConfig | null,
};

export type PublishContentConfigNormalized = {
  rootDir: string,
  excludeDirs: ExcludeDirTest[],
  excludeDotFiles: boolean,
  includeWellKnown: boolean,
  assetInclusionTest: AssetInclusionTest | null,
  hiddenItems: string[],
  contentCompression: ContentCompressionTypes[],
  brotliQuality: number | undefined,
  contentTypes: ContentTypeDef[],
  server: PublisherServerConfigNormalized | null,
};
