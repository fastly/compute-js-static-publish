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

export type KVStoreAssetInclusionTest = (assetKey: string, contentType?: string) => boolean;

export type PublishContentConfig = {
  // Set to a directory that acts as the root of all files that will be included in this publish.
  rootDir: string,

  // Set to a directory that will hold the working files built by compute-js-static-publish
  // These files should not be committed to source control.
  staticPublisherWorkingDir: string,

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
  kvStoreAssetInclusionTest?: KVStoreAssetInclusionTest | null,

  // Pre-generate content in these formats as well and serve them in tandem with the
  // allowedEncodings setting in the server settings. Default value is [ 'br' | 'gzip' ].
  contentCompression?: ('br' | 'gzip')[],

  // Additional / override content types.
  contentTypes?: ContentTypeDef[],

  // Server settings
  server?: PublisherServerConfig | null,
};

export type PublishContentConfigNormalized = {
  rootDir: string,
  staticPublisherWorkingDir: string,
  excludeDirs: ExcludeDirTest[],
  excludeDotFiles: boolean,
  includeWellKnown: boolean,
  kvStoreAssetInclusionTest: KVStoreAssetInclusionTest | null,
  contentCompression: ContentCompressionTypes[],
  contentTypes: ContentTypeDef[],
  server: PublisherServerConfigNormalized | null,
};
