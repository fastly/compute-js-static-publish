# 8.1 design

The design of the six parts of 8.1, with the decisions. The task numbers (1.1, 2.3, …) are the ones in [README.md](README.md). A section can end with details that are still open: "To decide in this part" or "To test in this part". They are decided or tested while that part is built. The answer stays in that task, and no other part depends on it.

## Background

### The problem

Every project that uses this package must make a choice:

- **Commit the scaffolded app** (`compute-js/`) to the repo. The customer can change it, but it stays at the version that it was scaffolded with. To upgrade, the customer edits generated files by hand (thus `MIGRATING.md`).
- **Treat the app as disposable.** This is possible today, but not easy: in CI, scaffold the app on the runner for each deploy, only from flags (`--storage-mode`, `--s3-*`, `--service-id`, `--spa`, …), then publish with flags (`--fastly-service-id`, `--brotli-quality`, …). The flags exist so that no config file has to stay between builds.

What the second pattern does not have:

- **No answer to "is a deploy necessary?"** CI deploys on each run (a slow Compute build and a new service version each time), or makes its own change detection.
- **Not deterministic.** Each scaffold runs a new `npm install` with caret ranges, so two deploys of the same commit can get different versions of `@fastly/js-compute`.
- **The settings are in the workflow YAML,** as a long list of flags, the same in the deploy and the publish steps and in each workflow. There is no local equal: `dev:start` on a laptop needs the same flags again.
- **No way to customize.** To change `src/index.js`, the customer must stop using the pattern and commit the app by hand.

**Managed mode (part 3) makes this pattern a feature of the package:** the flags become a config file in the project dir, and the package adds the fingerprint (is a deploy necessary?), pinned dependencies, local development, and `eject`. Previews (part 2) and CI support (part 5) make it useful for CI tools, for example a GitHub Action that publishes each push and each PR. Hono (part 6) gives a way to add a small amount of code without ejecting.

Prior art: Expo's *Continuous Native Generation* (`expo prebuild`), and `eject` of Create React App.

### Why 8.1 and not 9

All of it is an addition: a new project file (`static-publish.project.js`), new commands, a new mode, a new export (`/hono`). Existing projects (with a checked-in `compute-js/`) are ejected projects, and they work as before. In 8.1, `scaffold` still makes an ejected project by default; `--managed` is opt-in. To make managed mode the default is a v9 decision.

### Why one release

Hono is in 8.1, together with the template mechanism that it needs. Thus 8.1 is one release with all the features, and the template mechanism is never public without a template that makes it useful.

---

## Part 1: Templates

### `generateApp()` (task 1.1)

- In 8.0.0, `action()` in `src/cli/commands/scaffold/index.ts` does four steps in a row:
  1. Read and check the flags, resolve the paths, and look up the S3 endpoint (a network call).
  2. Make the files in a local map, `resourceFiles`: `.gitignore`, `package.json`, `fastly.toml`, `static-publish.rc.js`, `publish-content.config.js`, `src/index.js`.
  3. Write them.
  4. Run `npm install`, and show the instructions.
- **`generateApp(config: AppConfig) → Record<string, string>`** is step 2, in its own function. It is pure: no file system writes, no network, no console. `AppConfig` has the resolved settings (for example the S3 endpoint after the lookup). Its fields map 1:1 onto the scaffold flags, so that the flags can also override settings in managed mode.
- **Who calls it:**

  | Mode | When | What it does |
  |---|---|---|
  | Ejected | One time, at `scaffold` | Writes `compute-js/`. After that, the app is the customer's code. |
  | Managed (part 3) | At each `dev` and `deploy` | Writes `.static-publish/app/` again. |
  | Managed (part 3) | At `status` | Only in memory, to calculate the fingerprint. |
  | Managed → ejected (part 3) | One time, at `eject` | Writes the same app into `compute-js/`. |

  Thus scaffold, managed mode, and eject cannot drift apart.
- **Order of the commits in PR 1:** first `generateApp()` with output that is byte-for-byte the same as 8.0.0, with the golden-file tests. Then the changes that change the output on purpose (template hooks, `generatedFrom`). Thus the golden files prove that the refactor changes no output, and each later change to a golden file is visible in the diff.

### Templates as real files (task 1.2)

Every file of the app comes from a real file in the `resources/` directory of this package, not from code in multiline strings. Thus type checking, linting, and formatting work on them, and a reviewer reads them as normal files. `package.json` already lists `resources` in `"files"`, so they ship with no build step. (v1 to v6 used the same pattern: the scaffolder copied `resources/index.js` and `resources/webpack.config.js` into the app.)

There are three kinds of files:

| Kind | Files | Source | What `generateApp()` does |
|---|---|---|---|
| Template files | `src/index.js`, `scripts/template_<hook>.js`, … | `resources/templates/<name>/` | Copies them as they are. They are never rendered. |
| `package.json` | The app's `package.json` | `resources/templates/<name>/package.json` | Reads it with `JSON.parse`, sets fields, and writes it with `JSON.stringify`. |
| Config files | `fastly.toml`, `static-publish.rc.js`, `publish-content.config.js`, `.gitignore` | `resources/app/*.njk` | Renders them with Nunjucks. |

#### Template files

- A template file is the same for every app. Code that needs a setting imports `static-publish.rc.js` at runtime, as the `src/index.js` of 8.0.0 does. Thus template files are never rendered, and a new template needs no template syntax.
- **`plain`** is the app of 8.0.0: `resources/templates/plain/src/index.js` is the current `src/index.js`, with no change.

#### `package.json`

- `resources/templates/<name>/package.json` is a real `package.json` with all the `dependencies` and `devDependencies` of the template (for `plain`: `@fastly/js-compute` and `@fastly/cli`). It has no `scripts`, and it does not list this package.
- `generateApp()` reads it with `JSON.parse`. It sets `name`, `version`, `description`, `author`, `type`, `engines`, `private`, and `scripts` (the template hooks, `build`, and the scripts for the storage mode), and adds this package to `devDependencies` (`^<version>`, or in managed mode the `file:` link of task 3.5). Then it writes the file with `JSON.stringify`. The output has the key order of 8.0.0 (the golden files check it).
- The template directory also has a `package-lock.json`. CI checks that it matches the `package.json`. In part 1, `scaffold` does not use it (it runs `npm install`, as in 8.0.0). Part 3 uses it (task 3.5).
- **Dependabot** keeps the dependencies and the lockfile up to date. `.github/dependabot.yml` has the `npm` ecosystem for `/resources/templates/*`. Its PRs are reviewed like other PRs.

#### Config files

`fastly.toml`, `static-publish.rc.js`, `publish-content.config.js`, and `.gitignore` depend on the settings. They need conditionals, not only values: the `[local_server]` and `[setup]` sections of `fastly.toml` and the storage block of the rc are different for KV Store and S3, and some lines are there only when a value is set (`service_id`, the S3 `endpoint`, `publicDirPrefix`, `collectionSelection`, and in part 6 `templateOptions` and `build`). Thus they are rendered with **Nunjucks**, from templates in `resources/app/` (for example `resources/app/fastly.toml.njk`). A renderer that only fills in values (Mustache, or our own) is not enough.

- Whitespace control (`{%- … -%}`) makes the output the same as 8.0.0, byte for byte. The golden files check it.
- **Autoescape is off** (its default escapes for HTML). Each value goes through a filter that serializes it for the type of the file:
  - `js`: a JS value. A string is written with `JSON.stringify`. An object or an array is written as an object literal, with unquoted keys where the key is a valid identifier (the style of the rc files of 8.0.0). This filter writes `generatedFrom`, `collectionSelection`, and in part 6 `templateOptions` and `build`.
  - `toml`: a TOML string, or a TOML key (bare if that is safe, else quoted).

  A unit test fails if a template has a `{{ … }}` without one of these filters.
- **This fixes a bug of 8.0.0:** the scaffolder puts values into `fastly.toml` with no escaping (`description = "${description}"`, and the KV Store name as a key). Thus a `"` in `--description`, or a KV Store name with a `.`, gives a `fastly.toml` that is not valid. A golden case has a description with a quote. CHANGELOG: under `Fixed`.
- **Maintenance:** the last release of `nunjucks` is 3.2.4 (April 2023). The repository is active (commits in 2025 and 2026), and in October 2026 a maintainer said that a new release will come. This package uses only a small, stable part of it (values, `if`, `include`, and filters). If a fix that we need does not come to npm, change to `eta`: only the templates in `resources/app/` change, and the golden files prove that the output is the same.
- Nunjucks is a dependency of the CLI only. It is never in the Wasm bundle.

The interface, as `generateApp()` sees it after it reads a template directory:

```ts
type AppTemplate = {
  files: Record<string, string>,              // only paths that generateApp() does not write
  dependencies: Record<string, string>,       // from the template's package.json
  devDependencies?: Record<string, string>,
  gitignore?: string[],                       // lines added to .gitignore
  supports?: { collectionSelection?: boolean },  // part 2
  // part 6 adds: initFiles, provides, settings
};
```

- There is no `scripts` field. Build steps use the template hooks (task 1.4). Add a `scripts` field later only if a template needs one.

**Templates only add, never replace.** A template never replaces a file that `generateApp()` writes. It adds through typed fields that `generateApp()` merges in: dependencies, `.gitignore` lines, and later `fastly.toml` resources. A path in `files` that `generateApp()` writes is a mistake in our own code (only we write templates; they are inside this package). A unit test over all templates fails for it, and `generateApp()` also throws. If a template needs something special later (for example another `build`), add a typed field for that case.

### `--template` (task 1.3)

