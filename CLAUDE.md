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
```

There is no test suite and no linter. `npm test` is a stub that fails on purpose. To examine a change, type-check it with `npm run build`.

For an end-to-end test, scaffold a project that uses this checkout. The scaffolder keeps a `file:` dependency on this package as an absolute path, so the generated app uses your local build (see `src/cli/util/package.ts`). Then run `npm run dev:publish` and `npm run dev:start` in the generated `compute-js/` directory.

`--local` mode does not list the keys in storage. Thus it does not test the skip logic in `publish-content`. To test that logic, publish to a real test KV Store or S3 bucket. Delete the working directory (`static-publisher/`) between runs, to simulate a new CI checkout.

After a rebuild, the bin in `node_modules/.bin` of a scaffolded app can lose its execute bit. If this occurs, run `node <repo>/build/cli/cli/index.js ...` from the `compute-js/` directory.

Because `rootDir` is `./src`, the output has one more directory level: the bin is `build/cli/cli/index.js`, and the library entry is `build/server/server/index.js`. The tsconfigs list `src/shared` in `include`, but that directory does not exist. The shared code is in `src/models`. Each build compiles it through imports.

The server build must not use Node APIs. It uses `/// <reference types="@fastly/js-compute" />` and web-standard APIs only.

## Architecture

### CLI mode selection

`src/cli/index.ts` selects the mode from the current directory:

- If there is no `./static-publish.rc.js`, it runs the **scaffold** command (`commands/scaffold/index.ts`). This command generates the `compute-js/` app: `fastly.toml`, `package.json`, `static-publish.rc.js`, `publish-content.config.js`, and `src/index.js`.
- If not, it runs the **management** commands (`commands/manage/`): `publish-content`, `clean`, and `collections list|delete|promote|update-expiration`.

### Storage providers (pluggable, in both parts)

Both parts use a registry of builder functions. Each entry point calls `registerStorageProviderBuilder(...)`. `loadStorageProviderFromStaticPublishRc` returns the first builder result that is not null for `rc.storageMode`.

- CLI (`src/cli/storage/`):
  - `kv-store-provider` uses the Fastly API.
  - `kv-store-local-provider` is for the `--local` flag. It writes `static-publisher/kvstore.json` and the prepared files, so that `fastly compute serve` can simulate the KV Store.
  - `s3-storage-provider` uses the AWS SDK.
  - The CLI interface has list, get, submit, delete, batch, chunking, and surrogate-key purge.
- Server (`src/server/storage/`): `kv-store-provider` and `s3-storage-provider`. Both use a small `getEntry(key, tags)` interface. S3 credentials come from a Secret Store. `src/server/index.ts` exports the setters.

### Storage key layout (shared contract)

All keys start with `publishId` (default `'default'`):

- `<publishId>_index_<collection>`: It maps each asset path to an `AssetEntry` (key `sha256:<hash>`, content type, variants, and more). The metadata of this entry has the collection metadata, for example the expiration.
- `<publishId>_settings_<collection>`: The normalized `server` section of `publish-content.config.js`. The CLI saves it when it publishes.
- `<publishId>_files_sha256_<hash>[_<variant>]`: The file content, with `br`/`gzip` variants. The key is the hash of the content. Large files are split into chunks.

All collections share the files, because the key is the hash of the content. `clean` removes expired collections and the `_files_` keys that no index uses. After a publish, the CLI purges the surrogate key `<publishId>-<collection>`. The server adds this tag when it reads.

### `publish-content` flow

1. If `--overwrite-existing` and `--local` are not set, list the `<publishId>_files_` keys one time. The KV Store list uses `consistency=strong`.
2. Scan the files with `concurrentMap()`, at most 16 at a time. For each variant: if its key is in the list, skip the variant. Do not compress, hash, or upload it.
   - For a chunked original, all keys `_1`, `_2`, … must be in the list.
   - Skip a compressed variant only if the original fits in one chunk. The chunk count of a compressed variant is not known before compression.
3. Upload a compressed variant only if it is smaller than the original. Thus, if a compressed variant is in storage, the index keeps it. Variants that are not smaller are compressed again at each publish. Most of these are very small files.
4. `applyBatch(batch, { existingKeys })`:
   - The KV provider splits files that are larger than 20 MiB into chunks (S3 does not use chunks). It removes the chunks that are in storage. Then it uploads NDJSON batches of at most 256 items / 8 MiB. Larger entries use one PUT each.
   - The S3 provider uploads one `PutObject` for each entry.
5. The CLI writes the index and the settings only after all uploads are successful.

KV batch endpoint behavior (measured, not documented):

- No limit on the item count up to 25,000 items. No limit on the request size up to 133 MiB.
- A limit of approximately 32 MiB for each NDJSON line. A longer line causes a `503`. The lines before it are stored.
- A `207` response lists the failed keys in `errors[].key`. The CLI retries only these keys.

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
2. Load the settings and the index for that collection, and keep them in a cache. An expired collection is the same as a collection that does not exist.
3. Find the path with `publicDir`, `autoIndex`, and `autoExt`.
4. If the request accepts HTML, use the SPA file or the 404 file when no file matches.
5. Select an encoding variant from `Accept-Encoding` and `allowedEncodings`.
6. Process `If-None-Match` and `If-Modified-Since` (304).
7. Set the cache headers. Files in `staticItems` get a long TTL.

## Branches and releases

- `main` is the v7 line. `v8` is the v8 line (S3 support, now in beta). Older major versions have their own branches (`v6`, `v7`, ...).
- Fixes usually go to both `main` and `v8`. `beta` gets the changes from `v8` at release time.
- `.github/workflows/ci-release.yaml` publishes a release when a `v*` tag is pushed. It uses the reusable workflows in `fastly/devex-reusable-workflows` (npm trusted publishing, and GitHub Packages). The first prerelease identifier becomes the npm dist-tag (`v8.0.0-beta.9` gives `beta`). A tag runs the workflow file in the tagged commit. Thus workflow changes must be on the branch that you tag.
- `prepublishOnly` replaces `README.md` with `README.short.md` in the package. Thus `README.short.md` is the README on npm.
- The version change commits for betas are on `beta`. Thus `package.json` on `v8` can show an older version.
- To find changes to port between `main` and `v8`, use `git cherry -v origin/v8 origin/main`. This command shows manual ports as missing, so compare the content. Some differences are intentional: `package.json`, the tsconfigs, and much of `src` (v8 has a separate CLI and server build, and storage providers).
- Record changes that users can see in `CHANGELOG.md`, under `[unreleased]` (Keep a Changelog format). `MIGRATING.md` has the instructions to upgrade to a new major version.
