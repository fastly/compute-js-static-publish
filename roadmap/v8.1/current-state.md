# Current state

Facts about the current code that the design depends on. Read from the 8.0 code (`main` with the 8.0 PRs #99 to #103) on 2026-10-16 and 2026-10-18.

## CLI dispatch

`src/cli/index.ts` selects the mode from the **current directory**:

- No `./static-publish.rc.js`: **scaffolding mode** (`scaffold/index.ts`), driven only by flags (`--root-dir`, `--storage-mode`, …).
- `./static-publish.rc.js`: **management mode**: `publish-content`, `clean`, `collections list|promote|update-expiration|delete`.

Thus each management command must run from in the scaffolded app dir. Managed mode adds a third case (see [design.md §9](design.md#9-managed-mode-items-13-to-19)).

### Disposable apps today

Scaffolding takes every setting as a flag, and the publish and management commands take flags or env vars for what they would otherwise read from files (`--fastly-service-id` / `FASTLY_SERVICE_ID`, `--brotli-quality`, `--root-dir`, the S3 keys). Thus CI can scaffold a new app on the runner for each deploy, and publish with no config kept between builds.

Scaffold flags: `--storage-mode`, `--kv-store-name`, `--s3-region`, `--s3-bucket`, `--s3-endpoint`, `--root-dir`, `--output`, `--static-publisher-working-dir`, `--publish-id`, `--name`, `--description`, `--author`, `--service-id`, `--public-dir` (deprecated in 8.0), `--static-dir`, `--spa`, `--not-found-page`, `--auto-index`, `--auto-ext`. (`--template` is on the Hono branch only.)

`defaultCollectionName` is always `live` in scaffolding (no flag). item 2 adds `--default-collection-name`.

## What scaffolding makes (`compute-js/` by default)

| File | Role | In the Wasm binary? |
|---|---|---|
| `package.json` | Scripts. Dependencies: `@fastly/js-compute ^4`. Dev dependencies: `@fastly/cli`, this package (the same version as the CLI) | Build input |
| `fastly.toml` | Name, optional `service_id`, `[scripts] build`, `[local_server]` and `[setup]` (a KV Store; or for S3, the backend `s3_storage` and the Secret Store `S3_CREDENTIALS`) | Deploy input |
| `static-publish.rc.js` | `storageMode`, `kvStore` or `s3` (region, bucket, endpoint), `publishId` (default `default`), `defaultCollectionName` (`live`), `staticPublisherWorkingDir` | **Yes** |
| `publish-content.config.js` | `rootDir`, `staticItems`, `spaFile`, `notFoundPageFile`, `autoIndex`, `autoExt`, compression (`publicDirPrefix` only with `--public-dir`, after #100) | No: read at publish time, saved for each collection as server settings |
| `src/index.js` | A fixed string in `scaffold/index.ts` | **Yes** |
| `.gitignore` | `node_modules`, `bin`, `pkg`, the working dir | – |

Then scaffolding runs `npm install` in the app dir.

**Thus** a deploy is necessary only when `src/index.js`, `static-publish.rc.js`, the dependencies, or `fastly.toml` change. Changes to the content and to `publish-content.config.js` need only `publish-content`.

## Scripts in `package.json`

- Always: `dev:start` (`fastly compute serve`), `fastly:deploy` (`fastly compute publish`), `build` (`js-compute-runtime ./src/index.js ./bin/main.wasm`).
- KV Store: `dev:publish` (`publish-content --local`), `fastly:publish`.
- S3: `s3:publish`.

## Service ID

`util/service-id.ts` (used for the purge after a publish) looks at `--fastly-service-id`, then `FASTLY_SERVICE_ID`, then `service_id` in `fastly.toml`. The Fastly CLI writes `service_id` into `fastly.toml` after the first `fastly compute publish`, which is **in the app dir**.

## S3 mode at runtime

- The deployed app reads the credentials from the Secret Store **`S3_CREDENTIALS`** (keys `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`; the names can be changed with `setSecretStoreForS3Credentials()` and similar functions), and reaches the bucket through the backend **`s3_storage`**.
- The `[setup]` section of `fastly.toml` makes both at the first deploy (after #100, which fixes the `entries` key). Locally, `[local_server]` takes them from env vars with the same names.
- The CLI takes `--s3-access-key-id` and `--s3-secret-access-key`, or the env vars `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`.

## Fastly CLI behavior (checked in its source)

- `[setup]` is used only when a service is created (the first deploy). It is ignored if `service_id` is set.
- Secret Store entries in `[setup]` are under `entries` (not `items`). In interactive mode the CLI asks for each value (hidden input). In non-interactive mode, it fails with `value cannot be blank`, even if a store with that name exists.
- Backends in `[setup]`: in interactive mode, the CLI asks for the hostname and the port, with the values from `fastly.toml` as defaults.
- `fastly compute deploy --comment "…"` sets the version comment before the version is activated. With `--non-interactive` and no service ID, `deploy` makes a new service with the name from the manifest.

## Collections

Publish to any `--collection-name`; expiry with `--expires-in|at|never`; `collections promote --collection-name X --to Y` copies the index and the settings; `clean --delete-expired-collections`. After a publish, the CLI purges the surrogate key `<publishId>-<collectionName>` if it has a service ID and a token. **Collection names are not checked** (item 1 adds the rule). The index metadata (after #103) has `requires` and keeps unknown fields.

## Templates (Hono branch only)

On `feat/v8-hono-template`, `scaffold/templates/index.ts` defines `AppTemplate = { dependencies, indexJs }`, with `plain` and `hono`. A template controls only `src/index.js` and extra dependencies. 8.1 replaces this with the file-based `AppTemplate` (see [design.md §4](design.md#4-templates-internal-item-3)).

## Collection selectors

`src/server/collection-selector/` has `from-config-store.ts`, `from-cookie.ts`, `from-request.ts`, and `request-collection-selector.ts`. `CookieCollectionSelector` takes `cookieName` (default `publisher-collection`), `activatePath` (default `/activate`), `resetPath` (default `/reset`), and `maxAge`. It writes the `activate` value into `Set-Cookie` with no check (item 1 fixes this).