- **Input:** `scaffold --template <name>`. Default `plain`. In this part, `plain` is the only valid value. Part 6 adds `hono`.
- A name that is not valid is an error that lists the valid names, and nothing is written. The list of templates is looked up by its own keys only (`hasOwnProperty`), so a name such as `constructor` is not valid.
- `--help` shows the option and the valid names.
- Each template's settings are namespaced (`build.<template>`, `templateOptions.<template>`, part 6). Thus a customer can try another template, and the settings of the earlier template stay, unused.

### Template hooks (task 1.4)

A convention of the platform, so that any template can use it. Every generated app has these scripts in `package.json`:

```json
"prebuild":    "compute-js-static-publish run-template-hook prebuild",
"build":       "js-compute-runtime ./src/index.js ./bin/main.wasm",
"postbuild":   "compute-js-static-publish run-template-hook postbuild",
"postinstall": "compute-js-static-publish run-template-hook postinstall"
```

- `run-template-hook <name>` runs `scripts/template_<name>.js` if it exists, and otherwise does nothing. A failed hook fails the command. The CLI handles `run-template-hook` before it shows the banner and detects the mode.
- The hooks are in **every** app (the runner is always there). `plain` has no hook files, so the hooks do nothing for it. A hook file that a customer adds later to a scaffolded app runs with no other change.
- `build` is the same as in 8.0.0. npm and pnpm both run pre and post scripts (pnpm: `enablePrePostScripts` is `true` by default). The Fastly CLI runs `npm run build` (from `fastly.toml`), so `fastly compute build`, `publish`, and `serve` all run the hooks.
- `npm ci --ignore-scripts` (or `npm install --ignore-scripts`) skips the hooks.

### The template record `generatedFrom` (task 1.5)

`scaffold` (and `eject`, part 3) write a record into the app's `static-publish.rc.js`:

```js
generatedFrom: {
  template: 'plain',
  staticPublishVersion: '8.1.0',
  generatedAt: '2026-10-18',
},
```

- Uses: `template init` (part 6) finds the app's current template; upgrade help later; warnings about settings that the template does not declare.
- Every app made by 8.1 or later has one. `template init` gives an error for an app with no record, with the steps to add it by hand.
- A managed project (part 3) has no `generatedFrom`: its project file names the template (`managed.template`), and the generated rc does not have it either (`generatedAt` would change the fingerprint each day).
- `StaticPublishRc` declares `generatedFrom`, because the scaffolded files have `/** @type {…} */`, and editors that check JS types would flag an unknown field.

### `--default-collection-name` (task 1.6)

New `scaffold` flag. It writes `defaultCollectionName` in `static-publish.rc.js` (default `live`, which is hard-coded in 8.0.0). Part 2 adds the check of the collection name rules to it.

### `--project-dir` and the working dir (task 1.7)

- **`--project-dir <dir>`:** the commands that read `static-publish.rc.js` (`publish-content`, `clean`, `collections …`) read it from `<dir>` in place of the current directory. Thus CI can run the CLI from the repo root:

  ```
  npx @fastly/compute-js-static-publish publish-content \
    --project-dir=./compute-js \
    --collection-name=staging
  ```

- In this part, the project dir is the directory that has `static-publish.rc.js`. Managed mode (part 3) uses the same option for the directory of its project file.
- Nothing may assume one project per repo, or that the project dir is the git root.
- **The working dir** (`staticPublisherWorkingDir`) is resolved against the directory of the config file that has it, not the current directory. In 8.0.0 the code uses `path.resolve(staticPublisherWorkingDir, …)` (for example in `kv-store-local-provider.ts`), which is the same only while commands run where the config file is. `--project-dir` makes them differ.
- `rootDir` and the other paths in `publish-content.config.js` are resolved in the same way.

### `--version` (task 1.8)

- Prints only the version of this package (for example `8.1.0`) on stdout, and exits `0`.
- It works in any directory: the CLI handles it before it detects the mode.
- No short form (`-v`), so that it cannot clash with `--verbose`.
- The version comes from the `package.json` of the copy that runs.
- Part 5 adds `--version --json`.

---

## Part 2: Previews

### Collection names (task 2.1)

