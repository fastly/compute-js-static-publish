import type { ContentTypeDef } from "./content-types.js";

export interface ExcludeDirTest {
  test(name: string): boolean;
}

export type ContentAssetInclusionResult = {
  // Content asset inclusion mode:

  // includeContent:
  // true  - Include in Wasm binary and serve using includeBytes() function, or
  //         serve from Object Store if enabled. Default.
  // false - Exclude from this publish.
  includeContent?: boolean,

  // inline:
  // true  - Use includeBytes() for this asset, even if Object Store is enabled.
  // false - If Object Store is enabled, serve the file from it. Default.
  inline?: boolean,
};

// Asset Inclusion test
export type ContentAssetInclusionTest = (assetKey: string, contentType?: string) => ContentAssetInclusionResult | true | 'inline' | false | null;

export type ModuleAssetInclusionResult = {
  // Module asset inclusion mode:

  // includeModule:
  // true  - Include in Wasm binary as a dynamically loaded module.
  // false - Exclude from this publish. Default.
  includeModule?: boolean,

  // useStaticImport:
  // true  - If isModule is true, then import the module statically instead of dynamically.
  //         The dynamic loader getModule() function will simply return a reference to this
  //         instance, in this case.
  // false - Don't load the module statically. Default.
  useStaticImport?: boolean,
};

// Asset Inclusion test
export type ModuleAssetInclusionTest = (assetKey: string, contentType?: string) => ModuleAssetInclusionResult | true | false | 'static-import' | null;

export type StaticPublisherConfig = {
  // Set to a directory that acts as the root of all files that will be included in this publish.
  rootDir: string,

  // Set to a non-null string equal to the _name_ of an existing object store to enable "object store" mode for this publish.
  // Service ID must also be specified in fastly.toml, or this will be an error.
  objectStore?: string | false | null,

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

  // A test to run on each asset key to determine whether and how to include the file as a content asset and/or module asset.
  contentAssetInclusionTest?: ContentAssetInclusionTest | null;

  // Pre-generate content in these formats as well and serve them in tandem with the
  // compression setting in the server settings. Default value is [ 'br' | 'gzip' ].
  contentCompression?: ('br' | 'gzip')[],

  // A test to run on each asset key to determine whether and how to include the file as a content asset and/or module asset.
  moduleAssetInclusionTest?: ModuleAssetInclusionTest | null;

  // Additional / override content types.
  contentTypes?: ContentTypeDef[],

  // Server settings
  server?: PublisherServerConfig | null,
};

// Modify response
// export type ModifyResponseFunction = (response: Response, assetKey: string) => Response;

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

  // Compression. If the request contains an Accept-Encoding header, they are checked in the order listed
  // in the header for the values listed here. The compression algorithm represented by the first match is applied.
  // Default value is [ 'br', 'gzip' ].
  compression?: ('br' | 'gzip')[],

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

  // Modify Response before it is served
  // modifyResponse?: ModifyResponseFunction | null,
};
