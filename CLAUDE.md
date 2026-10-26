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

All keys start with `publishId` (default `'default'`):

- `<publishId>_index_<collection>`: It maps each asset path to an `AssetEntry` (key `sha256:<hash>`, content type, variants, and more). The metadata of this entry has the collection metadata (`IndexMetadata`): `publishedTime`, `expirationTime`, and `requires`. `requires` lists the features that the server must support to serve the collection. A server does not serve a collection if `requires` has a feature that is not in `SUPPORTED_INDEX_FEATURES` (`models/server/index.ts`). This applies also to the default collection. When a new feature changes the index, the settings, or the key layout in a way that an older server would get wrong, add the feature to `SUPPORTED_INDEX_FEATURES` (a short kebab-case name, without a comma, because the metadata separates the names with commas), and make the CLI add it to `requires` only if the published content uses it. `decodeIndexMetadata()` keeps the fields that it does not know, so that `promote` and `update-expiration` do not remove them.
- `<publishId>_settings_<collection>`: The normalized `server` section of `publish-content.config.js`. The CLI saves it when it publishes.
- `<publishId>_files_sha256_<hash>[_<variant>]`: The file content, with `br`/`gzip` variants. The key is the hash of the content. Large files are split into chunks.

All collections share the files, because the key is the hash of the content. `clean` removes expired collections and the `_files_` keys that no index uses. After a publish or a `collections delete`, the CLI purges the surrogate key `<publishId>-<collection>` (`purgeCollection()`). The server adds this tag when it reads, and to the responses in the response cache. The purge runs in KV Store and S3 modes (not with `--local`), only if the CLI finds a Service ID (`--fastly-service-id`, then `FASTLY_SERVICE_ID`, then `service_id` in `fastly.toml`, the same order as the Fastly CLI; see `util/service-id.ts`). `loadPurgeTarget()` checks this before the upload or the delete, and fails if there is a Service ID but no API token. It is a soft purge. A purge without the `Fastly-Purge-Environment: staging` header does not clear the cache of a staged service version: `--purge-environment` selects `production` (the default, no header), `staging`, or both, and the CLI sends one purge for each. A failed purge is only a warning, because the change to storage is already done.

### `publish-content` flow

1. If `--overwrite-existing` and `--local` are not set, list the `<publishId>_files_sha256_` keys one time. The KV Store list uses `consistency=strong`. `getStorageKeysByHexPrefix()` runs 16 listings at the same time, one for each hex digit after the prefix, because a listing gets its pages one after another (about 0.36 s for each 1,000 keys on S3 in a test).
2. Scan the files with `concurrentMap()`, at most 16 at a time. For each variant: if its key is in the list, skip the variant. Do not compress, hash, or upload it.
   - For a chunked original, all keys `_1`, `_2`, … must be in the list.
   - Skip a compressed variant only if the original fits in one chunk. The chunk count of a compressed variant is not known before compression.
3. Upload a compressed variant only if it is smaller than the original. Thus, if a compressed variant is in storage, the index keeps it. Variants that are not smaller are compressed again at each publish. Most of these are very small files.
   - Compression uses async zlib, so it runs in parallel on the libuv thread pool. `src/cli/index.ts` sets `UV_THREADPOOL_SIZE` (4 to 16, from the CPU count) if it is not set. Do not use the `*Sync` zlib functions: they block the event loop, so files are compressed one at a time.
   - `brotliQuality` in `publish-content.config.js` sets the brotli quality (default 11, the slowest). If it is not set, the output is the same as the zlib default.
4. `applyBatch(batch, { existingKeys })`:
   - The KV provider splits files that are larger than 20 MiB into chunks (S3 does not use chunks). It removes the chunks that are in storage. Then it uploads NDJSON batches of at most 256 items / 8 MiB. Larger entries use one PUT each.
   - The S3 provider uploads one `PutObject` for each entry, 64 at a time by default (`--s3-upload-concurrency`). The S3 client gets an HTTP agent with enough sockets for this; the SDK default is 50.