- **Rule:** a DNS label, `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`: lowercase `a-z`, `0-9`, and `-`; 1 to 63 characters; no `-` at the start or the end.
- **Why:** a collection name goes into storage keys (`<publishId>_index_<name>`), into the surrogate key of the purge (`<publishId>-<name>`), into the preview cookie, and (with the `host` source of collection selection) into a hostname. A DNS label is safe in all of them. CI tools that make names from branch names (`feature/Foo_bar`) and PR numbers (`pr-42`) can follow a known rule.
- **Cookie safety:** the rule cannot contain a character that breaks a cookie (`;` `,` `=` space, quotes, `\`, control characters). A unit test checks each one.
- **One function**, `validateCollectionName()`, in a module that does not import `fastly:*`. The CLI and the server both use it.
- **CLI:** a new name that breaks the rule is an error: `publish-content` to a new collection, `collections promote --to`, and `scaffold --default-collection-name`. An existing collection whose name breaks the rule shows a warning, and it continues to work (publish again, list, promote from it, delete it).
- **Server:** checks only in the cookie selector, with the full rule, before it writes the value into `Set-Cookie`. In 8.0.0, `CookieCollectionSelector` writes the value from the `activate` URL into the cookie with no check. Thus an old name such as `feature_x` cannot be activated by cookie. The other selectors only read a name, and a name that does not exist only finds no collection.
- **README:** states the rule.

### `PublisherServer`: per-request scope (task 2.2)

- In 8.0.0, `PublisherServer` keeps the state of a request on the instance: `settingsCached` (the settings), `assetEntryMapCache` (the index), and `serverTiming`. Compute can use a sandbox again for a later request, so this state can stay from one request to the next. `beginRequest()` clears the fields as a workaround.
- **Change:** the state is in a `CollectionScope`, kept in a `WeakMap` keyed by the `Request` and the collection. Nothing stays between requests, and two calls for the same request read the index one time.
- The methods that take no request (`getMatchingAsset()`, `serveAsset()`, …) use the current scope, which `beginRequest()` and `setActiveCollectionName()` replace. They work as before.
- **The old public fields** `serverTiming`, `settingsCached`, and `assetEntryMapCache` stay as read-only getters that return the state of the current scope, marked `@deprecated`. Remove them in v9. Code that assigns to them gets a TypeScript error (a getter has no setter). CHANGELOG: under `Deprecated`, not `Removed`.
- This task adds no API. The existing tests must pass with no change. Put it in its own commit in PR 2, so that the reviewer can see that.

### `serveRequest()` options and `serveFallback()` (task 2.3)

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

Collection selection needs `collectionName` and `pathname`. The Hono middleware (part 6) needs all four options and `serveFallback()`.

### Collection selection

A set of options that choose which collection serves a request: the base for previews. Every template that supports it uses the same options with the same meaning. Each template connects it in its own way (the fetch handler for `plain`, a middleware for `hono` in part 6).

#### Where it is

`collectionSelection`, top level in `static-publish.rc.js` (in managed mode: top level in `static-publish.project.js`; not under `templateOptions`), because it is the same for every template.

- It is in the Wasm binary (it must be: selection runs before the collection is known, so it cannot come from the settings of a collection in storage).
- A template declares `supports.collectionSelection`. Scaffolding and managed mode give an error if the option is set for a template that does not support it.
- Data only (strings, numbers, booleans), so that every field can also be a scaffold flag, and `status` can show it.
- **Default:** with no `collectionSelection`, no sources are on. Every request gets the active or default collection, as in 8.0.0. Previews are opt-in, so an upgrade exposes nothing.
- `StaticPublishRc` declares `collectionSelection`.

#### Shape

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

#### Sources

| Type | Reads | Notes |
|---|---|---|
| `host` | The `Host` header, matched against `pattern` | Needs a wildcard domain and TLS on the customer's side. The cleanest URLs; no state. |
| `path` | A URL path prefix. The prefix is removed before the file lookup (the `pathname` option of `serveRequest()`). | Works on `*.edgecompute.app` with no DNS. But links that start with `/` in the site (`/assets/app.css`) lose the prefix, so alone it suits only sites with relative links. With `sticky: 'cookie'`, it sets the cookie and redirects to the path without the prefix, which fixes that. It does **not** change links in HTML. |
| `query` | A query parameter | Only the request that has it. Almost always used with `sticky: 'cookie'` (set the cookie, redirect without the parameter). |
| `cookie` | A cookie. Also serves the activate and reset paths. | The same options as the `collectionSelector.fromCookie` helper. |
| `header` | A request header | For tests, CI checks, and API clients. |

- `sticky: 'cookie'` on `path` or `query`: when this source matches, also set the cookie of the `cookie` source, and redirect to the clean URL. It requires a `cookie` source in the list (for its settings).

#### Patterns

`host` and `path` patterns are plain strings with exactly one `{collection}` placeholder, anywhere in the pattern, with fixed text around it. Examples: `{collection}.preview.example.com`, `branch-{collection}.preview.example.com`, `/_preview/pr-{collection}`.

- The fixed text must match exactly. Host matching ignores case.
- In a hostname, the placeholder stays in one label. Collection names have no dots (task 2.1), so a name cannot cross a label.
- A host label has at most 63 characters, including the fixed text. With `branch-{collection}`, a name can have at most 56 characters there. `previewUrl()` gives an error for a longer name, not a broken URL.
- No RegExp patterns, so that every field can be a scaffold flag and appear in `status`.

#### One resolver (task 2.4)

The logic is in one place, in the server package, in a module that does not import `fastly:*`:

```ts
resolveCollection(request, rc.collectionSelection): {
  collectionName: string | null,  // null: the default collection
  pathname?: string,              // the path without the prefix (path source)
  response?: Response,            // a redirect (sticky, activate, reset)
  matchedBy?: 'host' | 'path' | 'query' | 'cookie' | 'header',
}
```

- Selected names are checked with the rule of task 2.1 before use.
- Use the existing `collection-selector/` helpers where possible.
- `plain` (task 2.6) calls it at the start of the fetch handler: if `response` is set, return it; else pass `collectionName` and `pathname` to `serveRequest()`.
- The behavior is the same for every template, and the code in a scaffolded app stays short.

#### Server behavior (task 2.5)

- **Caching:** when the collection comes from a cookie, a header, or a query, the same URL serves different content. Responses from collections that are not the default get `Cache-Control: private` (or a `Vary`), so that browsers and shared caches do not mix them. The response cache keys on the collection (test in task 2.3).
- **`noindex`:** `X-Robots-Tag: noindex` on responses from collections that are not the default.
- **`onMissing`:** `not-found` makes a mistyped preview easy to see; `default` never shows an error but can hide mistakes. The server must tell "collection not found" from "file not found" (in 8.0.0 both give `null`), so this task adds a small API for this.
- **Exposure:** without `allow`, anyone who guesses a collection name can see unreleased content. `allow` limits the names. The README says that a preview is public to anyone who knows its name. Protection (a token or basic auth) is a possible future feature (see [../README.md](../README.md#possible-future-features)).
- **Production host:** with the `host` source, the production hostname must never match the pattern. Check this when it can be checked.

**To decide in this part:** the shape of the small API that tells "collection not found" from "file not found", for `onMissing`.

#### Preview URLs (task 2.4)

CI tools must show a link for a collection. `previewUrl(collection, baseUrl)` calculates it from the same config. `status` (part 3) also shows the URL templates. The first source in `sources` that can make a URL is the one used.

| Source | Preview URL for `pr-42` |
|---|---|
| `host` | `https://pr-42.preview.example.com/` |
| `path` | `https://<service domain>/_preview/pr-42/` |
| `query` | `https://<service domain>/?collection=pr-42` |
| `cookie` | `https://<service domain>/activate?collection=pr-42&redirectTo=/` |

The flow in CI:

1. CI publishes the PR: `npx @fastly/compute-js-static-publish publish-content --collection-name=pr-42 --expires-in=7d`
2. CI posts the preview link in the PR: `https://pr-42.preview.example.com/` (from `previewUrl()`).
3. A visitor opens `https://www.example.com/?collection=pr-42`. The app sets the cookie and redirects to `https://www.example.com/`. The visitor sees `pr-42` on all pages, until the cookie expires or the visitor opens `/reset`.

#### Flags (task 2.6)

So that disposable and CI setups do not need a config file. The syntax is a proposal; the point is that each field has a flag.

```
--collection-selection=host:{collection}.preview.example.com
--collection-selection=query:collection,sticky
--collection-selection=cookie
--collection-allow=pr-*,staging
--collection-on-missing=not-found
--collection-noindex
```

**To decide in this part:** the final syntax of the flags.

---

## Part 3: Managed mode and eject

### Modes

| | Managed | Ejected |
|---|---|---|
| In the repo | One file, `static-publish.project.js`, in the project dir | The full app dir (`compute-js/`) with `static-publish.rc.js` and `publish-content.config.js`, as in 8.0.0 |
| Who owns the app code | This package (template and config) | The customer |
| Upgrading this package | Change the version; the next deploy generates the app again | As in 8.0.0 (`MIGRATING.md`) |
| Deploy when | The fingerprint of the generated app changes | The customer deploys (or a CI tool decides) |
| Customize | Config options (part 6: Hono extensions) | Anything |

PR 3 defines the two terms in the code and the docs where they first appear. Every app that `scaffold` made before (and every app that `scaffold` makes without `--managed`) is an ejected app.

**Detection: the file name is the marker.** In the directory where the CLI runs (or `--project-dir`):

| File | Mode |
|---|---|
| `static-publish.project.js` | **Managed** |
| `static-publish.rc.js` | **Ejected**: management mode, as in 8.0.0. ("An rc means an app" stays true: only apps have an rc.) |
| Neither | Scaffolding, as in 8.0.0. New: `--managed` writes only `static-publish.project.js`. |
| Both | An error, with a clear message |

Why a different name: if a managed project used `static-publish.rc.js` in the project dir, and `eject` then moved it into `compute-js/`, customers would see the same file appear in a new place, which is confusing. With its own name, the project file is clearly a different kind of file, and `eject` converts it into the two traditional files.

### Directory layouts (tasks 3.1 and 3.9)

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
├── compute-js/                        ← committed now: the app, owned by the customer
│   ├── static-publish.rc.js           ←   from the project file: staticPublisherWorkingDir: '../static-publisher', and generatedFrom
│   ├── publish-content.config.js      ←   from publishContent: rootDir: '../public'
│   ├── fastly.toml                    ←   [local_server] → ../static-publisher/kvstore.json
│   ├── package.json, package-lock.json
│   ├── src/index.js
│   └── .gitignore                     ←   node_modules, bin, pkg (no working dir: it is outside the app)
└── static-publisher/                  ← ignored: the same working dir, with the same data
```

`static-publish.project.js` is gone, and `.static-publish/` can be deleted.

**Ejected, scaffolded directly (the layout of 8.0.0, with the additions of part 1):**

```
my-site/
├── public/                            ← committed: the content
└── compute-js/                        ← committed: the app
    ├── static-publish.rc.js           ←   staticPublisherWorkingDir: './static-publisher', and generatedFrom
    ├── publish-content.config.js      ←   rootDir: '../public'
    ├── fastly.toml                    ←   [local_server] → ./static-publisher/kvstore.json
    ├── package.json, package-lock.json
    ├── src/index.js
    ├── scripts/                       ←   optional: template_<hook>.js files
    ├── .gitignore                     ←   node_modules, bin, pkg, static-publisher
    └── static-publisher/              ←   ignored: the working dir
        ├── kvstore.json
        └── storage-content/
```

"Ignored" means generated, local to the machine, and possible to make again from what is committed (like `node_modules`). It does not mean "deleted after each run": local development uses `kvstore.json` between commands, and the next publish reuses `storage-content/`.

- The project dir is where the CLI runs, or `--project-dir` (task 1.7). Each project has its own config, cache dir, and Fastly service.
- The generated app is in `<project>/.static-publish/`, one per project, gitignored.
- **`.gitignore`:** `scaffold --managed` adds `.static-publish/` and the working dir to the `.gitignore` in the project dir. If the file is missing, it makes it. If it exists, it adds only the missing lines, at the end, under a comment `# @fastly/compute-js-static-publish`, and never changes the customer's lines. It shows what it added. In a subdirectory of the repo, this is a nested `.gitignore`, and its lines apply relative to that directory.
- `publish-content`, `collections`, and `clean` run from the project dir and read `static-publish.project.js`. They never use the generated files in `.static-publish/app/`, so publishing content does not need a generated app.

**To decide in this part (task 3.1):** whether ejected-mode commands also accept `--app-dir`, so that they can run from a directory above the app.

### The working dir (task 3.3)

One rule for both modes. The path is relative to the file that has it (task 1.7): `static-publish.project.js` (managed: `my-site/static-publisher/`) or `static-publish.rc.js` (ejected: `compute-js/static-publisher/`, as in 8.0.0). The CLI commands never read paths from the generated rc in `.static-publish/app/`. Thus the working dir is beside the project file, and generating the app again never deletes the local data.

- **Validation:** a relative path that starts with `./` or `../`. Not an absolute path, and not a path that resolves to the directory of the config file or a directory above it (for example `./`, `..`, `../..`), so that `publish-content` never writes its files among the customer's own files. In 8.0.0, the value must start with `./` (and not be `./`); the new rule also allows paths outside the config dir, on purpose (`../x`, which is the same as `./../x`). **A security-relevant change: review it carefully.**
- **`eject`** writes the value again, so that it points at the same directory from the new location of the rc: `./static-publisher` in the project file becomes `../static-publisher` in `compute-js/static-publish.rc.js`. The local data stays where it is.
- The CLI deletes only `<file>_chunks` directories that it made (under paths from content hashes), never the working dir or anything above it. Thus allowing `../` gives the CLI no new place to delete.
- **What is in it:** `storage-content/`, the prepared files of each publish (compressed variants, chunks, the index and settings JSON), which works as a cache (safe to delete; the next publish makes it again); and `kvstore.json` from `publish-content --local`, which is the local KV Store for `fastly compute serve` (`[local_server]` in `fastly.toml` points at it). No secrets.
- The `kvstore.json` path in the generated `fastly.toml` comes from the working dir, so after `eject` it is `../static-publisher/kvstore.json`.

### The project file `static-publish.project.js` (task 3.1)

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
    server: { notFoundPageFile: '/404.html' },
  },

  // Read by the generator only:
  managed: {
    name: 'my-site',          // fastly.toml, package.json
    description: 'My site',
    authors: ['me@example.com'],
    template: 'plain',        // the only valid value until part 6
    serviceId: undefined,     // written after the first deploy
    staticPublishVersion: '8.1.0',  // the version of this package that the project uses
  },
};
```

- `publishContent` has exactly the fields of a `publish-content.config.js`. Its paths are relative to the project dir.
- **`publish-content --config <file>`** works as in ejected mode: the file is a normal `publish-content.config.js`, and it is used in place of `publishContent`, for that run only. Thus one managed app can publish collections with different server settings.
- `managed` is a section for the fields that only the generator reads. It does not mark the mode (the file name does).
- **`managed.template`** (task 3.4): the template of the generated app. `plain` is the only valid value in this part, and a missing value means `plain`. Part 6 adds `hono`. A value that is not valid is an error that lists the valid names.
- Types: a new type `StaticPublishProject` = the fields of `StaticPublishRc`, plus `publishContent` (`PublishContentConfig`), `managed`, and (part 6) `templateOptions` and `build`.

### Why the settings stay in separate sections

In ejected mode, the settings are in two files. The split came in v7.0.0, in the same release that added collections and stopped putting the files into the Wasm binary. The reasons are still true, so the project file keeps the same split, as sections of one file:

- **When a change takes effect.** `src/index.js` imports the rc, so the rc is in the Wasm binary, and a change needs a deploy. Only the CLI reads the publish settings. Their `server` part is saved in storage **for each collection**, so a change takes effect at the next publish, with no deploy.
- **One app, many collections.** `publish-content --config <file>` can use different publish settings for each publish. There is one rc for each app, but there can be several publish configs.
- **Who reads it.** The rc has what the CLI and the server must agree on (storage, `publishId`, `defaultCollectionName`). The publish settings have what only the CLI needs, including functions (`assetInclusionTest`) and regexes (`contentTypes`), which must never go to the edge.

### Sections of the project file

| Section | Read by | In the generated rc (Wasm)? | After eject | Examples |
|---|---|---|---|---|
| Top level | The app at runtime | Yes | `static-publish.rc.js` | `storageMode`, `s3`, `publishId`, `defaultCollectionName`, `collectionSelection`, `templateOptions` (part 6) |
| `publishContent` | `publish-content`, at publish time | **No** | `publish-content.config.js` (its own file) | `rootDir`, `contentTypes`, `server`, `hiddenItems` (part 4) |
| `build` (part 6) | Build scripts, in both modes | Yes, with its paths written again relative to the generated rc | `static-publish.rc.js` | `hono.extensionsDir` |
| `managed` | The generator only | No | Removed; `generatedFrom` is written | `name`, `description`, `authors`, `template`, `serviceId`, `staticPublishVersion` |

`generatedFrom` (written by scaffold and eject) is only in an ejected app's `static-publish.rc.js`, never in the project file.

How to decide: *does the running app read it?* Top level. *Only `publish-content`?* `publishContent`. *Does the build need it, in managed and in ejected mode?* `build`. *Only to generate the app from a template?* `managed`.

Rules:

- **The app sees the whole rc at runtime.** `src/index.js` imports `static-publish.rc.js`, and the build bundles it, so the app can read any key. Nothing checks unknown keys at runtime.
- **Managed mode:** the generator writes `static-publish.rc.js` into the app with the top-level fields and (part 6) `build`, which has the settings for the build. It writes the paths in `build` again, relative to the generated rc. It never writes `publishContent`, `managed`, or `generatedFrom`. Thus a change to `publishContent` or the write-back of the service ID does not change the fingerprint, and functions and regexes never go to the edge. The generated rc is the same as the rc that `eject` writes, except for `generatedFrom` and the paths. `build` has only paths, so it adds no secrets and no functions to the Wasm binary, the same as in ejected mode.
- **Ejected mode:** `src/index.js` imports the real rc file, so `build` and `generatedFrom` are in the Wasm binary. That does no harm (no secrets; the rc already has the CLI-only `staticPublisherWorkingDir`), and there is no fingerprint to protect.
- The `managed` fields map 1:1 onto the scaffold flags (`--name`, `--service-id`, `--template`, …), so the flags continue to work as overrides.
- The `[setup]` and `[local_server]` sections of `fastly.toml` come from `storageMode`, `s3`, and `kvStore`, as scaffolding does in 8.0.0.

### Non-interactive mode (task 3.2)

Requirements from tools that run this package with no person present:

- **Non-interactive** when `--non-interactive` is given or the `CI` env var is set: the CLI never asks a question. Missing input is an error with a clear message.
- **Credentials** from env vars (`FASTLY_API_TOKEN`, `FASTLY_SERVICE_ID`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`). A token value never shows in logs or errors.

