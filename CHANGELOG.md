# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [unreleased]

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

[unreleased]: https://github.com/fastly/compute-js-static-publish/compare/v2.4.1...HEAD
[2.4.1]: https://github.com/fastly/compute-js-static-publish/compare/v2.4.1...v2.4.0
[2.4.0]: https://github.com/fastly/compute-js-static-publish/releases/tag/v2.4.0
