# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file does not list v7 releases after 7.0.8, or v6 releases after 6.3.0. For those, see `CHANGELOG.md` in the [v7 branch](https://github.com/fastly/compute-js-static-publish/blob/v7/CHANGELOG.md) and in the [v6 branch](https://github.com/fastly/compute-js-static-publish/blob/v6/CHANGELOG.md).

## [unreleased]

### Added

- Scaffolding: the `package.json` of a new app has the npm scripts `prebuild`, `postbuild`, and `postinstall`. Each one runs `compute-js-static-publish run-template-hook <name>`, which runs `scripts/template_<name>.js` in the app if it exists. Templates use these hooks. An app can add its own hook file.
- Scaffolding: `static-publish.rc.js` of a new app has `generatedFrom`: the template, the version of this package, and the date that the app was generated with.
- Previews with collection selection: `collectionSelection` in `static-publish.rc.js` chooses the collection of each request (see below). It is off by default. The CLI checks it when it loads `static-publish.rc.js`.
   - `PublisherServer.fromStaticPublishRc()` reads it. `setCollectionSelection()` sets it, and `resolveCollection(request)` uses it.
   - With it, a collection that `serveRequest()` or `serveFallback()` serves through the `collectionName` option, and that is not the default collection: if it does not exist or has expired, `onMissing` gives a `404` response (`'not-found'`, the default) or serves the default collection (`'default'`). Its responses get `Cache-Control: private` and, unless `noindex` is `false`, `X-Robots-Tag: noindex`.
   - `PublisherServer.collectionExists(request, collectionName)`.
   - Scaffolding: the `src/index.js` of the `plain` app calls `resolveCollection()`, and passes the result to `serveRequest()`. Without `collectionSelection`, it serves the default collection, as before.
   - Scaffolding: the flags `--collection-selection`, `--collection-allow`, `--collection-on-missing`, and `--collection-noindex` write `collectionSelection`.
- Collection selection: `resolveCollection(request, collectionSelection)` chooses the collection for a request from a list of sources (`host`, `path`, `query`, `cookie`, `header`), tried in order. `allow` limits the collections that can be selected. A `path` or `query` source with `sticky: 'cookie'` sets the cookie of the `cookie` source and redirects to the URL without the selector. The `cookie` source also serves its activate and reset paths; their redirects go only to a path on the same site. `previewUrl(collectionName, baseUrl, collectionSelection)` gives the URL that shows a collection. `validateCollectionSelection()` checks a config.
- Hidden files: a hidden file is published, but `PublisherServer` does not serve it for a request, also not through `autoExt` or `autoIndex`. Mark files with `hiddenItems` in `publish-content.config.js` (the same format as `server.staticItems`), or return `{ hidden: true }` from `assetInclusionTest`. The SPA file and the 404 page can be hidden, and the server still serves them as the fallback page. Code gets a hidden file with `getMatchingAsset(key, { includeHidden: true })`. Hidden is not access control.
   - In the index, the key of a hidden file is `hidden:` and then the asset key. A collection that has hidden files requires the `hidden` feature, so an app built with 8.0 does not serve it. Build and deploy your app with this version before you publish hidden files.
   - `publish-content` shows the number of hidden files. `collections list` shows the number of files and of hidden files in each collection.
- `getMatchingAsset(key, options)`: the second argument can now be an object, `{ applyAuto, includeHidden }`. A boolean (the value of `applyAuto`) continues to work.
- `PublisherServer.serveRequest(request, options)`: the options `collectionName` (the collection for this call only), `pathname` (the path to look up, in place of the URL path), `fallback` (`false`: do not serve the SPA file or the 404 page), and `healthCheck` (`false`: do not answer `/healthz`). Without options, the behavior does not change.
- `PublisherServer.serveFallback(request, { collectionName })`: serves the SPA file or the 404 page, as `serveRequest()` does when no file matches. Use it after `serveRequest()` with `fallback: false`.
- Export the types `ServeRequestOptions` and `ServeFallbackOptions`.
- Scaffolding: add `--default-collection-name`, the collection to serve when no collection is selected. It is written as `defaultCollectionName` in `static-publish.rc.js`. Before, it was always `live`, which is still the default.

