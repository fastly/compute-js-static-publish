# 8.1 design

All decisions in this file were made on 2026-10-17 and 2026-10-18, unless a date is given. Details that are still to confirm are in [open-items.md](open-items.md).

## 1. Background

### The problem

Every project that uses this package must make a choice:

- **Commit the scaffolded app** (`compute-js/`) to the repo. The user can change it, but it stays at the version that it was scaffolded with. To upgrade, the user edits generated files by hand (thus `MIGRATING.md`).
- **Treat the app as disposable.** This is possible today, but not easy: in CI, scaffold the app on the runner for each deploy, only from flags (`--storage-mode`, `--s3-*`, `--service-id`, `--spa`, …), then publish with flags (`--fastly-service-id`, `--brotli-quality`, …). The flags exist so that no config file has to stay between builds.

What the second pattern does not have:

- **No answer to "is a deploy necessary?"** CI deploys on each run (a slow Compute build and a new service version each time), or makes its own change detection.
- **Not deterministic.** Each scaffold runs a new `npm install` with caret ranges, so two deploys of the same commit can get different versions of `@fastly/js-compute`.
- **The settings are in the workflow YAML,** as a long list of flags, the same in the deploy and the publish steps and in each workflow. There is no local equal: `dev:start` on a laptop needs the same flags again.
- **No way to customize.** To change `src/index.js`, the user must stop using the pattern and commit the app by hand.

**Managed mode makes this pattern a feature of the package:** the flags become a config file in the project dir, and the package adds the fingerprint (is a deploy necessary?), pinned dependencies, local development, and `eject`. Previews (collection selection) and CI support (`--json`, exit codes) make it useful for CI tools, for example a GitHub Action that publishes each push and each PR.

Prior art: Expo's *Continuous Native Generation* (`expo prebuild`), and `eject` of Create React App.

### Why 8.1 and not 9

All of it is an addition: a new project file (`static-publish.project.js`), new commands, a new mode. Existing projects (with a checked-in `compute-js/`) are ejected projects, and they work as before. In 8.1, `scaffold` still makes an ejected project by default; `--managed` is opt-in. To make managed mode the default is a v9 decision.

## 2. Collection names (item 1)