5. The CLI writes the index and the settings only after all uploads are successful.

`src/cli/storage/CLAUDE.md` has the measured limits of the KV batch endpoint.

### Error handling in concurrent loops

`concurrentParallel()` and `StorageProvider.doConcurrentParallel()` retry retryable errors. Then, by default, they log the failure and continue. Pass `throwOnError: true` if a later step needs all items to be successful. Examples:

- Uploads must be successful before the CLI writes the index.
- `clean` must read all indexes before it deletes items. Before this rule, a read error that was not reported caused `clean` to delete the files of a live collection.

### Two config files in a scaffolded app

- `static-publish.rc.js` (`models/config/static-publish-rc.ts`): the storage mode, the store or bucket, `publishId`, and `defaultCollectionName`. The Wasm binary **contains a copy** of this file. Thus, if you change it, you must rebuild the app.
- `publish-content.config.js` (`models/config/publish-content-config.ts`): the publish-time filters, compression, and content types. It also has a `server` section, which the CLI stores for each collection. If you change it, you must publish again. A rebuild is not necessary.

### PublisherServer request flow

`src/server/publisher-server/index.ts`:

1. Select the active collection. This is the default collection, or the collection from `setActiveCollectionName`. The helpers are in `collection-selector/` (for example host, cookie, config store).
   `beginRequest()` resets the per-request state: the `Server-Timing` collector (`util/server-timing.ts`), which is on only if `setServerTimingRequestHeader()` names a header that the request has.
2. If `setResponseCache()` is set, `serveCached()` (`response-cache.ts`) looks up the whole response in the Core Cache, keyed by publish ID, collection, path, and normalized `Accept-Encoding`. A hit skips steps 3 to 8. A miss uses `transactionLookup()`, so concurrent misses wait for one fill. The fill runs steps 3 to 8 with a `GET` that has no conditional headers, and caches a `200`, a `404`, or "not found". Conditional requests and `HEAD` are then answered from the cached response. The fill reads the whole body (`readBodyUpTo()`) before `insert()`, and calls `cancel()` if the read fails. A body larger than `maxBodySize` gets a "too large" marker entry, and is served from storage. Do not stream into the entry with `insertAndStreamBack()`: on a real service, a fill that is short, abandoned, or not closed is not stored, but the filler and the waiters still get a short body that ends as if complete. Viceroy is different again: it stores such a fill.
   `serveAsset()` passes the stored body through `checkBodyLength()` (`util/body-length.ts`), which compares it with the variant's `size`. An empty body throws before the response starts. Any other mismatch errors the stream, which resets the response on a real service.
3. Load the settings and the index for that collection, and keep them in a cache. An expired collection is the same as a collection that does not exist.
4. to 8. Find the file, select the encoding, process the conditional headers, and set the cache headers (see the code).

## Branches and releases

- `main` is the v8 line (the latest stable major), and the default branch. Its ruleset ("Require CODEOWNERS Review") applies to the default branch. Thus each PR to `main` needs an approval. Fixes and features for v8 go to `main`.
- Older major versions have their own branches (`v6`, `v7`, ...). Fixes for v7 go to the `v7` branch. There is no `v8` branch. Make it from `main` when the next major merges into `main`.
- The next major (for example `v9`) gets a development branch. Merge PRs to it without approval. Tag its betas on that branch, after a version change commit on that branch. Merge `main` into it often. The final review is the PR that merges it into `main`. Do not make it the default branch, or each PR to it needs an approval.
- There is no `beta` branch. The npm dist-tag comes from the tag name.
- The `release-and-port` skill has the release workflow details and the procedure to port changes between `v7` and `main`.
- Record changes that users can see in `CHANGELOG.md`, under `[unreleased]` (Keep a Changelog format). `MIGRATING.md` has the instructions to upgrade to a new major version.
