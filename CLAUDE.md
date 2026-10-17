# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`@fastly/compute-js-static-publish` is one npm package. It has two parts, and each part compiles separately:

- **CLI** (`src/cli`, Node.js): It scaffolds a Fastly Compute JS app. It publishes static files to storage: the Fastly KV Store, or S3-compatible storage (v8 beta).
- **Server library** (`src/server`, runs in Fastly Compute/Wasm): `PublisherServer`. The scaffolded app imports it to serve the content.

`src/models` has the types and the encode/decode helpers that both parts use. Both parts use the same storage key layout. Thus a change to one part usually needs a change to the other part.

## Commands

```sh
npm run build          # clean + compile both parts
npm run compile:cli    # tsc -p tsconfig.cli.json    -> build/cli   (Node types, ES2021)
npm run compile:server # tsc -p tsconfig.server.json -> build/server (WebWorker lib, no Node types)
npm test               # build, then the unit tests (node:test, test/unit)
npm run test:e2e       # build, then the end-to-end tests (test/e2e)
```

There is no linter. The tests are JavaScript files that import the compiled modules from `build/`, so they do not need a TypeScript runner. The unit tests can import only modules that do not import `fastly:*`. `test/README.md` has the environment variables for the end-to-end tests. Without them, the KV Store and S3 tests are skipped.

The end-to-end tests do these steps automatically. To do them by hand, scaffold a project that uses this checkout. The scaffolder keeps a `file:` dependency on this package as an absolute path, so the generated app uses your local build (see `src/cli/util/package.ts`). Then run `npm run dev:publish` and `npm run dev:start` in the generated `compute-js/` directory.

`--local` mode does not list the keys in storage. Thus it does not test the skip logic in `publish-content`. To test that logic, publish to a real test KV Store or S3 bucket. Delete the working directory (`static-publisher/`) between runs, to simulate a new CI checkout.

After a rebuild, the bin in `node_modules/.bin` of a scaffolded app can lose its execute bit. If this occurs, run `node <repo>/build/cli/cli/index.js ...` from the `compute-js/` directory.

Because `rootDir` is `./src`, the output has one more directory level: the bin is `build/cli/cli/index.js`, and the library entry is `build/server/server/index.js`. The tsconfigs list `src/shared` in `include`, but that directory does not exist. The shared code is in `src/models`. Each build compiles it through imports.

The server build must not use Node APIs. It uses `/// <reference types="@fastly/js-compute" />` and web-standard APIs only.

## Architecture

### Storage providers (pluggable, in both parts)

Both parts use a registry of builder functions. Each entry point calls `registerStorageProviderBuilder(...)`. `loadStorageProviderFromStaticPublishRc` returns the first builder result that is not null for `rc.storageMode`.

- CLI (`src/cli/storage/`):
  - `kv-store-provider` uses the Fastly API.
  - `kv-store-local-provider` is for the `--local` flag. It writes `static-publisher/kvstore.json` and the prepared files, so that `fastly compute serve` can simulate the KV Store.
  - `s3-storage-provider` uses the AWS SDK.
  - The CLI interface has list, get, submit, delete, batch, and chunking. The purge after a change to a collection is not part of it: `publish-content` and `collections delete` do it with `util/purge.ts`, because it is the same for every storage mode.
  - The Fastly API token comes only from `--fastly-api-token` or `FASTLY_API_TOKEN` (`util/api-token.ts`). As of v8, the CLI does not run `fastly profile token`, and the package does not depend on `@fastly/cli`. (The scaffolder still adds `@fastly/cli` to the generated app.)
- Server (`src/server/storage/`): `kv-store-provider` and `s3-storage-provider`. Both use a small `getEntry(key, tags)` interface. S3 credentials come from a Secret Store. `src/server/index.ts` exports the setters.
  - The server's `s3-storage-provider` does not use the AWS SDK. It signs a `GET` with `@smithy/signature-v4` and reads the status code, the body, and the `x-amz-meta-*` headers. The SDK's browser build, which js-compute bundles, parses XML with `DOMParser` (since `@aws-sdk/xml-builder` 3.894.0), and Compute does not have `DOMParser`. Do not import `@aws-sdk/*` in `src/server`.

### Storage key layout (shared contract)

All keys start with `publishId` (default `'default'`). A collection name must be a DNS label (`isValidCollectionName()` in `models/collections/`). The CLI refuses a new collection with another name, and only warns for one that exists. The cookie selector refuses such a name, because the name goes into `Set-Cookie`. The keys:

- `<publishId>_index_<collection>`: It maps each asset path to an `AssetEntry` (key `sha256:<hash>`, content type, variants, and more). The metadata of this entry has the collection metadata (`IndexMetadata`): `publishedTime`, `expirationTime`, and `requires`. `requires` lists the features that the server must support to serve the collection. A server does not serve a collection if `requires` has a feature that is not in `SUPPORTED_INDEX_FEATURES` (`models/server/index.ts`). This applies also to the default collection. When a new feature changes the index, the settings, or the key layout in a way that an older server would get wrong, add the feature to `SUPPORTED_INDEX_FEATURES` (a short kebab-case name, without a comma, because the metadata separates the names with commas), and make the CLI add it to `requires` only if the published content uses it. `decodeIndexMetadata()` keeps the fields that it does not know, so that `promote` and `update-expiration` do not remove them.
  - Hidden files (`hidden` feature): the index key of a hidden file is `hidden:<asset key>` (`HIDDEN_INDEX_KEY_PREFIX` in `models/assets/`). A real asset key always starts with `/`, so no request path matches it. `findAssetEntry()` never looks up a `hidden:` key directly. `serveRequest()` never matches a hidden file; the SPA and 404 fallbacks and `getMatchingAsset(key, { includeHidden: true })` do. `publish-content` adds `hidden` to `requires` only if a file is hidden.