- **Rule:** a DNS label, `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`: lowercase `a-z`, `0-9`, and `-`; 1 to 63 characters; no `-` at the start or the end.
- **Why:** a collection name goes into storage keys (`<publishId>_index_<name>`), into the surrogate key of the purge (`<publishId>-<name>`), into the preview cookie, and (with the `host` source of collection selection) into a hostname. A DNS label is safe in all of them. CI tools that make names from branch names (`feature/Foo_bar`) and PR numbers (`pr-42`) can follow a known rule.
- **Cookie safety:** the rule cannot contain a character that breaks a cookie (`;` `,` `=` space, quotes, `\`, control characters). A unit test checks each one.
- **One function**, `validateCollectionName()`, in a module that does not import `fastly:*`. The CLI and the server both use it.
- **CLI:** a new name that breaks the rule is an error: `publish-content` to a new collection, and `collections promote --to`. An existing collection whose name breaks the rule shows a warning, and it continues to work (publish again, list, promote from it, delete it). `--default-collection-name` (item 2) is also checked.
- **Server:** checks only in the cookie selector, with the full rule, before it writes the value into `Set-Cookie`. Today `CookieCollectionSelector` writes the value from the `activate` URL into the cookie with no check. Thus an old name such as `feature_x` cannot be activated by cookie. The other selectors only read a name, and a name that does not exist only finds no collection.
- **README:** states the rule.

## 3. `generateApp()` (item 2)

- Today, `action()` in `src/cli/commands/scaffold/index.ts` does four steps in a row:
  1. Read and check the flags, resolve the paths, and look up the S3 endpoint (a network call).
  2. Make the files in a local map, `resourceFiles`: `.gitignore`, `package.json`, `fastly.toml`, `static-publish.rc.js`, `publish-content.config.js`, `src/index.js`.
  3. Write them.
  4. Run `npm install`, and show the instructions.
- **`generateApp(config: AppConfig) → Record<string, string>`** is step 2, in its own function. It is pure: no file system, no network, no console. `AppConfig` has the resolved settings (for example the S3 endpoint after the lookup). Its fields map 1:1 onto the scaffold flags, so that the flags can also override settings in managed mode.
- The output is byte-for-byte the same as today.
- **Who calls it:**

  | Mode | When | What it does |
  |---|---|---|
  | Ejected | One time, at `scaffold` | Writes `compute-js/`. After that, the app is the user's code. |
  | Managed | At each `dev` and `deploy` | Writes `.static-publish/app/` again. |
  | Managed | At `status` | Only in memory, to calculate the fingerprint. |
  | Managed → ejected | One time, at `eject` | Writes the same app into `compute-js/`. |

  Thus scaffold, managed mode, and eject cannot drift apart.
- **`--default-collection-name`:** new flag. It writes `defaultCollectionName` in `static-publish.rc.js` (default `live`, which is hard-coded today). The rule of item 1 checks it.
- item 2 comes before item 3, so that the golden-file tests are fast unit tests from the start.

## 4. Templates, internal (item 3)

### The template interface

```ts
type AppTemplate = {
  files: Record<string, string>,              // only paths that generateApp() does not write
  dependencies: Record<string, string>,
  devDependencies?: Record<string, string>,
  gitignore?: string[],                       // lines added to .gitignore
  supports?: { collectionSelection?: boolean },
  // 8.2 adds: initFiles, provides, declared settings (see ../v8.2/design.md)
  // later: fastly.toml resource declarations
};
```

- `plain` supplies only `files['src/index.js']` (the current file, with no change) and no dependencies.
- There is no `scripts` field. Build steps use the template hooks (below). Add a `scripts` field later only if a template needs one.
- In 8.1 there is only `plain`, and no `--template` flag. `generateApp()` always uses `plain`. item 3b (8.2) adds `--template` and `managed.template`.

### Templates only add, never replace

A template never replaces a file that `generateApp()` writes. It adds through typed fields that `generateApp()` merges in: dependencies, `.gitignore` lines, and later `fastly.toml` resources. A path in `files` that `generateApp()` writes is a mistake in our own code (only we write templates; they are inside this package). A unit test over all templates fails for it, and `generateApp()` also throws. If a template needs something special later (for example another `build`), add a typed field for that case.

### Template hooks

A convention of the platform, so that any template can use it. Every generated app has these scripts in `package.json`:

```json
"prebuild":    "compute-js-static-publish run-template-hook prebuild",
"build":       "js-compute-runtime ./src/index.js ./bin/main.wasm",
"postbuild":   "compute-js-static-publish run-template-hook postbuild",
"postinstall": "compute-js-static-publish run-template-hook postinstall"
```

- `run-template-hook <name>` runs `scripts/template_<name>.js` if it exists, and otherwise does nothing. A failed hook fails the command.
- The hooks are in **every** app (the runner is always there). `plain` has no hook files, so the hooks do nothing for it. A hook file that a user adds later to an ejected app runs with no other change.
- `build` is the same as today. npm and pnpm both run pre and post scripts (pnpm: `enablePrePostScripts` is `true` by default). The Fastly CLI runs `npm run build` (from `fastly.toml`), so `fastly compute build`, `publish`, and `serve` all run the hooks.
- The hooks are in 8.1 (not 8.2), so that apps scaffolded with 8.1 already have them. This changes the golden files on purpose.
- `npm ci --ignore-scripts` (or `npm install --ignore-scripts`) skips the hooks.

### The template record `generatedFrom`

`scaffold` (ejected) and `eject` write a record into the app's `static-publish.rc.js`:

```js
generatedFrom: {
  template: 'plain',
  staticPublishVersion: '8.1.0',
  generatedAt: '2026-10-18',
},
```

- Uses: `template init` (8.2) finds the app's current template; upgrade help later; warnings about settings that the template does not declare.
- The record is written from 8.1, so that every app made by 8.1 or later has one. In 8.2, `template init` gives an error for an app with no record, with the steps to add it by hand.
- A managed project has no `generatedFrom`: its project file names the template (`managed.template`, 8.2), and the generated rc does not have it either (`generatedAt` would change the fingerprint each day).

## 5. `PublisherServer` (items 4 and 5)

### item 4: per-request scope

- Today, `PublisherServer` keeps the state of a request on the instance: `settingsCached` (the settings), `assetEntryMapCache` (the index), and `serverTiming`. Compute can use a sandbox again for a later request, so this state can stay from one request to the next. #91 worked around this: `beginRequest()` clears the fields.
- **Change:** the state is in a `CollectionScope`, kept in a `WeakMap` keyed by the `Request` and the collection. Nothing stays between requests, and two calls for the same request read the index one time.
- The methods that take no request (`getMatchingAsset()`, `serveAsset()`, …) use the current scope, which `beginRequest()` and `setActiveCollectionName()` replace. They work as before.
- **The old public fields** `serverTiming`, `settingsCached`, and `assetEntryMapCache` stay as read-only getters that return the state of the current scope, marked `@deprecated`. Remove them in v9. Code that assigns to them gets a TypeScript error (a getter has no setter). CHANGELOG: under `Deprecated`, not `Removed`.
- item 4 adds no API. The existing tests must pass with no change.

### item 5: `serveRequest()` options and `serveFallback()`

`serveRequest(request, options?)`. Without options, the behavior does not change.

| Option | Input | Default |
|---|---|---|
| `collectionName` | The collection for this call only. `null` selects the default collection. | The active collection |
| `pathname` | The path to look up, in place of the URL path. It must be decoded and start with `/`. | The decoded URL path |
| `fallback` | `false`: if no file matches, do not serve the SPA file or the 404 page. | `true` |
| `healthCheck` | `false`: do not answer `/healthz`. | `true` |

Output: a `Response`, or `null` if there is no response (a method other than `GET` and `HEAD`, or no matching file and no fallback). If the settings are not in storage, the response is `500`.

`serveFallback(request, options?)` (new): the SPA file (`200`) or the 404 page (`404`), the same as `serveRequest()` when no file matches. Input: the request and `collectionName`. Output `null` for a method other than `GET` and `HEAD`, for a client that does not accept HTML, or for a collection that has no fallback page.

Response cache keys:

- With `fallback: false`, the response does not depend on HTML, so the key is `<path>|no-html`.
- `serveFallback()` uses one key, `|fallback`, for all paths. A path always starts with `/`, so this key never matches a path.
- A test checks that the response cache keys on the collection (collection selection needs this).

Collection selection needs `collectionName` and `pathname`. The Hono middleware (8.2) needs all four options and `serveFallback()`.

## 6. Hidden files (items 26 to 28)

A hidden file is published, but `PublisherServer` does not serve it for a request. Code can get it only if it asks for hidden files. Examples: the 404 page (a request for `/404.html` must not return the 404 page with status `200`), templates that the app reads with `getMatchingAsset()`. It also replaces the use of `--public-dir` and `server.publicDirPrefix` (deprecated in 8.0).

**Hidden is not access control.** Hidden files are in the KV Store or the bucket, the same as other files, and code that asks for hidden files can serve them. The README must say: do not use hidden files for secrets.

### Marking (item 27)

In `publish-content.config.js` (in managed mode: the `publishContent` section of the project file), both ways. A file is hidden if either says so:

```js
const config = {
  rootDir: '../public',
  // the same format as server.staticItems: a '/dir/' prefix, an exact path, or a 're:' regex
  hiddenItems: [ '/templates/', '/404.html' ],

  // or, for anything else:
  assetInclusionTest: (key) => key.endsWith('.tpl') ? { hidden: true } : true,
};
```

- `assetInclusionTest` returns only `true` or `false` today. An object is truthy, so `{ hidden: true }` is backward compatible.
- **SPA file and 404 page:** hidden only if they are marked. No change for existing sites.
- **CLI:** `collections list` shows the number of hidden files, and the summary of `publish-content` says how many it hid. Their `--json` output (item 12) has the count.

### Index format and server (item 26)

- Hidden entries use keys with a `hidden:` prefix, for example `hidden:/404.html`. No request path can match such a key. The index metadata has `requires: hidden` (#103), and `SUPPORTED_INDEX_FEATURES` gets `hidden`.
- **It fails closed on every older server:** 8.0.0 and later do not serve a collection that requires `hidden` (#103). v7 and the 8.0 betas do not have that check, but they cannot find the files, because no request path matches a `hidden:` key.
- **Why this matters:** the CLI that publishes and the server in the deployed Wasm binary can have different versions (for example, a user installs a later version and publishes, but does not deploy again; or a staged or rolled-back version, or a second app, reads the same storage).
- `serveRequest()` never matches a hidden file, also not with `autoIndex` or `autoExt`.
- `getMatchingAsset(assetKey, { applyAuto, includeHidden })` returns a hidden file when `includeHidden` is set. A boolean second argument (the current `applyAuto`) still works.
- The SPA and 404 fallbacks can serve hidden files. The settings keep `spaFile: '/404.html'`; the fallback lookup also tries `hidden:` + the key.
- The check in `publish-content` that `spaFile` and `notFoundPageFile` exist and are HTML also finds hidden entries.
- No collision: a real file always has a key that starts with `/` (a file named `hidden:x` has the key `/hidden:x`). `clean` reads the hashes of all index entries, so it keeps the content of hidden files.

### Docs (item 28)

README; `MIGRATING.md` ("Stop using `publicDirPrefix`") recommends hidden files in place of "move the file and block its path in `src/index.js`"; CHANGELOG.

## 7. Collection selection (items 8 to 10)

A set of options that choose which collection serves a request: the base for previews. Every template that supports it uses the same options with the same meaning. Each template connects it in its own way (the fetch handler for `plain`, a middleware for `hono` in 8.2).

### Where it is

`collectionSelection`, top level in `static-publish.rc.js` (in managed mode: top level in `static-publish.project.js`; not under `templateOptions`), because it is the same for every template.

- It is in the Wasm binary (it must be: selection runs before the collection is known, so it cannot come from the settings of a collection in storage).
- A template declares `supports.collectionSelection`. Scaffolding and managed mode give an error if the option is set for a template that does not support it.
- Data only (strings, numbers, booleans), so that every field can also be a scaffold flag, and `status --json` can show it.
- **Default:** with no `collectionSelection`, no sources are on. Every request gets the active or default collection, as today. Previews are opt-in, so an upgrade exposes nothing.

### Shape

```js
collectionSelection: {
  // Tried in order. The first that gives a collection wins. No match: the default collection.
  sources: [
    { type: 'host',   pattern: '{collection}.preview.example.com' },
    { type: 'path',   prefix: '/_preview/{collection}', sticky: 'cookie' },
    { type: 'query',  param: 'collection', sticky: 'cookie' },
    { type: 'cookie', cookieName: 'publisher-collection',
      activatePath: '/activate', resetPath: '/reset', maxAge: 604800 },
    { type: 'header', name: 'x-publisher-collection' },
  ],
  // Which collections can be selected (globs). Default: any.
  allow: ['pr-*', 'staging', 'preview-*'],
  // The selected collection does not exist or has expired:
  onMissing: 'not-found',            // or 'default'
  // Responses from collections that are not the default:
  noindex: true,                     // X-Robots-Tag: noindex
},
```

### Sources

| Type | Reads | Notes |
|---|---|---|
| `host` | The `Host` header, matched against `pattern` | Needs a wildcard domain and TLS on the customer's side. The cleanest URLs; no state. |
| `path` | A URL path prefix. The prefix is removed before the file lookup (the `pathname` option of `serveRequest()`). | Works on `*.edgecompute.app` with no DNS. But links that start with `/` in the site (`/assets/app.css`) lose the prefix, so alone it suits only sites with relative links. With `sticky: 'cookie'`, it sets the cookie and redirects to the path without the prefix, which fixes that. It does **not** change links in HTML. |
| `query` | A query parameter | Only the request that has it. Almost always used with `sticky: 'cookie'` (set the cookie, redirect without the parameter). |
| `cookie` | A cookie. Also serves the activate and reset paths. | The same options as the current `collectionSelector.fromCookie`. |
| `header` | A request header | For tests, CI checks, and API clients. |

- `sticky: 'cookie'` on `path` or `query`: when this source matches, also set the cookie of the `cookie` source, and redirect to the clean URL. It requires a `cookie` source in the list (for its settings).

### Patterns

`host` and `path` patterns are plain strings with exactly one `{collection}` placeholder, anywhere in the pattern, with fixed text around it. Examples: `{collection}.preview.example.com`, `branch-{collection}.preview.example.com`, `/_preview/pr-{collection}`.

- The fixed text must match exactly. Host matching ignores case.
- In a hostname, the placeholder stays in one label. Collection names have no dots (item 1), so a name cannot cross a label.
- A host label has at most 63 characters, including the fixed text. With `branch-{collection}`, a name can have at most 56 characters there. `previewUrl()` gives an error for a longer name, not a broken URL.
- No RegExp patterns, so that every field can be a scaffold flag and appear in `status --json`.

### One resolver (item 8)

The logic is in one place, in the server package, in a module that does not import `fastly:*`:

```ts
resolveCollection(request, rc.collectionSelection): {
  collectionName: string | null,  // null: the default collection
  pathname?: string,              // the path without the prefix (path source)
  response?: Response,            // a redirect (sticky, activate, reset)
  matchedBy?: 'host' | 'path' | 'query' | 'cookie' | 'header',
}
```

- Selected names are checked with the rule of item 1 before use.
- Use the existing `collection-selector/` helpers where possible.
- `plain` (item 10) calls it at the start of the fetch handler: if `response` is set, return it; else pass `collectionName` and `pathname` to `serveRequest()`.
- The behavior is the same for every template, and the code in an ejected app stays short.

### Server behavior (item 9)

- **Caching:** when the collection comes from a cookie, a header, or a query, the same URL serves different content. Responses from collections that are not the default get `Cache-Control: private` (or a `Vary`), so that browsers and shared caches do not mix them. The response cache keys on the collection (test in item 5).
- **`noindex`:** `X-Robots-Tag: noindex` on responses from collections that are not the default.
- **`onMissing`:** `not-found` makes a mistyped preview easy to see; `default` never shows an error but can hide mistakes. The server must tell "collection not found" from "file not found" (today both give `null`), so item 9 adds a small API for this. Decided in item 9: `PublisherServer` keeps the rc's `collectionSelection`. For a collection that is not the default, `serveRequest()` and `serveFallback()` check that it exists (settings and index; this reads the index also when the response cache has the response). `not-found` returns a `404` ("Collection '<name>' not found.", `no-store`); `default` serves the default collection. The public API is `collectionExists(request, collectionName)`.
- **Exposure:** without `allow`, anyone who guesses a collection name can see unreleased content. `allow` limits the names. The README says that a preview is public to anyone who knows its name. Protection (a token or basic auth) is a later option (see [../README.md](../README.md#not-in-81-or-82)).
- **Production host:** with the `host` source, the production hostname must never match the pattern. Check this when it can be checked.

### Preview URLs

CI tools must show a link for a collection. `previewUrl(collection, baseUrl)` calculates it from the same config. `status --json` (item 16) also shows the URL templates. The first source in `sources` that can make a URL is the one used.

| Source | Preview URL for `pr-42` |
|---|---|
| `host` | `https://pr-42.preview.example.com/` |
| `path` | `https://<service domain>/_preview/pr-42/` |
| `query` | `https://<service domain>/?collection=pr-42` |
| `cookie` | `https://<service domain>/activate?collection=pr-42&redirectTo=/` |

### Flags (item 10)

So that disposable and CI setups do not need a config file. Each field has a flag (decided in item 10):

```
--collection-selection=host:{collection}.preview.example.com
--collection-selection=path:/_preview/{collection},sticky
--collection-selection=query:collection,sticky
--collection-selection=cookie[:<cookieName>][,maxAge=<seconds>][,activatePath=<path>][,resetPath=<path>]
--collection-selection=header:x-publisher-collection
--collection-allow=pr-*,staging
--collection-on-missing=not-found
--collection-noindex=true|false
```

`--collection-selection` can be repeated; the order of the flags is the order of the sources.

## 8. CI basics (items 11 and 12)

Requirements from tools that run this package with no person present (for example a GitHub Action that publishes each push and each PR):

| # | Requirement | Where |
|---|---|---|
| 1 | No prompts with `--non-interactive` or when `CI` is set; missing input is an error with a clear message | item 11 |
| 2 | Credentials from env vars (`FASTLY_API_TOKEN`, `FASTLY_SERVICE_ID`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`); never shown in logs or errors | item 11 |
| 3 | Run from the project dir, or with `--project-dir`; nothing assumes that the project dir is the repo root (a repo can have several projects) | item 11 |
| 4 | "Is a deploy necessary?": `status --json` | item 16 |
| 5 | `--json` for `deploy` (service ID, version, default domain), `publish-content` (collection, files uploaded, reused, and hidden, expiry), and `collections list` | items 12, 17 |
| 6 | Exit codes: `0` success, not `0` failure. A failed purge after a successful publish stays a warning, but is in the JSON | item 12 |
| 7 | Defined collection name rules | item 1 |
| 8 | Idempotent operations: publish the same content to the same collection again, promote to the same target, delete a collection that does not exist | item 12 |
| 9 | Collection selection as options of the templates, all settable by flags | items 8 to 10 |
| 10 | Preview URLs from the same config | items 8, 16 |

Nice to have:

- `collections list --json` with expiry and the time of the last publish, for cleanup and rollback tools (item 12).
- A documented least-privilege Fastly API token scope for deploy, publish (purge), and collections (item 19, docs).
- A way to pass a commit SHA or message into the comment of the deployed version and into the collection metadata, for traceability (item 16 decides the comment format).

Decisions:

- **Non-interactive** when `--non-interactive` is given or the `CI` env var is set.
- **`--json`:** stdout has exactly one JSON object, printed at the end. The normal log lines go to stderr, so that they still show in the CI log.
- **Schema version:** each JSON object has `schemaVersion: 1`. Adding a field keeps the version. Removing or changing a field increases it, only in a major release.
- **`--version`** (item 11): prints only the version of this package (for example `8.1.0`) on stdout, and exits `0`. It works in any directory: the CLI handles it before it detects the mode. With `--json` (item 12): `{ "schemaVersion": 1, "version": "8.1.0" }`. No short form (`-v`), so that it cannot clash with `--verbose`. The version comes from the `package.json` of the copy that runs.
- **The banner** ("🧑‍💻Fastly Compute JavaScript Static Publisher (… mode)") goes to stdout today. With `--json`, it must go to stderr (or not be shown), so that stdout has only the JSON object (item 12).
- **Idempotent operations:** success, exit `0`. The JSON says what happened, for example `"deleted": false, "reason": "not-found"`.
- **Exit codes:** `0` success (also "nothing to do"); `1` the operation failed (for example an upload error, storage that cannot be reached, a failed deploy; a retry can help); `2` usage or config error, so the command could not start (for example an unknown flag, a missing option, a collection name that breaks the rule, a broken `static-publish.rc.js`; a retry cannot help).
- **A failed purge** after a successful publish stays exit `0` (as today, a warning), because the content is published. The JSON shows it: `"purge": { "ok": false, "environment": "production", "error": "…" }`. Old content can be served from the cache until it expires, so tools that care read `purge.ok`.
- **Errors with `--json`:** stdout still has exactly one JSON object: `{ "schemaVersion": 1, "error": { "code": "…", "message": "…" } }`. `code` is a stable string for scripts (for example `collection-name-invalid`, `missing-option`, `storage-unreachable`, `deploy-failed`); the list of codes is part of the contract. `message` is for people and can change. The error also goes to stderr, so that the CI log shows it.

Decided in items 11 and 12: `--project-dir` runs `process.chdir()`, so all relative paths (also in flags, and `staticPublisherWorkingDir`) are relative to the project dir, which is where the config file is. The error codes are `usage`, `config-invalid`, `collection-name-invalid`, `collection-not-found`, `project-dir-not-found`, `json-not-supported`, `credentials-missing` (exit `2`), and `failed` (exit `1`); the README lists them. In `publish-content --json`, `files` has `total` and `hidden` (files in the index) and `uploaded` and `reused` (storage items), and `purge` is `null` or `{ ok, serviceId, environments: [{ environment, ok }] }`.

Example:

```
$ publish-content --json 2>/dev/null
{
  "schemaVersion": 1,
  "collection": "pr-42",
  "files": { "uploaded": 12, "reused": 340, "hidden": 2 },
  "expiresAt": "2026-11-01T00:00:00Z",
  "purge": { "ok": true }
}
```

## 9. Managed mode (items 13 to 19)

### Modes

| | Managed | Ejected |
|---|---|---|
| In the repo | One file, `static-publish.project.js`, in the project dir | The full app dir (`compute-js/`) with `static-publish.rc.js` and `publish-content.config.js`, as today |
| Who owns the app code | This package (template and config) | The user |
| Upgrading this package | Change the version; the next deploy generates the app again | As today (`MIGRATING.md`) |
| Deploy when | The fingerprint of the generated app changes | The user deploys (or a CI tool decides) |
| Customize | Config options (8.2: Hono extensions) | Anything |

**Detection: the file name is the marker** (decided 2026-10-18). In the directory where the CLI runs (or `--project-dir`):

| File | Mode |
|---|---|
| `static-publish.project.js` | **Managed** |
| `static-publish.rc.js` | **Ejected**: management mode, as today. ("An rc means an app" stays true: only apps have an rc.) |
| Neither | Scaffolding, as today. New: `--managed` writes only `static-publish.project.js`. |
| Both | An error, with a clear message |

Why a different name: if a managed project used `static-publish.rc.js` in the project dir, and `eject` then moved it into `compute-js/`, users would see the same file appear in a new place, which is confusing. With its own name, the project file is clearly a different kind of file, and `eject` converts it into the two traditional files.

### Directory layouts (items 13 and 18)

**Managed project:**

```
my-site/                               ← project dir (repo root, or a subdirectory)
├── static-publish.project.js          ← committed: the only config file
├── public/                            ← committed: the content (publishContent.rootDir)
├── .gitignore                         ← scaffold --managed adds the next two directories
├── .static-publish/                   ← ignored: the generated app (dev and deploy make it again)
│   └── app/
│       ├── static-publish.rc.js       ←   generated: top-level fields only (in the Wasm binary)
│       ├── fastly.toml                ←   [local_server] → ../../static-publisher/kvstore.json
│       ├── package.json, package-lock.json
│       ├── src/index.js
│       ├── node_modules/
│       └── bin/, pkg/                 ←   build output
└── static-publisher/                  ← ignored: the working dir (staticPublisherWorkingDir)
    ├── kvstore.json                   ←   the local KV Store (from publish-content --local)
    └── storage-content/               ←   the publish cache (compressed files, chunks, index JSON)
```

**The same project after `eject`:**

```
my-site/
├── public/                            ← committed: no change
├── .gitignore                         ← still ignores static-publisher/ (its .static-publish/ line is stale)
├── compute-js/                        ← committed now: the app, owned by the user
│   ├── static-publish.rc.js           ←   from the project file: staticPublisherWorkingDir: '../static-publisher', and generatedFrom
│   ├── publish-content.config.js      ←   from publishContent: rootDir: '../public'
│   ├── fastly.toml                    ←   [local_server] → ../static-publisher/kvstore.json
│   ├── package.json, package-lock.json
│   ├── src/index.js
│   └── .gitignore                     ←   node_modules, bin, pkg (no working dir: it is outside the app)
└── static-publisher/                  ← ignored: the same working dir, with the same data
```

`static-publish.project.js` is gone, and `.static-publish/` can be deleted.

**Ejected, scaffolded directly (the layout of today):**

```
my-site/
├── public/                            ← committed: the content
└── compute-js/                        ← committed: the app
    ├── static-publish.rc.js           ←   staticPublisherWorkingDir: './static-publisher', and generatedFrom (from 8.1)
    ├── publish-content.config.js      ←   rootDir: '../public'
    ├── fastly.toml                    ←   [local_server] → ./static-publisher/kvstore.json
    ├── package.json, package-lock.json
    ├── src/index.js
    ├── .gitignore                     ←   node_modules, bin, pkg, static-publisher
    └── static-publisher/              ←   ignored: the working dir
        ├── kvstore.json
        └── storage-content/
```

"Ignored" means generated, local to the machine, and possible to make again from what is committed (like `node_modules`). It does not mean "deleted after each run": local development uses `kvstore.json` between commands, and the next publish reuses `storage-content/`.

- The project dir is where the CLI runs, or `--project-dir`. Nothing may assume one project per repo, or that the project dir is the git root. Each project has its own config, cache dir, and Fastly service.
- The generated app is in `<project>/.static-publish/`, one per project, gitignored.
- **`.gitignore`:** `scaffold --managed` adds `.static-publish/` and the working dir to the `.gitignore` in the project dir (the directory where the command runs, or `--project-dir`). If the file is missing, it makes it. If it exists, it adds only the missing lines, at the end, under a comment `# @fastly/compute-js-static-publish`, and never changes the user's lines. It shows what it added. In a subdirectory of the repo, this is a nested `.gitignore`, and its lines apply relative to that directory.
- **The working dir** (`staticPublisherWorkingDir`): one rule for both modes. The path is relative to the file that has it: `static-publish.project.js` (managed: `my-site/static-publisher/`) or `static-publish.rc.js` (ejected: `compute-js/static-publisher/`, as today). The generated rc in `.static-publish/app/` is never used for paths. Thus the working dir is beside the project file, and generating the app again never deletes the local data.
  - **Validation** (changed, decided 2026-10-18): a relative path that starts with `./` or `../`. Not an absolute path, and not a path that resolves to the directory of the config file or a directory above it (for example `./`, `..`, `../..`), so that `publish-content` never writes its files among the user's own files. Today the value must start with `./` (and not be `./`); the new rule also allows paths outside the config dir, on purpose (`../x`, which is the same as `./../x`). A security-relevant change: review it carefully.
  - **`eject`** writes the value again, so that it points at the same directory from the new location of the rc: `./static-publisher` in the project file becomes `../static-publisher` in `compute-js/static-publish.rc.js`. The local data stays where it is.
  - The CLI deletes only `<file>_chunks` directories that it made (under paths from content hashes), never the working dir or anything above it. Thus allowing `../` gives the CLI no new place to delete.
  - **What is in it:** `storage-content/`, the prepared files of each publish (compressed variants, chunks, the index and settings JSON), which works as a cache (safe to delete; the next publish makes it again); and `kvstore.json` from `publish-content --local`, which is the local KV Store for `fastly compute serve` (`[local_server]` in `fastly.toml` points at it). No secrets.
  - The `kvstore.json` path in the generated `fastly.toml` comes from the working dir, so after `eject` it is `../static-publisher/kvstore.json`.
- `publish-content`, `collections`, and `clean` run from the project dir and read `static-publish.project.js`. They never use the generated files in `.static-publish/app/`, so publishing content does not need a generated app.

### The project file `static-publish.project.js` (item 13)

One file with the same settings that an ejected app has in its two files, plus the generator settings:

```js
/** @type {import('@fastly/compute-js-static-publish').StaticPublishProject} */
export default {
  // Read by the app at runtime (the same fields as static-publish.rc.js):
  storageMode: 'kv-store',
  kvStore: { kvStoreName: 'site-content' },
  publishId: 'default',
  defaultCollectionName: 'live',
  staticPublisherWorkingDir: './static-publisher',
  // collectionSelection: { … },

  // Read by publish-content (the same fields as publish-content.config.js):
  publishContent: {
    rootDir: './public',
    hiddenItems: [ '/404.html' ],
    server: { notFoundPageFile: '/404.html' },
  },

  // Read by the generator only:
  managed: {
    name: 'my-site',          // fastly.toml, package.json
    description: 'My site',
    authors: ['me@example.com'],
    serviceId: undefined,     // written after the first deploy
    staticPublishVersion: '8.1.0',  // the version of this package that the project uses
  },
};
```

- `publishContent` has exactly the fields of a `publish-content.config.js`. Its paths are relative to the project dir.
- **`publish-content --config <file>`** works as in ejected mode: the file is a normal `publish-content.config.js`, and it is used in place of `publishContent`, for that run only. Thus one managed app can publish collections with different server settings.
- `managed` is a section for the fields that only the generator reads. It does not mark the mode (the file name does). No `template` field in 8.1 (item 3b adds it in 8.2; a missing value means `plain`).
- Types: a new type `StaticPublishProject` = the fields of `StaticPublishRc`, plus `publishContent` (`PublishContentConfig`), `managed`, and (in 8.2) `templateOptions` and `build`.

### Why the settings stay in separate sections

In ejected mode, the settings are in two files. The split came in v7.0.0, in the same release that added collections and stopped putting the files into the Wasm binary. The reasons are still true, so the project file keeps the same split, as sections of one file:

- **When a change takes effect.** `src/index.js` imports the rc, so the rc is in the Wasm binary, and a change needs a deploy. Only the CLI reads the publish settings. Their `server` part is saved in storage **for each collection**, so a change takes effect at the next publish, with no deploy.
- **One app, many collections.** `publish-content --config <file>` can use different publish settings for each publish. There is one rc for each app, but there can be several publish configs.
- **Who reads it.** The rc has what the CLI and the server must agree on (storage, `publishId`, `defaultCollectionName`). The publish settings have what only the CLI needs, including functions (`assetInclusionTest`) and regexes (`contentTypes`), which must never go to the edge.

### Sections of the project file

| Section | Read by | In the generated rc (Wasm)? | After eject | Examples |
|---|---|---|---|---|
| Top level | The app at runtime | Yes | `static-publish.rc.js` | `storageMode`, `s3`, `publishId`, `defaultCollectionName`, `collectionSelection`, `templateOptions` (8.2) |
| `publishContent` | `publish-content`, at publish time | **No** | `publish-content.config.js` (its own file) | `rootDir`, `hiddenItems`, `contentTypes`, `server` |
| `build` (8.2) | Build scripts, in both modes | No | `static-publish.rc.js` | `hono.extensionsDir` |
| `managed` | The generator only | No | Removed; `generatedFrom` is written | `name`, `description`, `authors`, `serviceId`; `template` in 8.2 |

`generatedFrom` (written by scaffold and eject) is only in an ejected app's `static-publish.rc.js`, never in the project file.

How to decide: *does the running app read it?* Top level. *Only `publish-content`?* `publishContent`. *Does the build need it, in managed and in ejected mode?* `build`. *Only to generate the app from a template?* `managed`.

Rules:

- **The app sees the whole rc at runtime.** `src/index.js` imports `static-publish.rc.js`, and the build bundles it, so the app can read any key. Nothing checks unknown keys at runtime.
- **Managed mode:** the generator writes `static-publish.rc.js` into the app with only the top-level fields: no `publishContent`, `managed`, `build`, or `generatedFrom`. Thus a change to `publishContent` or the write-back of the service ID does not change the fingerprint, and functions and regexes never go to the edge.
- **Ejected mode:** `src/index.js` imports the real rc file, so `build` and `generatedFrom` are in the Wasm binary. That does no harm (no secrets; the rc already has the CLI-only `staticPublisherWorkingDir` today), and there is no fingerprint to protect.
- **Types:** the scaffolded files have `/** @type {…} */`, so `StaticPublishRc` must declare `collectionSelection` and `generatedFrom` (and `templateOptions` and `build` in 8.2), or editors that check JS types flag them.
- The `managed` fields map 1:1 onto the scaffold flags (`--name`, `--service-id`, …), so the flags continue to work as overrides.
- The `[setup]` and `[local_server]` sections of `fastly.toml` come from `storageMode`, `s3`, and `kvStore`, as scaffolding does today.

### Dependencies (item 14)

The same version of this package and the same config must make the same app, including the resolved dependency versions. Without that, two deploys of the same commit can get different versions of `@fastly/js-compute` and the ~160 packages below it (the compiler toolchain). The deployed app does not change by itself (the fingerprint decides when to build), but a later deploy, for example for a small config change, can then also get a new toolchain that nobody asked for, and a laptop and CI can build different apps from the same commit.

- **Tentative: a lockfile for each template (A),** shipped in this package and made at release time, with a CI check that it is up to date. Managed mode runs `npm ci`. The alternative is exact versions in `package.json` and no lockfile (B), which pins the direct dependencies but not the packages below them. item 14 tests A and keeps it, or changes to B.
- **How the lockfiles are shipped:** each template's lockfile is saved in the repo and copied into `build/` by the build. `package.json` `"files"` includes them. npm leaves out only the **root** `package-lock.json` of a published package: a nested `package-lock.json` is kept (spike, npm 11, `npm pack --dry-run`). Thus the template lockfiles can keep the normal name. Check again with the npm version of the release workflow.
- **Who updates them:** a step in the release process (the `release-and-port` skill gets a new step). Dependabot does not update them. The step must use `npm install --package-lock-only --ignore-scripts`: `--package-lock-only` still runs the app's own `postinstall` script (spike), and every app has a `postinstall` hook.
- **Private registries:** a lockfile has `registry.npmjs.org` URLs; npm 7 and later replace the default registry with the one configured in `.npmrc`. Test it one time.
- **Who installs:** `deploy` and `dev` run `npm ci` in the generated app dir only when the generated `package.json` or lockfile changed.
- **To keep a later change between A and B local to item 14:**
  - The fingerprint (item 16) hashes the **whole output of `generateApp()`**. A lockfile is only one more generated file.
  - `eject` (item 18) writes what `generateApp()` made.
  - One helper, `pinnedVersion(template, package)`, gives the version that a template pins. 8.2 code calls only this helper.
  - Not possible without changes to other PRs: using this package's own dependencies for the templates (C).
- **This package in the generated app** (decided 2026-10-18, after a spike). The app's `src/index.js` imports this package (the server code, which the build bundles into the Wasm binary), so the app's `node_modules/` must have it. It must be **exactly** the version of the running CLI, and a lockfile made at release time cannot list it (the version is not published yet, so its hash is not known). Thus the generated app uses **the copy of this package that runs the CLI**, through a `file:` link:
  - `package.json`: `"@fastly/compute-js-static-publish": "file:<absolute path of the CLI's package dir>"` (in `devDependencies`).
  - The generator adds to the template's lockfile: the same spec in `packages[""].devDependencies`; `packages["node_modules/@fastly/compute-js-static-publish"] = { "resolved": "<path relative to the app dir>", "link": true }`; and `packages["<path relative to the app dir>"]` with `version`, `license`, `dependencies`, `bin`, `devDependencies`, `engines`, and `peerDependencies` from the CLI's own `package.json`, and `"dev": true`.
  - Result (spike, with a local install and an `npx` install, and with the app in a project that has the CLI as a dev dependency): `npm ci` accepts it and does not change the lockfile; npm links the bin `compute-js-static-publish`; a `postinstall` hook runs during `npm ci`; a later `npm install` keeps the link; nothing is written into the CLI's install; the app builds and serves content.
  - Not chosen: leaving this package out and making a symlink after `npm ci`. It also builds, but npm does not link the bin, a `postinstall` hook makes `npm ci` fail (exit 127), and `npm ci` and `npm install` both remove the symlink.
  - The path is different on each machine, so the fingerprint uses this package's **version**, not the path.
  - **Upgrading:** the generated app always uses the running CLI's copy, so nothing in the generated app is pinned separately. Which version runs depends on how the CLI is started: a dev dependency of the project (the version in its lockfile), `npx …@8.1.0` (that version), or `npx …@latest` (the newest, at each run). The project file records the version, so that an upgrade is always explicit (see "The version of this package" below).
  - **Paths in the Wasm binary** (spike): every Compute JS build already contains its build directory (the build snapshot captures `PWD`). The bundle also has the paths of the bundled modules, relative to the app. With the CLI run through `npx`, these go into the npm cache, so the deployed binary contains the user's home directory (about 112 strings like `/Users/<name>/.npm/_npx/…`). With the CLI as a dev dependency of the project, the paths stay in the project. Thus the docs recommend the CLI as a dev dependency of the project in managed mode, and `deploy` can warn when the CLI runs from the npx cache (decide in item 17).

### `dev` (item 15)

Generate the app, install (if necessary), then run `fastly compute serve` in `.static-publish/app/`. The content comes from `publish-content --local`, as today. The `[local_server]` section must point at the project's `kvstore.json` (in the working dir in the project dir), not at one in the cache dir.

### Fingerprint and `status` (item 16)

- **The fingerprint** is a SHA-256 over the whole output of `generateApp()` and the version of this package (and, in 8.2, the template name, the contents of `hono-extensions/`, and its lockfile). It does not include the service ID, `generatedFrom`, or any content.
- **Where the deployed fingerprint is:** in the comment of the service version. `deploy` runs `fastly compute build`, then `fastly compute deploy --comment "…"` (checked in the Fastly CLI source: `--comment` sets the comment before the version is activated). `status` reads the comment of the active version through the API. Thus it is true about what is active, also after a rollback or a deploy by hand.
- **`status [--json]`** shows the mode, the service ID, the current fingerprint, the deployed fingerprint, `needsDeploy`, and the preview URL templates (§7). In ejected mode: the mode and the service ID. Without an API token: the current fingerprint, and the deployed one as unknown.

### The version of this package (decided 2026-10-18)

The project file records the version of this package that the project uses: `managed.staticPublishVersion`. `scaffold --managed` writes it. Reason: with `npx …@latest` (or with no version and no local install), a new release would otherwise upgrade the project silently. The fingerprint includes the version, so the next run would deploy a new app, with new pinned dependencies, with no change in the repo.

At each `dev` and `deploy`, the CLI compares the recorded version with its own:

| Running CLI | Result |
|---|---|
| The same version | Continue. |
| **Newer** | **Stop**, with a message: "This project uses 8.1.0. You are running 8.2.0. Run `upgrade` to move the project to 8.2.0, or use `--auto-upgrade`." |
| Newer, with `--auto-upgrade` | Write the new version into `managed.staticPublishVersion` (the same marked-line write-back as `serviceId`), and continue. In CI, the checkout is not committed, so the version in the repo stays old, and each later run upgrades again in its own checkout. This does no harm. |
| **Older** | **Stop** (no flag changes this): an older CLI must never deploy over an app made by a newer one. The message names the version that the project needs. |

- **`upgrade`** (new command, managed mode): sets `managed.staticPublishVersion` to the running CLI's version. Later releases can also migrate the project file there.
- **`status`** shows the recorded and the running version, and why a deploy is necessary (for example "the version of this package changed: 8.1.0 → 8.2.0"). `status --json` has both versions.
- **For users with a dev dependency:** when the dev dependency is bumped (by a person or by Dependabot), the next `deploy` stops until someone runs `upgrade` and commits the new version. This is the explicit upgrade, as intended. (Later, the version in the project's lockfile could count as the record. Not in 8.1.)
- **Docs:** recommend a pinned version (a dev dependency, or `npx …@8.1.0`). `@latest` with `--auto-upgrade` means automatic upgrades.
- If `managed.staticPublishVersion` is missing (the user removed it), `dev` and `deploy` stop and say to run `upgrade`.

### Service ID

- The order of precedence: `--fastly-service-id`, then the `FASTLY_SERVICE_ID` env var, then `managed.serviceId`.
- The Fastly CLI writes `service_id` into the generated `fastly.toml`, which is in the cache dir. After the first deploy, `deploy` writes it into `managed.serviceId` in `static-publish.project.js`: `scaffold --managed` writes the line `serviceId: undefined,` in the `managed` section, and `deploy` replaces exactly that line with the ID. If the line is not there (the user changed it), `deploy` shows the ID and where to put it. It never changes other JavaScript.
- In CI, writing back to the repo is not practical, so the first deploy is usually local, or CI passes the ID of a service that exists.

### `deploy` (item 17)

`deploy [--force] [--json]`: generate, install (if necessary), build, then deploy, only if the fingerprint changed (or with `--force`). Record the fingerprint in the version comment. Write back the service ID. The JSON has the service ID, the version, and the default domain.

**First deploy with S3 storage: by hand in 8.1.** With `--non-interactive`, S3, and no service ID, `deploy` fails with a clear message: do the first deploy locally (the Fastly CLI asks for the two secrets), or give the ID of a service that is already set up. Later deploys from CI work.

- Reason (from the Fastly CLI source): in non-interactive mode, the Fastly CLI fails for any `[setup]` Secret Store that lists entries (`value cannot be blank`), even if a store with that name exists. It checks the values before it links or makes anything.
- A bootstrap through the API is in "Not in 8.1 or 8.2" (see [../README.md](../README.md#not-in-81-or-82)).

In ejected mode, `deploy` is an optional wrapper around `fastly compute publish`.

### `eject` (item 18)

`eject` writes the app that managed mode would deploy, and converts the project file into the two files of an ejected app:

1. Generate the app exactly as `deploy` would, into `./compute-js` (or `--dir`).
2. **Split** `static-publish.project.js` into the two traditional files in `compute-js/`: `static-publish.rc.js` (the top-level fields and `build`, plus the `generatedFrom` record) and `publish-content.config.js` (the `publishContent` section). Write paths again, relative to the new location (`rootDir`, `staticPublisherWorkingDir`, and in 8.2 `build.hono.extensionsDir`), so that they point at the same directories. Then delete `static-publish.project.js`.
3. Write the values of the `managed` section into `fastly.toml` and `package.json`, including `service_id` (from the section, the env var, or the flag).
4. Write the dependencies, so that the first ejected build is the same as the last managed deploy (the same fingerprint):
   - This package: `"@fastly/compute-js-static-publish": "^8.1.0"` (a caret range, as scaffolding writes today), never the `file:` link of managed mode, which points at a path on one machine. The range lets `npm update` (and Dependabot) upgrade it within 8.x.
   - The lockfile: the lockfile that managed mode used, with the `file:` link entries replaced by a normal entry for exactly `8.1.0` from npm (`eject` runs one `npm install` in `compute-js/`, so it needs the network one time). Thus `npm ci` builds the same app until the user chooses to upgrade.
   - If the CLI's version is not on npm (a local checkout, or a build that is not published), `eject` stops with a clear message: ejecting needs a published version.
5. Show what changed, and that the user now owns upgrades.

- After step 2, the project dir has no project file, and `compute-js/` has an rc, so detection is clear.
- `eject` refuses if the target dir exists, unless `--force`.
- In ejected mode, `eject` gives an error: the app is already ejected.

### Docs (item 19)

- README: "Managed and ejected apps".
- `MIGRATING.md`: how to move an existing project to managed mode (steps by hand).
- The least-privilege API token scope for deploy, publish (purge), and collections.
- CHANGELOG entries come with each PR.

### Compatibility

- No change for existing projects (they are ejected projects).
- `scaffold` makes an ejected project by default in 8.1. `--managed` is opt-in. The default could change in v9.