- Managed projects (in development): `scaffold --managed` writes only `static-publish.project.js` in the current directory, and adds `.static-publish/` and the working directory to `.gitignore`. The project file has the fields of `static-publish.rc.js` at the top level, the fields of `publish-content.config.js` in `publishContent`, and the settings of the generated app in `managed`. `publish-content`, `collections`, and `clean` read it. A directory with both `static-publish.project.js` and `static-publish.rc.js` is an error. The type is `StaticPublishProject`.
- `publish-content` purges the service of `managed.serviceId` in a managed project (after `--fastly-service-id` and `FASTLY_SERVICE_ID`, before `fastly.toml`).
- Managed projects: the `dev` command generates the app in `.static-publish/app/`, installs it with `npm ci` only when its `package.json` or lockfile changed, and runs `fastly compute serve`. This package ships a lockfile for the app of each template (`resources/templates/<name>/package-lock.json`), and the app uses the copy of this package that runs the CLI through a `file:` link.
- Managed projects: `deploy` deploys the generated app only if its fingerprint changed (`--force` deploys anyway), records the fingerprint in the comment of the service version, and writes the Service ID of the first deploy into `managed.serviceId`. `status` shows if a deploy is necessary, and the preview URLs. `dev` and `deploy` stop if `managed.staticPublishVersion` is not the version that runs; `upgrade` (or `--auto-upgrade` with a newer CLI) moves the project to it. In an ejected app, `deploy` runs `fastly compute publish`, and `status` shows the Service ID.
- CLI: global options `--version` (shows only the version, in any directory), `--project-dir <dir>` (run as if in that directory), `--non-interactive` (also on when `CI` is set), and `--json`.
- CLI: `publish-content --json` and `collections list --json` write one JSON object to stdout at the end (`schemaVersion: 1`), and the log to stderr. `collections list` shows the number of files. See "Using the CLI in CI" in the README.
- CLI: the API token and the S3 secret access key are replaced with `[REDACTED]` in the output.

### Changed

- `staticPublisherWorkingDir` has a new rule: a relative path that starts with `./` or `../`, and that is not the directory of the config file or a directory above it. Paths outside the config dir (`../static-publisher`) are now allowed. A value that breaks the rule now stops the command. Before, the check showed no error, and the command continued.
- CLI exit codes: `2` for a usage or config error (the command could not start), `1` for a failed operation, `0` for success. Before, all errors were `1`. With `--json`, an error is `{ schemaVersion, error: { code, message } }` on stdout.
- `collections delete` of a collection that does not exist says so, and succeeds. `collections promote` from a collection that does not exist is an error (`2`) with a clear message, not a stack trace.

- Collection names have a rule: a DNS label (lowercase `a-z`, `0-9`, and `-`, from 1 to 63 characters, with no `-` at the start or the end). Thus a name is safe in storage keys, in the surrogate key of the purge, in a cookie, and in a hostname.
   - `publish-content` to a new collection, and `collections promote --to` a new collection, stop with an error for a name that breaks the rule.
   - A collection that exists continues to work with a name that breaks the rule. `publish-content` and `collections promote --to` show a warning for it.
   - `collectionSelector.fromCookie()`: the activate path returns `400` for a name that breaks the rule, and sets no cookie. Before, it returned `400` only for a name with characters that a cookie value cannot have.
- `PublisherServer` keeps the state of each request (the settings, the index, and the `Server-Timing` measurements) in a scope for that request and collection. A reused sandbox does not keep this state from one request to the next. A second call for the same request (for example `beginRequest()` and then `serveRequest()`) does not read the index again.

### Deprecated

- `PublisherServer`: the fields `serverTiming`, `settingsCached`, and `assetEntryMapCache`. They are now read-only, and they return the state of the current request. Code that assigns to them gets a TypeScript error. Use `getServerConfig()` and `getAssetEntryMap()`. These fields will be removed in v9.

## [8.0.0] - 2026-10-27

### Breaking