- `<publishId>_settings_<collection>`: The normalized `server` section of `publish-content.config.js`. The CLI saves it when it publishes.
- `<publishId>_files_sha256_<hash>[_<variant>]`: The file content, with `br`/`gzip` variants. The key is the hash of the content. Large files are split into chunks.

All collections share the files, because the key is the hash of the content. `clean` removes expired collections and the `_files_` keys that no index uses. After a publish or a `collections delete`, the CLI purges the surrogate key `<publishId>-<collection>` (`purgeCollection()`). The server adds this tag when it reads, and to the responses in the response cache. The purge runs in KV Store and S3 modes (not with `--local`), only if the CLI finds a Service ID (`--fastly-service-id`, then `FASTLY_SERVICE_ID`, then `service_id` in `fastly.toml`, the same order as the Fastly CLI; see `util/service-id.ts`). `loadPurgeTarget()` checks this before the upload or the delete, and fails if there is a Service ID but no API token. It is a soft purge. A purge without the `Fastly-Purge-Environment: staging` header does not clear the cache of a staged service version: `--purge-environment` selects `production` (the default, no header), `staging`, or both, and the CLI sends one purge for each. A failed purge is only a warning, because the change to storage is already done.

### `publish-content` flow

`src/cli/CLAUDE.md` has the steps of the `publish-content` flow and its skip logic.

### CLI output contract (for CI)

`src/cli/CLAUDE.md` has the exit codes and the `--json` output of the CLI.

### Error handling in concurrent loops

`concurrentParallel()` and `StorageProvider.doConcurrentParallel()` retry retryable errors. Then, by default, they log the failure and continue. Pass `throwOnError: true` if a later step needs all items to be successful. Examples:

- Uploads must be successful before the CLI writes the index.
- `clean` must read all indexes before it deletes items. Before this rule, a read error that was not reported caused `clean` to delete the files of a live collection.

### Generating the app

`src/cli/CLAUDE.md` has how `generateApp()` makes the files of a scaffolded app, and how the tests check them.

### Managed projects (8.1)

`src/cli/CLAUDE.md` has the details of managed projects.

### Two config files in a scaffolded app

- `static-publish.rc.js` (`models/config/static-publish-rc.ts`): the storage mode, the store or bucket, `publishId`, and `defaultCollectionName`. The Wasm binary **contains a copy** of this file. Thus, if you change it, you must rebuild the app.
- `publish-content.config.js` (`models/config/publish-content-config.ts`): the publish-time filters, compression, and content types. It also has a `server` section, which the CLI stores for each collection. If you change it, you must publish again. A rebuild is not necessary.

### Collection selection

`collectionSelection` (types, `validateCollectionSelection()`, patterns, `previewUrl()`) is in `models/config/collection-selection.ts`, so that the CLI can use it. `resolveCollection()` is in `server/collection-selection/` (no `fastly:*` imports, so the unit tests load it). A pattern has exactly one `{collection}`; a name is checked with `isValidCollectionName()` and `allow` before use, and a source with a name that fails is skipped. Every redirect (sticky, activate, reset) goes through `sameSiteLocation()`: a path that starts with exactly one `/`, else `/`. The older `collection-selector/` helpers stay for apps that use them. `PublisherServer` keeps the rc's config (`setCollectionSelection()`). With it, `serveRequest()`/`serveFallback()` check a collection that is not the default (`checkSelectedCollection()`: it reads the index before the response cache, for `onMissing`), and mark its responses (`Cache-Control: private`, `X-Robots-Tag: noindex`). The `plain` template calls `resolveCollection()` in every app. The scaffold flags are parsed in `cli/util/collection-selection-flags.ts`; `generateApp()` throws for `collectionSelection` with a template without `supports.collectionSelection`.

### PublisherServer request flow

`src/server/CLAUDE.md` has the steps that `PublisherServer` does for each request, and the response cache.

## Branches and releases

- `main` is the v8 line (the latest stable major), and the default branch. Its ruleset ("Require CODEOWNERS Review") applies to the default branch. Thus each PR to `main` needs an approval. Fixes and features for v8 go to `main`.
- Older major versions have their own branches (`v6`, `v7`, ...). Fixes for v7 go to the `v7` branch. There is no `v8` branch. Make it from `main` when the next major merges into `main`.
- The next major (for example `v9`) gets a development branch. Merge PRs to it without approval. Tag its betas on that branch, after a version change commit on that branch. Merge `main` into it often. The final review is the PR that merges it into `main`. Do not make it the default branch, or each PR to it needs an approval.
- There is no `beta` branch. The npm dist-tag comes from the tag name.
- The `release-and-port` skill has the release workflow details and the procedure to port changes between `v7` and `main`.
- Record changes that users can see in `CHANGELOG.md`, under `[unreleased]` (Keep a Changelog format). `MIGRATING.md` has the instructions to upgrade to a new major version.