### Dependencies (task 3.5)

The same version of this package and the same config must make the same app, including the resolved dependency versions. Without that, two deploys of the same commit can get different versions of `@fastly/js-compute` and the ~160 packages below it (the compiler toolchain). The deployed app does not change by itself (the fingerprint decides when to build), but a later deploy, for example for a small config change, can then also get a new toolchain that nobody asked for, and a laptop and CI can build different apps from the same commit.

- **Tentative: a lockfile for each template (A):** the lockfile next to the template's `package.json` in `resources/templates/<name>/`, and its CI check, come in task 1.2. This task uses it. Managed mode runs `npm ci`. The alternative is exact versions in `package.json` and no lockfile (B), which pins the direct dependencies but not the packages below them. Task 3.5 tests A and keeps it, or changes to B.
- **How the lockfiles are shipped:** each template's lockfile is in its template directory in `resources/`, which the package ships. npm leaves out only the **root** `package-lock.json` of a published package: a nested `package-lock.json` is kept (checked with npm 11, `npm pack --dry-run`). Thus the template lockfiles can keep the normal name. Check again with the npm version of the release workflow.
- **Who updates them:** Dependabot (task 1.2), in the same PR as the `package.json`. A template's `package.json` has no `scripts` and does not list this package (`generateApp()` adds both), so `npm install` in the template directory runs no hooks, and the lockfile has no `file:` link. To update a lockfile by hand, run `npm install --ignore-scripts` in its template directory.
- **Private registries:** a lockfile has `registry.npmjs.org` URLs; npm 7 and later replace the default registry with the one configured in `.npmrc`.
- **Who installs:** `deploy` and `dev` run `npm ci` in the generated app dir only when the generated `package.json` or lockfile changed.
- **To keep a later change between A and B local to task 3.5:**
  - The fingerprint (task 3.7) hashes the **whole output of `generateApp()`**. A lockfile is only one more generated file.
  - `eject` (task 3.9) writes what `generateApp()` made.
  - One helper, `pinnedVersion(template, package)`, gives the version that a template pins. Part 6 code calls only this helper.
- **This package in the generated app.** The app's `src/index.js` imports this package (the server code, which the build bundles into the Wasm binary), so the app's `node_modules/` must have it. It must be **exactly** the version of the running CLI, and a lockfile made at release time cannot list it (the version is not published yet, so its hash is not known). Thus the generated app uses **the copy of this package that runs the CLI**, through a `file:` link:
  - `package.json`: `"@fastly/compute-js-static-publish": "file:<absolute path of the CLI's package dir>"` (in `devDependencies`).
  - The generator adds to the template's lockfile: the same spec in `packages[""].devDependencies`; `packages["node_modules/@fastly/compute-js-static-publish"] = { "resolved": "<path relative to the app dir>", "link": true }`; and `packages["<path relative to the app dir>"]` with `version`, `license`, `dependencies`, `bin`, `devDependencies`, `engines`, and `peerDependencies` from the CLI's own `package.json`, and `"dev": true`.
  - Result (tested with a local install and an `npx` install, and with the app in a project that has the CLI as a dev dependency): `npm ci` accepts it and does not change the lockfile; npm links the bin `compute-js-static-publish`; a `postinstall` hook runs during `npm ci`; a later `npm install` keeps the link; nothing is written into the CLI's install; the app builds and serves content.
  - Not chosen: leaving this package out and making a symlink after `npm ci`. It also builds, but npm does not link the bin, a `postinstall` hook makes `npm ci` fail (exit 127), and `npm ci` and `npm install` both remove the symlink.
  - The path is different on each machine, so the fingerprint uses this package's **version**, not the path.
  - **Upgrading:** the generated app always uses the running CLI's copy, so nothing in the generated app is pinned separately. Which version runs depends on how the CLI is started: a dev dependency of the project (the version in its lockfile), `npx …@8.1.0` (that version), or `npx …@latest` (the newest, at each run). The project file records the version, so that an upgrade is always explicit (see "The version of this package" below).
  - **Paths in the Wasm binary:** every Compute JS build already contains its build directory (the build snapshot captures `PWD`). The bundle also has the paths of the bundled modules, relative to the app. With the CLI run through `npx`, these go into the npm cache, so the deployed binary contains the customer's home directory (about 112 strings like `/Users/<name>/.npm/_npx/…`). With the CLI as a dev dependency of the project, the paths stay in the project. Thus the docs recommend the CLI as a dev dependency of the project in managed mode, and `deploy` can warn when the CLI runs from the npx cache (see [`deploy`](#deploy-task-38)).

**To test in this part:**

- The lockfile choice: A or B. Keep A unless shipping lockfiles turns out to be too difficult. (A test of A found no problem.)
- Windows (npm uses junctions for `file:` links).
- npm 9 and 10, for nested lockfiles in the tarball.
- A CLI run from a local checkout of this repo (the bin can lose its execute bit after a rebuild).
- `npm ci` with a lockfile that has `registry.npmjs.org` URLs and a private registry in `.npmrc`.

### `dev` (task 3.6)

Generate the app, install (if necessary), then run `fastly compute serve` in `.static-publish/app/`. The content comes from `publish-content --local`, as in 8.0.0. The `[local_server]` section must point at the project's `kvstore.json` (in the working dir in the project dir), not at one in the cache dir.

### Fingerprint and `status` (task 3.7)