- Fastly API token
   - The CLI no longer falls back to `fastly profile token`. Pass the token with `--fastly-api-token` or the `FASTLY_API_TOKEN` environment variable.
   - Remove the `@fastly/cli` dependency, which was used only for that fallback. A scaffolded app continues to have `@fastly/cli` as its own dependency.

- Imports of files in `build/` are not supported. Import the named exports of `@fastly/compute-js-static-publish`.

### Added

- S3-compatible storage (BETA)
   - Add support for S3-compatible storage, such as Fastly Object Storage. Items are stored with the same keys as in the KV Store, and the asset metadata is stored in the S3 object metadata.
   - `static-publish.rc.js`: add the `s3` storage mode configuration.
   - The server reads the S3 credentials from the Secret Store that has the resource link name `S3_CREDENTIALS` on the service. The Secret Store can have a different name. To change the resource link name or the key names, call `setSecretStoreForS3Credentials()`, `setSecretStoreKeyForS3AccessKeyId()`, or `setSecretStoreKeyForS3SecretAccessKey()`. To get the credentials in a different way, call `setS3CredentialsBuilder()`.
   - The scaffolder adds the credentials to the `[local_server]` and `[setup]` sections of `fastly.toml`. When the first deploy creates a new service, the Fastly CLI creates the Secret Store, links it to the service, and prompts you for the credentials. The instructions shown at the end of scaffolding also tell you how to set up an existing service.
   - The server signs requests with `@smithy/signature-v4`, and does not use the AWS SDK. The AWS SDK parses XML with `DOMParser`, which Fastly Compute does not have. Without the SDK, the Wasm binary is also much smaller.
   - `--local` is for KV Store mode only. In S3 mode, the commands stop with an error before they connect to storage. There is no local simulation of S3 storage.
   - Storage is factored out to `StorageProvider`, and S3 is implemented with this architecture.

- Collections can declare the features that the server must support. A later version adds a feature to the index metadata (`requires`) only if the content that it publishes uses that feature. `PublisherServer` does not serve a collection that requires a feature that it does not support, and it logs the reason. Without this check, an older server would serve such a collection incorrectly. Build and deploy your app again to serve it. `collections list` shows the features that a collection requires. This version does not add features to `requires`.
   - `collections promote` and `collections update-expiration` keep the fields of the index metadata that they do not know.

- `publish-content`
   - After publishing, purge the surrogate key `<publishId>-<collectionName>` (a soft purge), in KV Store and S3 modes (not with `--local`). This clears the responses that the response cache keeps (see `setResponseCache()`).
   - Add `--fastly-service-id`. The Service ID to purge comes from `--fastly-service-id`, then the `FASTLY_SERVICE_ID` environment variable, then `service_id` in `fastly.toml`. This is the same order as the Fastly CLI's `--service-id`. If there is no Service ID, the command does not purge.
   - Add `--purge-environment` to purge `production` (the default), `staging`, or both. A staging purge sends the `Fastly-Purge-Environment: staging` header.
   - A failed purge shows a warning on stderr. The command still completes, because the content is already published.
   - Add `--brotli-quality=<0-11>`. It overrides `brotliQuality` in `publish-content.config.js`.
   - Add `--s3-upload-concurrency=<1-256>`: the number of objects to upload to S3-compatible storage at the same time (default: 64).

- `collections delete`
   - After the delete, purge the surrogate key of the collection, so that the service stops serving cached responses of the deleted collection. This has the same options and rules as the purge of `publish-content`: `--fastly-service-id`, `--purge-environment`, and the API token.

- `publish-content.config.js`
   - Add `brotliQuality` (0 to 11, default 11). A lower value compresses much faster, and gives slightly larger files.

