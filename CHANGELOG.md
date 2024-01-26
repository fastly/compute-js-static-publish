# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [unreleased]

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

[unreleased]: https://github.com/fastly/compute-js-static-publish/compare/v5.2.1...HEAD
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