- **The fingerprint** is a SHA-256 over the whole output of `generateApp()` and the version of this package (part 6 adds the contents of `hono-extensions/` and its lockfile). It does not include the service ID, `generatedFrom`, or any content.
- **Where the deployed fingerprint is:** in the comment of the service version. `deploy` runs `fastly compute build`, then `fastly compute deploy --comment "…"` (`--comment` sets the comment before the version is activated). `status` reads the comment of the active version through the API. Thus it is true about what is active, also after a rollback or a deploy by hand.
- **`status`** shows the mode, the service ID, the current fingerprint, the deployed fingerprint, if a deploy is necessary (and why), and the preview URL templates (part 2). In ejected mode: the mode and the service ID. Without an API token: the current fingerprint, and the deployed one as unknown. The output is text in this part; part 5 adds `--json`.

Example:

```
$ npx @fastly/compute-js-static-publish status
Mode: managed. A deploy is necessary: the app changed.
$ npx @fastly/compute-js-static-publish deploy
$ npx @fastly/compute-js-static-publish deploy
No change since the last deploy. Nothing to do.
```

### The version of this package (task 3.8)

The project file records the version of this package that the project uses: `managed.staticPublishVersion`. `scaffold --managed` writes it. Reason: with `npx …@latest` (or with no version and no local install), a new release would otherwise upgrade the project silently. The fingerprint includes the version, so the next run would deploy a new app, with new pinned dependencies, with no change in the repo.

At each `dev` and `deploy`, the CLI compares the recorded version with its own:

| Running CLI | Result |
|---|---|
| The same version | Continue. |
| **Newer** | **Stop**, with a message: "This project uses 8.1.0. You are running 8.2.0. Run `upgrade` to move the project to 8.2.0, or use `--auto-upgrade`." |
| Newer, with `--auto-upgrade` | Write the new version into `managed.staticPublishVersion` (the same marked-line write-back as `serviceId`), and continue. In CI, the checkout is not committed, so the version in the repo stays old, and each later run upgrades again in its own checkout. This does no harm. |
| **Older** | **Stop** (no flag changes this): an older CLI must never deploy over an app made by a newer one. The message names the version that the project needs. |