- `PublisherServer`
   - Add `setServerTimingRequestHeader()`. When set, a request that has this header gets a `Server-Timing` response header with the time spent reading the settings, the index, and the file. Off by default.
   - Add `beginRequest()`. `serveRequest()` calls it. Call it yourself before `getMatchingAsset()` if you call `getMatchingAsset()` and `serveAsset()` directly.
   - Add `setResponseCache()`. When set, whole responses are cached with the Core Cache API, keyed by publish ID, collection, path, and the client's `Accept-Encoding`. A cache hit does not read the settings, the index, or the file. Paths that are not found are cached, too. A response is read completely, and is cached only if its body has the size in the file's metadata. A response that is larger than `maxBodySize` (default 8 MiB) is served from storage and not cached, so a large file is not held in memory. Entries have the surrogate key `<publishId>-<collectionName>`, which `publish-content` purges. Off by default.
   - Add `serveCached()`, to use the response cache with `getMatchingAsset()` and `serveAsset()`. `serveRequest()` uses it automatically.
   - `Server-Timing` has a `cache` entry when the response cache is on: `hit` (with the age of the cached response), `miss`, or `bypass`.

### Changed

- `publish-content.config.js`
   - `kvStoreAssetInclusionTest` renamed to `assetInclusionTest`. Previous name deprecated.

- `publish-content`
   - Lists the files in storage one time before the scan, in 16 parts at the same time. The KV Store listing uses strong consistency. The command does not compress, hash, or upload a file that is already in storage. Before, it examined each file in storage with a separate request, one file at a time.
   - Uploads a compressed variant only if it is smaller than the original. Before, it uploaded each variant, and only the index left out the variants that were not smaller.
   - Uploads KV Store entries in batches (the KV Store batch API). Entries that are larger than 8 MiB use one request each. If some entries of a batch fail, the command retries these entries. The log shows the keys that failed. Before, it uploaded each entry with a separate request.
   - Scans at most 16 files at the same time. Before, it scanned one file at a time. If a file cannot be processed, the error message shows the file path.
   - Compresses files in parallel on the Node.js thread pool. Before, it compressed one file at a time. The CLI sets `UV_THREADPOOL_SIZE` to the number of CPU cores (4 to 16), if it is not set.

### Updated

- Scaffolded apps use `@fastly/js-compute` `^4.0.0`.
- Update `toml` to 5.0.1. This fixes security advisories in `toml` 4.1.2 and earlier ([GHSA-82x6-q7mm-w9cf](https://github.com/advisories/GHSA-82x6-q7mm-w9cf), [GHSA-v5mp-jgw5-2x6j](https://github.com/advisories/GHSA-v5mp-jgw5-2x6j)), and in `toml` 5.0.0 and earlier ([GHSA-4qx8-w7c3-pj3p](https://github.com/advisories/GHSA-4qx8-w7c3-pj3p), [GHSA-9j65-hcg3-gc64](https://github.com/advisories/GHSA-9j65-hcg3-gc64), [GHSA-9qmh-m7c6-f92p](https://github.com/advisories/GHSA-9qmh-m7c6-f92p)). Reading the Service ID also works now with a `fastly.toml` that uses dotted keys, such as `backends.origin.url = "..."`.

### Deprecated

- Scaffolding: `--public-dir` is deprecated, and a future version will remove it. The scaffolder shows a warning if you use it. This option was added for module assets, which this package no longer supports. If you do not use `--public-dir`, the public directory is the same as `--root-dir`, and nothing changes for you.

- `server.publicDirPrefix` in `publish-content.config.js` is deprecated, and a future version will remove it. `publish-content` shows a warning if it is not empty. The scaffolder no longer writes it, unless you use `--public-dir`. The server still uses it for collections that you publish with it. To stop using it, see `MIGRATING.md`.

### Fixed

- `304 Not Modified` responses now keep the `ETag`, `Vary`, `Cache-Control`, `Content-Location`, and `Expires` headers of the full response. Before, these headers were missing because of a wrong check.

- `publish-content` stops with an error if an upload fails. Before, it showed the error and then saved the index. The index then referred to files that were not in storage.

- `clean` stops with an error if it cannot read a collection index. Before, it continued and deleted the files of that collection.

- `clean` and `collections delete` exit with an error if a delete operation fails. Before, they showed "Completed".

- `PublisherServer` in a reused sandbox (if the app turns on sandbox reuse): the settings and the index of a collection stayed in memory for the life of the sandbox. Thus, after a publish, the sandbox served the old content, and it served a collection after it expired. `beginRequest()` (which `serveRequest()` calls) now clears them.
   - `setActiveCollectionName()` accepts `null`, which selects the default collection. In a reused sandbox, the active collection stays set from the previous request, so call it for each request.

- Scaffolding: if `--public-dir` was under `--root-dir`, the generated `publish-content.config.js` set `publicDirPrefix` to an empty string. Thus the server did not find the files, and it returned 404 for all requests. `publicDirPrefix` is now the path of the public directory, relative to the root directory (for example `/public`).

- `collectionSelector.fromCookie()`: the activate and reset paths now accept only a path on the same site for `redirectTo`. Any other value redirects to `/`. The activate path returns `400` for a `collection` value with characters that a cookie value cannot have, and sets no cookie. (7.0.9 has the same fix.)

- `PublisherServer` compares the body of each file with the size in the file's metadata. Storage can return a body that does not have this size for a short time, for example a KV Store entry whose metadata reached the POP before its body. Before, such a body was served as a complete `200` response, and a CDN or a cache in front of the service could keep it. Now an empty body makes `serveRequest()` and `serveAsset()` throw an error before the response starts, and any other mismatch stops the response with a stream error, so that the client sees an incomplete response. The server logs the file, the expected size, and the actual size.

## [7.0.8] - 2026-10-14

### Added

- Add content types for `.avif` and `.jxl` images

### Updated

- Update to CLI v16
- Support `@fastly/js-compute` 4. The peer dependency is now `^3.33.2 || ^4.0.0`.

### Fixed

- `.tif`/`.tiff` files were served as `image/png`, now `image/tiff`

## [7.0.7] - 2026-07-16

- Update to CLI v15

## [7.0.6] - 2026-02-13

### Updated

- Release to npmjs using updated CI workflow

## [7.0.5] - 2026-02-03

### Added

- Add application/wasm to default content types

## [7.0.4] - 2026-01-07

### Added

- Publish to GitHub packages as well
- Use NPM trusted publishing for publishing to npmjs.com

## [7.0.3] - 2025-09-29

### Fixed

- Use pathToFileURL so that import() works under ESM across platforms [#38](https://github.com/fastly/compute-js-static-publish/issues/38)

## [7.0.2] - 2025-09-16

### Fixed

- Fix script listed in readme instructions
- Handle symlinks properly in file enumeration [#41](https://github.com/fastly/compute-js-static-publish/issues/41)

## [7.0.1] - 2025-04-24

### Fixed

- Add `@latest` to examples of calling the app in scaffolding mode.

## [7.0.0] - 2025-04-24

> [!NOTE]
> Breaking release. Every project will need a re-scaffold.

### Added

- Named Collections
   - Support for named collections of assets that are managed together and can be individually previewed.
   - Expiration trio: --expires-in, --expires-at, --expires-never.
   - Collection selector utilities that can be run at the edge code to activate a collection.
   - Default collection never expires.

- git-style subcommands
   - Actions separated into subcommands, such as `clean`, `publish-content`, and `collections`.
   - Dry-run mode (--dry-run) for commands that mutates KV or disk.

- KV Store
   - Bytes of assets are stored in the Fastly KV Store.
   - Items in the KV Store are keyed by the hash of the file, keeping storage efficient and deduplicated, even across collections.
   - Metadata (file sizes, encodings, compression) for static assets is stored in KV Store Item metadata.
   - Large-object chunking: files > 20 MB are split into segments behind the scenes and reassembled at read time.
   - Upload process has been optimized - files are uploaded in parallel, and are only compressed and uploaded when necessary.
   - Automatic retry with exponential back-off when the Fastly KV API rate-limits a burst of uploads.
   - Fully supported in the local development environment during development.
   - `--local` flag for all management commands. Passing this flag makes the command operate on the local KV Store instead of the Fastly KV Store.

### Changed

- Separate config files:
   - `static-publisher.rc.js` now owns behavior that is common to the scaffolded Compute app
   - publish-time settings are in `publish-content.config.js`.

- Script names in the scaffold are now grouped by environment: `dev:publish`, `dev:start`, `fastly:publish`, `fastly:deploy`.

- Asset inclusion test renamed to `kvStoreAssetInclusionTest` and now expects a boolean return value.

### Removed / Deprecated
 
- This tool drops `wasm-inline`, and no longer inlines bytes of assets into the Wasm binary. 

- Static files metadata is no longer stored in the Wasm binary, 

- This tool drops `moduleAssets`.

## [6.3.0] - 2025-03-19

### Added

- feat: Added content type for WebP images
- Added example of adding a custom content type to README 

### Fixed

- fix: Content Type test regexes were not checking period correctly

### Updated

- Uses new webpack recommendations from webpack starter kit
- Minor updates to migration guide 

## [6.2.0] - 2024-11-27

### Added

-　Scaffolded application now uses @fastly/cli npm package to access the Fastly CLI

### Updated

- Improved README to clarify command line args syntax
- Improved README to clarify KV Store mode usage
- Improved README to clarify application generation and iteration

## [6.1.1] - 2024-10-03

### Fixed

- fix: Windows compatibility issues (JohanLi)
- fix: allow for dots in KV Store name (NeilHanlon)

## [6.1.0] - 2024-03-22

### Added

- feat: add getJson() to ContentAsset

## [6.0.0] - 2024-01-26

### Updated

- Add "static content root dir" to cleanly separate generated files

## [5.2.1] - 2023-11-14

### Updated

- Apply "Compute" branding change.

## [5.2.0] - 2023-09-19

### Changed

- Use `@fastly/js-compute@3` for dev
- Make generated project use `@fastly/js-compute@3`

## [5.1.2] - 2023-09-19

### Added

- Added support for `@fastly/js-compute` 3.0.0

## [5.1.1] - 2023-07-06

### Fixed

- Fix: Specify full path in import directives in generated files to allow use in projects with "type": "module".

## [5.1.0] - 2023-06-12

### Fixed

- Fix: Correct package.json created by init-app to reference fastly/js-compute@2 (#8)

## [5.0.2] - 2023-05-25

### Updated

- README updates

## [5.0.1] - 2023-05-19

### Fixed

- Avoid a crash caused by extra output when `fastly` CLI tool detects a newer available version.

## [5.0.0] - 2023-05-19

### Changed

- Update to js-compute@2.0.0
- BREAKING: To correspond with Fastly's finalization of the name of KV Store,
    all references have been updated to that naming. 

## [4.2.1] - 2023-05-06

### Fixed

- Fix parsing of contentTypes[] in static-publish.rc.js

## [4.2.0] - 2023-04-26

### Fixed

- Avoid a crash when the project doesn't have devDependencies in package.json.

## [4.1.0] - 2023-04-05

### Added

- Added 'bytes' and 'string' content asset types usable during testing.
- AssetManager: added `getAssetKeys` method
- ContentAsset: added `isLocal` property

### Changed

- Modified metadata to use string identifiers such as 'wasm-inline' and 'object-store'
  instead of a single "isInline" boolean value. This allows other stores to be used during
  tests.
- Compute-Js Content Assets ('wasm-inline' and 'object-store') are only included when
  `@fastly/compute-js-static-publish/build/compute-js` is imported.

### Fixed

- Fixed type of imported metadata file in clean-object-store program.

## [4.0.0] - 2023-03-23

### Added

- Cleaner separation between Content Assets and Module Assets: applications can define which files
  generate which type of asset.
- Object Store mode: Content Assets can selectively be uploaded to and served from the Object Store, allowing the Wasm binary to be much smaller.
- Defined `StoreEntry`, a common interface that can be used to stream data from content assets, regardless of whether that
  data exists inlined into the Wasm artifact or uploaded to Object Store.
- Added support for Brotli and Gzip compression. These assets are pre-compressed at publish time and uploaded alongside
  their raw counterparts, rather than using runtime compression. This feature is enabled automatically if Object Store mode
  is used, and can be selectively enabled otherwise.
- Added support for returning `304 Not Modified` status based on `If-None-Match` and `If-Modified-Since` request headers.
- A `PublisherServer` class that maps incoming requests to asset paths.
- Content and metadata available to your application.
- Load JavaScript module assets as code into your Compute JavaScript application.
- `clean-object-store` mode can be used to remove no-longer-used entries from the Object Store.
- Moved [Migration Guide](./MIGRATING.md) into its own separate file with even more information.
- Exported `getObjectStoreKeysFromMetadata()` metadata handling utility from main package. 
- Exported `getDefaultContentTypes()` and other content type utilities from main package. 
- Added preset for Vue (https://vuejs.org/).
- Added preset for Astro (https://astro.build/).

### Changed

- Webpack is no longer required as a dependency, and is disabled by default. If you wish to use Webpack, you can enable
  it through the `--webpack` command line option during project scaffolding.
- No longer uses Expressly to route requests. `index.js` has been simplified using the `PublisherServer` class instead.
- Separated `--root-dir` and `--public-dir`. The public directory is now a `PublisherServer` configuration that represents
  the subset of the published files that map to the web root. This effectively adds the ability to include files in the
  publishing that aren't accessible from the web (at least through `PublisherServer`).
- `static-publish.rc.js` cleaned up:
  - Items related to including/excluding files reorganized;
  - `PublisherServer`-specific settings moved to `server` key.
- Moved default content types into the main package.
- Updated to TypeScript 5 

## [3.6.0] - 2023-02-28

### Added

- Made testing against default content types easier
- Exported types for default-content-types.cjs

  It's now possible to do something like this: 
  ```typescript
  import { defaultContentTypes, testFileContentType } from "@fastly/compute-js-static-publish/resources/default-content-types";
  const testResult = testFileContentType(defaultContentTypes, '/path/to/file.json');
  testResult.binary // false 
  testResult.type // application/json 
  ```

## [3.5.0] - 2023-02-24

### Fixed

- Update generated package.json and fastly.toml to recommended setup
- Updated documentation on migration

## [3.4.0] - 2023-02-16

### Fixed

- SPA and 404 files were being left out
- Corrected typing of loadModule function

## [3.3.0] - 2023-02-16

### Added

- Make assets map available on the StaticAssets object.
- In addition to exporting module assets as [static `import` statements](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import),
    they can alternatively be exported as [`import()` calls](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import).
    At the current time, this feature requires a bundler that supports the `import()` function, such as [Webpack](https://webpack.js.org). 

## [3.2.1] - 2023-01-30

### Added

- Export additional TypeScript types: AssetBase, StringAsset, and Binary Asset

## [3.2.0] - 2023-01-13

### Fixed

- Added `type` field that had been missing from asset entry
- Content for binary files is now typed as `Uint8Array` rather than `ArrayBuffer`

## [3.1.0] - 2023-01-11

### Added

- Generate statics.d.ts alongside static.js helpful for TypeScript
- Export Config type to describe shape of static-publish.rc.js
- Generated static files have descriptive notice

## [3.0.1] - 2022-12-23

### Fixed

- Updated generated app to @fastly/compute-js-static-publish@3.0.1

## [3.0.0] - 2022-12-23

### Changed

- Updated to @fastly/js-compute@1.0.1
- Updated generated app to @fastly/js-compute@1.0.1
- Updated generated app to @fastly/express@1.0.0-beta.2
- Improve mechanism of serving static files by copying them into the static content dir and using `includeBytes()`, rather than using asset modules

### Fixed

- Enable minimize in `webpack.config.js`

## [2.4.2] - 2022-12-21

### Changed

- auto-index now also applies to request paths that do not have a trailing slash 

## [2.4.1] - 2022-12-02

### Fixed

- Added missing devDependency to `@fastly/compute-js-static-publish`

## [2.4.0] - 2022-12-02

### Changed

- Updated to js-compute@0.5.12
- Updated generated app to js-compute@0.5.12
- Updated generated app's webpack and webpack-cli versions
- Use atob() and removed dependency on Buffer

[unreleased]: https://github.com/fastly/compute-js-static-publish/compare/v8.0.0...HEAD
[8.0.0]: https://github.com/fastly/compute-js-static-publish/compare/v7.0.8...v8.0.0
[7.0.8]: https://github.com/fastly/compute-js-static-publish/compare/v7.0.7...v7.0.8
[7.0.7]: https://github.com/fastly/compute-js-static-publish/compare/v7.0.6...v7.0.7
[7.0.6]: https://github.com/fastly/compute-js-static-publish/compare/v7.0.5...v7.0.6
[7.0.5]: https://github.com/fastly/compute-js-static-publish/compare/v7.0.4...v7.0.5
[7.0.4]: https://github.com/fastly/compute-js-static-publish/compare/v7.0.3...v7.0.4
[7.0.3]: https://github.com/fastly/compute-js-static-publish/compare/v7.0.2...v7.0.3
[7.0.2]: https://github.com/fastly/compute-js-static-publish/compare/v7.0.1...v7.0.2
[7.0.1]: https://github.com/fastly/compute-js-static-publish/compare/v7.0.0...v7.0.1
[7.0.0]: https://github.com/fastly/compute-js-static-publish/compare/v6.3.0...v7.0.0
[6.3.0]: https://github.com/fastly/compute-js-static-publish/compare/v6.2.0...v6.3.0
[6.2.0]: https://github.com/fastly/compute-js-static-publish/compare/v6.1.1...v6.2.0
[6.1.1]: https://github.com/fastly/compute-js-static-publish/compare/v6.1.0...v6.1.1
[6.1.0]: https://github.com/fastly/compute-js-static-publish/compare/v6.0.0...v6.1.0
[6.0.0]: https://github.com/fastly/compute-js-static-publish/compare/v5.2.1...v6.0.0
[5.2.1]: https://github.com/fastly/compute-js-static-publish/compare/v5.2.0...v5.2.1
[5.2.0]: https://github.com/fastly/compute-js-static-publish/compare/v5.1.2...v5.2.0
[5.1.2]: https://github.com/fastly/compute-js-static-publish/compare/v5.1.1...v5.1.2
[5.1.1]: https://github.com/fastly/compute-js-static-publish/compare/v5.1.0...v5.1.1
[5.1.0]: https://github.com/fastly/compute-js-static-publish/compare/v5.0.2...v5.1.0
[5.0.2]: https://github.com/fastly/compute-js-static-publish/compare/v5.0.1...v5.0.2
[5.0.1]: https://github.com/fastly/compute-js-static-publish/compare/v5.0.0...v5.0.1
[5.0.0]: https://github.com/fastly/compute-js-static-publish/compare/v4.2.1...v5.0.0
[4.2.1]: https://github.com/fastly/compute-js-static-publish/compare/v4.2.0...v4.2.1
[4.2.0]: https://github.com/fastly/compute-js-static-publish/compare/v4.1.0...v4.2.0
[4.1.0]: https://github.com/fastly/compute-js-static-publish/compare/v4.0.0...v4.1.0
[4.0.0]: https://github.com/fastly/compute-js-static-publish/compare/v3.6.0...v4.0.0
[3.6.0]: https://github.com/fastly/compute-js-static-publish/compare/v3.5.0...v3.6.0
[3.5.0]: https://github.com/fastly/compute-js-static-publish/compare/v3.4.0...v3.5.0
[3.4.0]: https://github.com/fastly/compute-js-static-publish/compare/v3.3.0...v3.4.0
[3.3.0]: https://github.com/fastly/compute-js-static-publish/compare/v3.2.1...v3.3.0
[3.2.1]: https://github.com/fastly/compute-js-static-publish/compare/v3.2.0...v3.2.1
[3.2.0]: https://github.com/fastly/compute-js-static-publish/compare/v3.1.0...v3.2.0
[3.1.0]: https://github.com/fastly/compute-js-static-publish/compare/v3.0.1...v3.1.0
[3.0.1]: https://github.com/fastly/compute-js-static-publish/compare/v3.0.0...v3.0.1
[3.0.0]: https://github.com/fastly/compute-js-static-publish/compare/v2.4.2...v3.0.0
[2.4.2]: https://github.com/fastly/compute-js-static-publish/compare/v2.4.1...v2.4.2
[2.4.1]: https://github.com/fastly/compute-js-static-publish/compare/v2.4.0...v2.4.1
[2.4.0]: https://github.com/fastly/compute-js-static-publish/releases/tag/v2.4.0