- **`upgrade`** (new command, managed mode): sets `managed.staticPublishVersion` to the running CLI's version. Later releases can also migrate the project file there.
- **`status`** shows the recorded and the running version, and why a deploy is necessary (for example "the version of this package changed: 8.1.0 → 8.2.0").
- **For customers with a dev dependency:** when the dev dependency is bumped (by a person or by Dependabot), the next `deploy` stops until someone runs `upgrade` and commits the new version. This is the explicit upgrade, as intended. (Later, the version in the project's lockfile could count as the record. Not in 8.1.)
- **Docs:** recommend a pinned version (a dev dependency, or `npx …@8.1.0`). `@latest` with `--auto-upgrade` means automatic upgrades.
- If `managed.staticPublishVersion` is missing (the customer removed it), `dev` and `deploy` stop and say to run `upgrade`.

### Service ID (task 3.8)

- The order of precedence: `--fastly-service-id`, then the `FASTLY_SERVICE_ID` env var, then `managed.serviceId`.
- The Fastly CLI writes `service_id` into the generated `fastly.toml`, which is in the cache dir. After the first deploy, `deploy` writes it into `managed.serviceId` in `static-publish.project.js`: `scaffold --managed` writes the line `serviceId: undefined,` in the `managed` section, and `deploy` replaces exactly that line with the ID. If the line is not there (the customer changed it), `deploy` shows the ID and where to put it. It never changes other JavaScript.
- In CI, writing back to the repo is not practical, so the first deploy is usually local, or CI passes the ID of a service that exists.

### `deploy` (task 3.8)

`deploy [--force] [--auto-upgrade]`: generate, install (if necessary), build, then deploy, only if the fingerprint changed (or with `--force`). Record the fingerprint in the version comment. Write back the service ID. The output shows the service ID, the version, and the default domain. Part 5 adds `--json`.

**First deploy with S3 storage: by hand in 8.1.** With non-interactive mode, S3, and no service ID, `deploy` fails with a clear message: do the first deploy locally (the Fastly CLI asks for the two secrets), or give the ID of a service that is already set up. Later deploys from CI work.

- Reason (from the Fastly CLI source): in non-interactive mode, the Fastly CLI fails for any `[setup]` Secret Store that lists entries (`value cannot be blank`), even if a store with that name exists. It checks the values before it links or makes anything.
- A bootstrap through the API is a possible future feature (see [../README.md](../README.md#possible-future-features)).

In ejected mode, `deploy` is an optional wrapper around `fastly compute publish`.

**To decide in this part:**

- The format of the version comment (for example `static-publish 8.1.0 fp:<sha256>`), and whether a customer comment (for example a commit SHA) can be added.
- Whether `deploy` warns when the CLI runs from the npx cache (the deployed Wasm binary then contains the customer's home directory; see "Paths in the Wasm binary" in [Dependencies](#dependencies-task-35)).

**To test in this part:** a non-interactive first deploy in KV Store mode (the `[setup]` KV Store has no entries, so it should work).

### `eject` (task 3.9)

`eject` writes the app that managed mode would deploy, and converts the project file into the two files of an ejected app:

1. Generate the app exactly as `deploy` would, into `./compute-js` (or `--dir`).
2. **Split** `static-publish.project.js` into the two traditional files in `compute-js/`: `static-publish.rc.js` (the top-level fields and `build`, plus the `generatedFrom` record) and `publish-content.config.js` (the `publishContent` section). Write paths again, relative to the new location (`rootDir`, `staticPublisherWorkingDir`, and in part 6 `build.hono.extensionsDir`), so that they point at the same directories. Then delete `static-publish.project.js`.
3. Write the values of the `managed` section into `fastly.toml` and `package.json`, including `service_id` (from the section, the env var, or the flag).
4. Write the dependencies, so that the first ejected build is the same as the last managed deploy (the same fingerprint):
   - This package: `"@fastly/compute-js-static-publish": "^8.1.0"` (a caret range, as scaffolding writes), never the `file:` link of managed mode, which points at a path on one machine. The range lets `npm update` (and Dependabot) upgrade it within 8.x.
   - The lockfile: the lockfile that managed mode used, with the `file:` link entries replaced by a normal entry for exactly `8.1.0` from npm (`eject` runs one `npm install` in `compute-js/`, so it needs the network one time). Thus `npm ci` builds the same app until the customer chooses to upgrade.
   - If the CLI's version is not on npm (a local checkout, or a build that is not published), `eject` stops with a clear message: ejecting needs a published version.
5. Show what changed, and that the customer now owns upgrades.

- After step 2, the project dir has no project file, and `compute-js/` has an rc, so detection is clear.
- `eject` refuses if the target dir exists, unless `--force`.
- In ejected mode, `eject` gives an error: the app is already ejected.

**To decide in this part:** `.gitignore` after eject. The working dir (`my-site/static-publisher/`) stays ignored by the project's `.gitignore`. `generateApp()` adds the working dir to the app's own `.gitignore` only if it is inside the app dir. The `.static-publish/` line in the project's `.gitignore` is stale after eject: `eject` says so in its summary, but never changes the customer's `.gitignore`.

### Docs (part 3)

- README: "Managed and ejected apps", with the definitions of the two terms.
- `MIGRATING.md`: how to move an existing project to managed mode (steps by hand).
- The least-privilege API token scope for deploy, publish (purge), and collections.

### Compatibility

- No change for existing projects (they are ejected projects).
- `scaffold` makes an ejected project by default in 8.1. `--managed` is opt-in. The default could change in v9.

---

## Part 4: Hidden files

A hidden file is published, but `PublisherServer` does not serve it for a request. Code can get it only if it asks for hidden files. Examples: the 404 page (a request for `/404.html` must not return the 404 page with status `200`), templates that the app reads with `getMatchingAsset()`. It also replaces the use of `--public-dir` and `server.publicDirPrefix` (deprecated in 8.0).

**Hidden is not access control.** Hidden files are in the KV Store or the bucket, the same as other files, and code that asks for hidden files can serve them. The README must say: do not use hidden files for secrets.

### Marking (task 4.2)

In `publish-content.config.js` (in managed mode: the `publishContent` section of the project file), both ways. A file is hidden if either says so:

```js
const config = {
  rootDir: '../public',
  // the same format as server.staticItems: a '/dir/' prefix, an exact path, or a 're:' regex
  hiddenItems: [ '/templates/', '/404.html' ],

  // or, for anything else:
  assetInclusionTest: (key) => key.endsWith('.tpl') ? { hidden: true } : true,

  server: { notFoundPageFile: '/404.html' },   // still works as the fallback
};
```

- `assetInclusionTest` returns only `true` or `false` in 8.0.0. An object is truthy, so `{ hidden: true }` is backward compatible.
- **SPA file and 404 page:** hidden only if they are marked. No change for existing sites.
- **CLI:** `collections list` shows the number of hidden files, and the summary of `publish-content` says how many it hid. Part 5 adds the count to their `--json` output.

### Index format and server (task 4.1)

- Hidden entries use keys with a `hidden:` prefix, for example `hidden:/404.html`. No request path can match such a key. The index metadata has `requires: hidden`, and `SUPPORTED_INDEX_FEATURES` gets `hidden`.
- **It fails closed on every older server:** 8.0.0 and later do not serve a collection that requires `hidden`. v7 and the 8.0 betas do not have that check, but they cannot find the files, because no request path matches a `hidden:` key.
- **Why this matters:** the CLI that publishes and the server in the deployed Wasm binary can have different versions (for example, a customer installs a later version and publishes, but does not deploy again; or a staged or rolled-back version, or a second app, reads the same storage).
- `serveRequest()` never matches a hidden file, also not with `autoIndex` or `autoExt`.
- `getMatchingAsset(assetKey, { applyAuto, includeHidden })` returns a hidden file when `includeHidden` is set. A boolean second argument (the 8.0.0 `applyAuto`) still works.
- The SPA and 404 fallbacks can serve hidden files. The settings keep `spaFile: '/404.html'`; the fallback lookup also tries `hidden:` + the key.
- The check in `publish-content` that `spaFile` and `notFoundPageFile` exist and are HTML also finds hidden entries.
- No collision: a real file always has a key that starts with `/` (a file named `hidden:x` has the key `/hidden:x`). `clean` reads the hashes of all index entries, so it keeps the content of hidden files.

### Docs (task 4.3)

README; `MIGRATING.md` ("Stop using `publicDirPrefix`") recommends hidden files in place of "move the file and block its path in `src/index.js`"; CHANGELOG.

---

## Part 5: CI: machine-readable output

Requirements from tools that run this package with no person present (for example a GitHub Action that publishes each push and each PR), and where each is met:

| # | Requirement | Where |
|---|---|---|
| 1 | No prompts with `--non-interactive` or when `CI` is set; missing input is an error with a clear message | Task 3.2 |
| 2 | Credentials from env vars; never shown in logs or errors | Task 3.2 |
| 3 | Run from the project dir, or with `--project-dir`; nothing assumes that the project dir is the repo root | Tasks 1.7, 3.1 |
| 4 | "Is a deploy necessary?": `status --json` | Tasks 3.7, 5.1 |
| 5 | `--json` for `deploy` (service ID, version, default domain), `publish-content` (collection, files uploaded, reused, and hidden, expiry), and `collections list` | Task 5.1 |
| 6 | Exit codes: `0` success, not `0` failure. A failed purge after a successful publish stays a warning, but is in the JSON | Task 5.2 |
| 7 | Defined collection name rules | Task 2.1 |
| 8 | Idempotent operations | Task 5.4 |
| 9 | Collection selection as options of the templates, all settable by flags | Tasks 2.5, 2.6 |
| 10 | Preview URLs from the same config | Tasks 2.4, 5.1 |

Nice to have:

- `collections list --json` with expiry and the time of the last publish, for cleanup and rollback tools.
- A way to pass a commit SHA or message into the comment of the deployed version and into the collection metadata, for traceability (task 3.8 decides the format of the version comment).

### `--json` (task 5.1)

- **Commands:** `publish-content`, `collections list`, `status`, `deploy`, and `--version`.
- **stdout has exactly one JSON object,** printed at the end. The normal log lines go to stderr, so that they still show in the CI log.
- **The banner** ("🧑‍💻Fastly Compute JavaScript Static Publisher (… mode)") goes to stdout in 8.0.0. With `--json`, it goes to stderr (or is not shown), so that stdout has only the JSON object.
- **Schema version:** each JSON object has `schemaVersion: 1`. Adding a field keeps the version. Removing or changing a field increases it, only in a major release.
- **`--version --json`:** `{ "schemaVersion": 1, "version": "8.1.0" }`.
- **`status --json`:** the mode, the service ID, the current and the deployed fingerprint, `needsDeploy`, the recorded and the running version of this package, and the preview URL templates. Part 6 adds the packages that the template provides.
- **`deploy --json`:** the service ID, the version, and the default domain.
- **A failed purge** after a successful publish stays exit `0` (as in 8.0.0, a warning), because the content is published. The JSON shows it: `"purge": { "ok": false, "environment": "production", "error": "…" }`. Old content can be served from the cache until it expires, so tools that care read `purge.ok`.

Example:

```
$ npx @fastly/compute-js-static-publish publish-content \
    --project-dir=./site --collection-name=pr-42 --json 2>/dev/null
{
  "schemaVersion": 1,
  "collection": "pr-42",
  "files": { "uploaded": 12, "reused": 340, "hidden": 2 },
  "expiresAt": "2026-11-04T00:00:00Z",
  "purge": { "ok": true }
}
$ echo $?
0
```

### Exit codes (task 5.2)

- `0`: success (also "nothing to do").
- `1`: the operation failed, and a retry can help (for example an upload error, storage that cannot be reached, a failed deploy).
- `2`: a usage or config error, so the command could not start, and a retry cannot help (for example an unknown flag, a missing option, a collection name that breaks the rule, a broken `static-publish.rc.js`).

### Errors (task 5.3)

With `--json`, stdout still has exactly one JSON object: `{ "schemaVersion": 1, "error": { "code": "…", "message": "…" } }`.

- `code` is a stable string for scripts, for example `collection-name-invalid`, `missing-option`, `storage-unreachable`, `deploy-failed`. The list of codes is part of the contract.
- `message` is for people and can change.
- The error also goes to stderr, so that the CI log shows it.

**To decide in this part:** the list of `error.code` values.

### Idempotent operations (task 5.4)

To publish the same content to the same collection again, to promote to the same target, or to delete a collection that does not exist, is a success, with exit `0`. The JSON says what happened, for example `"deleted": false, "reason": "not-found"`.

---

## Part 6: Hono

- Hono: the middleware export `/hono` (task 6.2) and the `hono` template (task 6.3). In 8.0.0, Hono support is in a separate package, `@fastly/hono-compute-js-static-publish`, which supports only v6 and v7. Its `serveStatic()` looks up the request path in the index directly, so it does not use `autoIndex`, `autoExt`, the response cache, or `Server-Timing`.
- Hono extensions (tasks 6.4 to 6.8): customers add their own Hono middleware and routes, with files in a known folder and options from the config, in managed and in ejected apps. The main example: GRIP middleware (`@fanoutio/serve-grip/hono`) and a streaming route, or auth middleware, with no eject.

### The value `hono` (task 6.1)

- `--template hono` (task 1.3) and `managed.template: 'hono'` (task 3.4). Until this part, `plain` is their only valid value.
- **Switching templates in managed mode:** change `managed.template`. The next `dev` or `deploy` generates the app again with the new template, `npm ci` installs the new template's dependencies (and removes what the old template had), and the change of the fingerprint triggers a deploy.
- **In ejected mode there is no switching.** The app is the customer's code, and `generatedFrom.template` is only a record. To move an ejected app to another template is a change by hand.

Example:

```
npx @fastly/compute-js-static-publish@latest \
  --root-dir=./public \
  --kv-store-name=site-content \
  --template=hono
```

### Hono middleware (task 6.2)

`@fastly/compute-js-static-publish/hono`. The module imports only types from `hono`, so it does not add `hono` to the bundle. `hono` is an optional peer dependency (`^4.0.0`). `package.json` gets a new export, `./hono`.

```js
import { Hono } from 'hono';
import { fire } from '@fastly/hono-fastly-compute';
import { fromStaticPublishRc } from '@fastly/compute-js-static-publish/hono';
import rc from '../static-publish.rc.js';

const { serveStatic, serveFallback } = fromStaticPublishRc(rc);

const app = new Hono();
app.get('/api/hello', (c) => c.json({ hello: 'world' }));  // the customer's route
app.use('*', serveStatic());                               // the published files
app.notFound(serveFallback());                             // SPA file or 404 page
fire(app);
```

#### `fromStaticPublishRc(rc, defaults?)` and `fromPublisherServer(server, defaults?)`

- Input: the contents of `static-publish.rc.js`, or a `PublisherServer`. Optional `defaults.collectionName`.
- Output: `{ publisherServer, serveStatic, serveFallback }`. `serveStatic` and `serveFallback` make middleware that uses the defaults. An option in a call replaces the default.

#### `serveStatic(options?)` → Hono `MiddlewareHandler`

- Input: the request (`c.req`), and these options:
  - `root`: the directory that request paths are relative to, in the published files (after `publicDirPrefix`, if it is set). Default `./`.
  - `path`: a path to serve in place of the request path, for example `./favicon.ico`.
  - `rewriteRequestPath(path, c)`: changes the request path before it is resolved against `root`.
  - `collectionName`: a string, `null` (the default collection), or `(c) => string | null | undefined`. `undefined` selects the active collection.
- Output:
  - A file matches: the response of `serveRequest()`, including `304`, the compressed variants, the cache headers, the response cache, and `Server-Timing`.
  - No file matches, or the method is not `GET` or `HEAD`: `next()` is called, so a later route can handle the request.
  - The resolved path is outside `root` (for example with `..`): the file is not served, and `next()` is called.
- `serveStatic()` does not serve the SPA file or the 404 page, and does not answer `/healthz`. (It calls `serveRequest()` with `fallback: false` and `healthCheck: false`.)
- A fix from the old package: `root += root` is now `root += '/'`.

#### `serveFallback(options?)` → Hono `NotFoundHandler`, for `app.notFound()`

- Input: the request, and `collectionName` as above.
- Output: the SPA file with status `200` if the collection has one; else the 404 page with status `404` if it has one; else, or if the client does not accept HTML, Hono's default `404 Not Found` text response.

#### Migration from the old package

`MIGRATING.md` gets "Move from `@fastly/hono-compute-js-static-publish`": uninstall the old package and make `hono` a dependency; change the import; get `serveStatic` (and `serveFallback`) from the object that `fromStaticPublishRc()` returns; `serveStatic()` now applies `publicDirPrefix` (deprecated), `autoIndex`, and `autoExt`, and serves only `GET` and `HEAD`, so `root` is relative to `publicDirPrefix` if it is set; `serveStatic()` does not serve the fallback pages, so add `app.notFound(serveFallback())`.

### The `hono` template (task 6.3)

- **Input:** `--template hono` (or `managed.template: 'hono'`).
- **Output:**
  - `src/index.js`: a Hono app. It uses `serveStatic()` for files, `app.notFound(serveFallback())` for the SPA file and the 404 page, and `fire(app)` from `@fastly/hono-fastly-compute`.
  - Extra `dependencies` (in the template's `package.json`, task 1.2): `hono` `^4.13.0` and `@fastly/hono-fastly-compute` `^0.4.0` (0.4.0 accepts `@fastly/js-compute` 4).
  - `gitignore`: `.hono-extensions/` and `src/hono-extensions.generated.js` (task 6.6).
- The template does not use `hono/service-worker`: by default, its handler sends each 404 response to `fetch()`, and Compute has no default backend.
- The template uses `logFastlyServiceVersion()` from `@fastly/hono-fastly-compute`, in place of its own logging middleware.
- **Values of this package on `c.var.staticPublisher`** ("things that belong to static-publisher"), set by a middleware of the template before the extensions. `/hono` exports the type.
  - `c.var.staticPublisher.publisherServer`: the app's `PublisherServer`.
  - `c.var.staticPublisher.collectionName`: the collection that collection selection chose.
- **Collection selection:** a middleware calls `resolveCollection()`, returns its `response` if it has one, and sets `c.var.staticPublisher.collectionName`. `fromStaticPublishRc(rc, { collectionName: (c) => c.var.staticPublisher.collectionName })`. The `path` source uses `rewriteRequestPath`. The template declares `supports.collectionSelection`.
- **Managed mode:** the `hono` template's lockfile (task 3.5), and tests with `managed.template: 'hono'`, including a switch from `plain` to `hono`.

**To decide in this part:** the name of the template's middleware that sets `c.var.staticPublisher` (this file uses `staticPublisherVars()` as an example), and the exported type for `c.var`.

### Hono extensions

A feature of the `hono` template, not of the core of this package. The folder is named `hono-extensions/`, because it is specific to the `hono` template and configures it.

#### Layout

```
my-site/                          ← project dir
├── static-publish.project.js
└── hono-extensions/              ← the customer's code (committed)
    ├── middleware/
    │   ├── 10-auth.js            → app.use('*', …), before everything else
    │   ├── 20-grip.ts
    │   └── _example.js           → skipped (inactive example from template init)
    ├── routes/
    │   └── stream.js             → mounted before the static files
    ├── lib/                      → helpers (not scanned)
    ├── package.json              ← dependencies of the extension code
    └── package-lock.json         ← the customer's lockfile
```

- The location is `build.hono.extensionsDir` (default `./hono-extensions`), in `static-publish.project.js` (managed) or `static-publish.rc.js` (ejected). The path is relative to that file. It is a `build` setting, so it applies in managed and in ejected mode. (Not `extDir`: in this project "ext" means a file extension, as in `autoExt`.)
- **The folder is optional.** Without it, or with it empty, the app is **exactly** the default `hono` app: the manifest has empty lists, so the loops in `src/index.js` mount nothing. `src/index.js` is the same with or without the folder; only `src/hono-extensions.generated.js` changes. The fingerprint is the same as for any project without the folder. Each subfolder is optional by itself. To add or remove the folder later changes the fingerprint, so the next deploy uses it.

#### Build: the hooks of the template (task 6.6)

The `hono` template ships `scripts/template_prebuild.js` and `scripts/template_postinstall.js` as files in the app, the same as `src/index.js`. The core of this package has no code for extensions: it only writes the template's files, and the template hooks (task 1.4) run them.

`template_prebuild.js` (runs before each build):

1. Reads `build.hono.extensionsDir` from the app's `static-publish.rc.js`, in both modes. The path is relative to the rc. In managed mode, the generator wrote it again relative to the generated rc (for example `../../hono-extensions`).
2. Deletes `<appDir>/.hono-extensions/`, then **copies** the extensions folder there: its files and its installed `node_modules`, **without the packages that the template provides**.
3. Scans the copy (`middleware/`, `routes/`) in file-name order.
4. Writes **`src/hono-extensions.generated.js`**: the manifest, which imports each module from the copy, and collects the modules' bindings.

```js
// src/hono-extensions.generated.js (written by template_prebuild.js)
import m0 from '../.hono-extensions/middleware/10-auth.js';
import m1 from '../.hono-extensions/middleware/20-grip.ts';
import r0 from '../.hono-extensions/routes/stream.js';
export const middleware = [ { name: 'auth', module: m0 }, { name: 'grip', module: m1 } ];
export const routes = [ { name: 'stream', module: r0 } ];
export const bindings = { /* merged from the modules */ };
```

`js-compute-runtime` already bundles with esbuild (its `bundle` step: `bundle: true`, the `fastly` package condition, and a plugin that resolves `fastly:*` imports). It bundles `src/index.js`, which imports the manifest and, through it, every module and what the modules import. The template does not bundle anything itself. `build` is not changed.

- **The copy is at a fixed path in the app dir:** `<appDir>/.hono-extensions/` (`.static-publish/app/.hono-extensions/` in managed mode, `compute-js/.hono-extensions/` in ejected mode), not in the working dir.
- **Why copy** (and not import from the folder directly): imports resolve by going up the directory tree from the file that imports. From `hono-extensions/`, `hono` would resolve to `hono-extensions/node_modules/hono`, a second copy next to the app's. From the copy in the app dir, anything that is not in the copy's `node_modules` (the provided packages) resolves to the **app's** `node_modules`: one `hono` in the bundle.
- **The manifest is always generated, never a source file,** in both modes, because it comes from the current files: each build writes it again; `template_postinstall.js` also writes it (or a stub with empty lists) only so that it exists before the first build, so that an editor does not flag the import in `src/index.js` (this matters for ejected apps, where customers edit `src/index.js`); it is never committed (the template's `gitignore` field). A committed stub does not work: git still shows changes to a tracked file that is in `.gitignore`.
- The scripts need only Node (`fs`, `path`). They can use the public helper API (task 6.5).
- **Because the scripts are part of the app:** `eject` writes them to the same place, so the ejected app builds the same; after eject, they stay with the app, like `src/index.js` (an upgrade of this package cannot change the manifest format under an ejected `src/index.js`); in managed mode, they are generated again with the rest of the app and are in the fingerprint; after eject, the customer can change them.

**To decide in this part:** the exact shape of the manifest entries (this file uses `{ name, module }`), and how `defineMiddleware()` stores the bindings for `template_prebuild.js` to collect.

#### Which files are modules

- **File types:** `.js`, `.mjs`, `.ts`, `.mts`. js-compute's esbuild step handles TypeScript (it removes the types; it does no type checking). `.d.ts` files are ignored. (`.tsx`/`.jsx`, for `hono/jsx`, can come later.)
- **Only files directly in `middleware/` and `routes/` are modules.** Subfolders are not scanned, and files that start with `_` or `.` are skipped. Thus helpers can be next to modules (`middleware/_shared.ts`, `middleware/lib/sign.ts`), or in a folder such as `hono-extensions/lib/`.
- **Name** = the file name without the order prefix and the extension (`20-grip.ts` → `grip`). It is the key in `templateOptions.hono`. Two files with the same name (`20-grip.js` and `20-grip.ts`, or `10-grip.js` and `20-grip.ts`) are an error.
- **Order of middleware:** the file-name prefix (`10-`, `20-`, …).
- **Routes:** `defineRoutes((app, options) => …)` only. No file-based paths (they can come later without breaking this).

#### Imports in modules

The modules are bundled by esbuild, so their imports work as usual:

- Relative imports (`./foo.js`), including from `.ts` files with the `.js` specifier for a `.ts` file, and specifiers with no extension.
- JSON (`./bar.json`, also `with { type: 'json' }`); the data is inlined.
- Packages from the extensions' installed packages (through the copy); the provided packages (`hono`, …) from the app.
- `fastly:*` modules (`fastly:secret-store`, `fastly:env`, …), through js-compute's plugin.
- Other file types: only esbuild's **default** loaders apply, because js-compute has no loader options. `.txt` imports as text; `.html` and `.svg` do not. Workaround: put the content in a `.js` or `.ts` module (`export default \`<svg …>\``).

What does not work, because the code runs in a Wasm bundle on Compute:

- Reading files at runtime (`fs.readFile`, `__dirname`): import them.
- Node built-ins (`node:*`): bundling fails. `template_prebuild.js` can give a clearer error if it scans the modules first.
- Dynamic imports with a calculated path (`` import(`./${x}.js`) ``): esbuild cannot follow them. A literal `import('./x.js')` works.

**Type checking** is not part of the build. For editor support and an optional `tsc --noEmit` in CI, the folder has a `tsconfig.json` (from `template init`), with the types for `@fastly/js-compute` (`fastly:*`), `hono`, and `defineMiddleware()` / `defineRoutes()`.

#### Mount order in `src/index.js`

`src/index.js` loops over the manifest. It does not import modules one by one. The order matters, because `serveStatic()` goes to the next handler when no file matches.

```js
import { middleware, routes, bindings } from './hono-extensions.generated.js';

const fire = buildFire({ ...bindings, ...rc.templateOptions?.hono?.bindings });
const app = new Hono();
app.use('*', logFastlyServiceVersion());
app.use('*', staticPublisherVars());            // sets c.var.staticPublisher
// 1. middleware, in file-name order
for (const m of middleware) app.use('*', m.module.factory(rc.templateOptions?.hono?.middleware?.[m.name]));
// 2. routes
for (const r of routes) r.module.factory(app, rc.templateOptions?.hono?.routes?.[r.name]);
app.use('*', serveStatic());                     // 3. published files
app.notFound(serveFallback());                   // 4. SPA file / 404 page
fire(app);
```

After eject, this is ordinary code: the customer can skip a module, change the order, or connect a module by hand, and new files in the folder are still found.

#### Module shape (task 6.7)

Each file default-exports a **factory**, so that it can get options. `defineMiddleware()` and `defineRoutes()` from `@fastly/compute-js-static-publish/hono` give types and completion. There is no extra context argument: a handler gets everything from `c`, as in any Hono app (bindings on `c.env`, values of this package on `c.var.staticPublisher`).

```js
// hono-extensions/middleware/20-grip.js
import { defineMiddleware } from '@fastly/compute-js-static-publish/hono';
import { serveGrip } from '@fanoutio/serve-grip/hono';

export default defineMiddleware(
  { bindings: { grip: 'SecretStore:GRIP' } },
  (options) => async (c, next) => { const key = c.env.grip; /* … */ },
);
```

```js
// hono-extensions/routes/stream.js
import { defineRoutes } from '@fastly/compute-js-static-publish/hono';

export default defineRoutes((app, options) => {
  app.get('/stream', (c) => {
    if (c.var.grip.isProxied) {
      const gripInstruct = c.var.grip.startInstruct();
      gripInstruct.addChannel('test');
      gripInstruct.setHoldStream();
      return c.text('[stream open]\n');
    }
    // …
  });
});
```

#### Bindings (task 6.7)

Extensions use `c.env`, from `buildFire()` of `@fastly/hono-fastly-compute`. It supports `Acl`, `Backend`, `ConfigStore`, `env`, `KVStore`, `Logger`, and `SecretStore`, plus `c.env.clientInfo` and `c.env.serverInfo`. Resources are looked up lazily and cached; a resource that is missing or not linked is `undefined`.

- **Two sources, merged into one `buildFire()` call,** so `c.env` is the same object at runtime:
  - A module declares its own (`defineMiddleware({ bindings: … }, …)`). They are typed in that module. `template_prebuild.js` collects them into the manifest.
  - The rc declares app-level ones in `templateOptions.hono.bindings`. They are visible in `src/index.js` after eject.
- The same key with the same value is OK. The same key with **different** values is an error at build time that names both sources.
- Check binding names when possible: a Config Store name that is not a valid identifier (for example `my-config`) cannot be opened.
- Values of this package are on `c.var.staticPublisher` (task 6.3).

**To decide in this part:** whether the build checks binding names (for example a Config Store name that is not a valid identifier).

#### Options (task 6.4)

- In `static-publish.project.js` (managed) or `static-publish.rc.js` (ejected), keyed by module name (no prefix):

  ```js
  templateOptions: {
    hono: {
      bindings: { config: 'ConfigStore:site_config' },
      middleware: { grip: { /* options for 20-grip.js */ } },
      routes: { stream: { /* … */ } },
    },
  },
  ```

  Top level (not in `managed`), because the generated app reads it. It is in the Wasm binary, so a change needs a deploy. Namespaced by template, like `build.hono`.
- Options for modules that do not exist give a warning, not an error, so that removing a module does not break the build.
- **Secrets are never in the config:** modules read them through bindings.
- Options for each collection (through the publish settings and `getServerConfig()`) could come later, for options that can differ between collections; never for anything that is necessary before the collection is known.

**To decide in this part (optional):** in managed mode, leave the `templateOptions` keys of other templates out of the generated rc (they are not used).

#### Dependencies

The extensions folder is its own small package:

```jsonc
// hono-extensions/package.json
{
  "dependencies": { "@fanoutio/serve-grip": "^…" },
  "peerDependencies": {                       // provided by the template
    "hono": "^4",
    "@fastly/compute-js-static-publish": "^8.1"
  }
}
```

- The customer runs `npm install` (or `npm ci`) **in the folder**, so that the editor and the type checker see everything, including the peer packages. Never in the generated app (it is generated again).
- The template declares the packages that it **provides** (`hono`, `@fastly/compute-js-static-publish`, `@fastly/js-compute`). `template_prebuild.js` copies the folder's `node_modules` into the app **without** them, so at build time they resolve to the app's copies: one `hono` in the bundle. Imports from other packages work the same way (serve-grip's own `import 'hono'` also finds the app's copy).
- **Two lockfiles, never merged.** The packages of the extensions come from the folder's lockfile (the customer's); the packages of the app come from the template's lockfile (task 3.5). Thus the builds stay reproducible.
- **Version check:** `template_prebuild.js` warns if a range in the folder's `package.json` for a provided package does not include the version that the app has. The build uses the template's `hono`, not the one in the folder's `node_modules`. The message gives the fix: `hono-extensions/package.json expects hono ^4.6.0, but the app provides 4.13.2. Run: npx @fastly/compute-js-static-publish template init`. A mismatch is a warning, not an error: the app's copy is the one that runs, so the risk is only types that are a little wrong.
- **Install both:** `npm ci` in the folder **and** in the app dir. CI tools must do both, the folder first.
- **Copy rules:** a real copy, not a symlink (esbuild follows symlinks to the real path, which would bring back the second `hono`); extension code must not import files outside the folder (for example `../shared/x.js`), because they are not copied; copying `node_modules` takes a little time at each build.
- **Side effects:** error locations and source maps point at the copy, not at the folder. The Fastly CLI's file watcher may not see changes in the folder, because it is outside the app dir; otherwise, edits show at the next build.

**To test in this part (task 6.6):** whether the Fastly CLI's file watcher (`fastly compute serve --watch`) sees changes in `hono-extensions/`. If not, pass the folder to the watcher's directory option.

#### `template init` (task 6.8)

A command of the core. Each template defines what it initializes. For `hono`, it sets up the folder of `build.hono.extensionsDir`.

- **It works only on the app's current template:** `managed.template` in managed mode, `generatedFrom.template` in ejected mode. There is no `--template` override. It never switches templates and never calls `generateApp()`: it only makes or updates the template's extension folder.
- **An app with no `generatedFrom`** (made before 8.1): an error with the steps to add the record by hand. No guessing.
- **Scaffolding with `--template hono`** (also with `--managed`) runs `template init` at the end.
- If a customer changes `managed.template` to `hono` by hand, nothing runs `template init`. `deploy` and `dev` could show a hint.

| Command | Effect |
|---|---|
| `template init` | If the folder is missing: makes it, with `package.json` (peer dependencies set to the provided versions, from `pinnedVersion()`), a starter `tsconfig.json`, empty `middleware/` and `routes/`, and an **inactive** example, `middleware/_example.js` (skipped until the customer renames it, so that a new Hono app is still exactly the plain Hono app). If the folder exists: updates only the parts that the template owns (the peer versions in `package.json`, merged; the customer's own dependencies are not changed), and adds missing starter files. Never changes customer modules. |
| `template init --reset` | Also writes the starter files (`tsconfig.json`, the example) again, as the template has them. Lists what it will replace and asks, or needs `--force` in non-interactive mode. Never deletes customer modules. |
| `template init --check` | Changes nothing. Fails if the parts that the template owns have drifted. For CI. |

Then `npm install` in the folder (npm 7 and later install peer dependencies). `status --json` (part 5) lists the provided packages and their versions.

**Where the versions come from:** in managed mode, the template's pinned versions (`pinnedVersion()`, from the shipped lockfile); in ejected mode, the app's installed packages (for example `compute-js/node_modules/hono/package.json`).

**To decide in this part:** whether `deploy` and `dev` show a hint when `managed.template` is `hono` but there is no extensions folder.

#### Fingerprint

There is no separate bundle to hash. The fingerprint (task 3.7) also includes the **contents of the extensions folder** (modules and helpers) and **its lockfile**, so any change to the customer's code or to its resolved dependencies triggers a deploy, and nothing else does. (The manifest follows from these.)

#### Eject

Nothing about the extensions changes at eject:

- `scripts/template_prebuild.js`, `scripts/template_postinstall.js`, and `src/index.js` are written into the ejected app at the same place as in the generated one, and the hooks in `package.json` stay. New files in the folder are found after eject too.
- The folder stays where it is. `build.hono.extensionsDir` stays in the rc, with the path written again relative to the rc's new location (for example `../hono-extensions`).
- The customer can now change `src/index.js` (skip or reorder modules) and the hook scripts.

**To test in this part (tasks 3.9 and 6.8):** `eject` writes `build.hono.extensionsDir` again relative to the rc's new location (for example `../hono-extensions`).

### What this needs from the template mechanism (task 6.4)

The `AppTemplate` of task 1.2 gets:

```ts
type AppTemplate = {
  // from part 1: files, dependencies, devDependencies, gitignore, supports
  initFiles?: Record<string, string>,  // for template init, written under the template's own folder;
                                       // package.json is merged, not replaced
  provides?: string[],                 // packages that the app provides to extension code
  settings?: {                         // the settings that the template reads, for validation
    build?: …,                         // build.<template>, e.g. build.hono.extensionsDir
    templateOptions?: …,               // templateOptions.<template>
  },
};
```

- The core writes the files in the same way for scaffold, managed generation, and eject. No hook interface or plugin dispatch is necessary, beyond the template hooks of task 1.4.
- `build.<template>` in the rc: in the generated rc in managed mode, with its paths written again relative to the generated rc; kept at eject, with its paths written again relative to the new rc.
- Settings that a template does not declare give warnings (in ejected mode, warnings only, because the customer owns the code).
- `StaticPublishRc` declares `templateOptions` and `build` (typed for each template).

### Public helper API (task 6.5)

The files that a template ships use only the public API of this package, because they stay in the app after eject, with later versions of this package. The helpers for template scripts (for example: read the rc; list the modules with the naming rules) are a public, semver'd API, for example a Node-side subpath export.
