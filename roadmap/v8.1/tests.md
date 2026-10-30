# Tests

Goal: each PR adds the tests that make its code safe to change later. A refactor must not change a golden file. A change to a golden file must be visible in the PR diff.

## Rules for all parts

- **Pure functions for logic.** Put logic that can be tested in modules that do not import `fastly:*` (`src/models`, or a pure module in `src/server`), so that `test/unit` can import it from `build/`.
- **Golden files** in `test/golden/<case>/`: the full output of `generateApp()` for each case. The test compares each file and the list of file names. To update them, run with `UPDATE_GOLDEN=1`. Without it, a difference is a failure. The golden files have no absolute paths: the version of this package and the `file:` path are replaced with a fixed placeholder.
- **One config, three paths.** When managed mode and `eject` exist (part 3), a test makes the same `AppConfig` through scaffold flags, through a project file (`static-publish.project.js`), and through `eject`, and checks that `generateApp()` gives the same files for all three.
- **CLI output contracts.** For each `--json` command (part 5), a test checks the fields and the exit code, so that CI tools can trust them.
- **e2e** only for what needs a real server or the Fastly CLI (`fastly compute serve`). The e2e tests that need no credentials must pass in each PR.

## Part 1: Templates

| Task | Tests to add |
|---|---|
| 1.1 | Golden files: `plain` × {KV Store, S3}; with `--spa`, `--not-found-page`, `--static-dir`; with `--service-id`; with `--public-dir` (deprecated). In the first commit, the golden files are the output of 8.0.0. A test that `action()` writes exactly the files of `generateApp()`. |
| 1.2 | A unit test over all templates: no clash with what `generateApp()` writes. The template files and the config templates are in the tarball (`npm pack --dry-run`). The dependencies in the app's `package.json` come from the template's `package.json`. A config template with a `{{ … }}` that has no `js` or `toml` filter fails. Golden case: a `--description` with a `"` and a KV Store name with a `.` give a valid `fastly.toml`. Unit: the `js` and `toml` filters (strings with quotes, backslashes, and newlines; nested objects; keys that are not identifiers). |
| 1.3 | `--template plain` and no `--template` give the same files. A name that is not valid (including `constructor`) fails and writes nothing. |
| 1.4 | The golden files change by the hook scripts in `package.json`. `run-template-hook <name>` does nothing without `scripts/template_<name>.js`, runs it when it exists, and fails the command if the hook fails. |
| 1.5 | The golden files change by `generatedFrom` in `static-publish.rc.js`. |
| 1.6 | Golden files with `--default-collection-name`. |
| 1.7 | CLI: `--project-dir` from another directory. The working dir and `rootDir` are resolved against the directory of the config file (for example, `publish-content --local` from the repo root writes `kvstore.json` into `compute-js/static-publisher/`). |
| 1.8 | CLI: `--version` prints only the version, in any directory (no rc, rc). |

## Part 2: Previews

| Task | Tests to add |
|---|---|
| 2.1 | Unit: valid and not valid names (length 1, 63, and 64; `-` at the start and the end; uppercase; `_`; `.`; `/`). Each character that breaks a cookie is refused. CLI: publish to a new bad name fails; an existing bad name warns; `scaffold --default-collection-name` with a bad name fails. Cookie selector: `activate` with a bad name sets no cookie. |
| 2.2 | The existing tests pass with no change. Unit or e2e: two requests in one reused sandbox do not share state. The deprecated getters return the state of the current scope. |
| 2.3 | e2e: each `serveRequest()` option; `serveFallback()`; the `\|no-html` and `\|fallback` cache keys; the response cache keys on the collection. |
| 2.4 | Unit: each source; the order of sources; `sticky` redirects (and the error without a `cookie` source); `allow` globs; name rules; patterns with fixed text; a host label longer than 63 characters; `previewUrl()` for each source. |
| 2.5 | Unit: validation of `collectionSelection`. e2e: `noindex`, `Cache-Control: private`, `onMissing` both ways. |
| 2.6 | Golden files: `plain` with `collectionSelection`. e2e: a preview by cookie, query, and header, on `plain`. A template without `supports.collectionSelection` fails (a test template). |

## Part 3: Managed mode and eject

| Task | Tests to add |
|---|---|
| 3.1 | Unit: validation of the project file and its sections. The generated rc has only the top-level fields (no `publishContent`, `managed`, or `generatedFrom`); a change to `publishContent` does not change the fingerprint. `publish-content --config` replaces `publishContent`. "One config, three paths" for scaffold and managed. Detection: project file, rc, neither, both (error). `--project-dir` with a project file. `scaffold --managed` and `.gitignore`: missing file, existing file with and without the lines. |
| 3.2 | CLI: non-interactive (flag and `CI` env var) with missing input fails with a message. A token value never appears in the output (also in errors). |
| 3.3 | Unit: validation of `staticPublisherWorkingDir` (`./x`, `../x`, and `./../x` pass; absolute paths, `./`, `./..`, `..`, and `../..` fail). |
| 3.4 | A project file without `managed.template` gives the same files as `template: 'plain'`. A value that is not valid fails. |
| 3.5 | The lockfile of each template is up to date (CI check). `npm ci` runs only when `package.json` or the lockfile changed. The tarball has the lockfiles (`npm pack --dry-run`). The generated app gets the `file:` link with a CLI started by `npx` and by a local install: `npm ci` does not change the lockfile, the bin is linked, a `postinstall` hook runs, and the app builds. |
| 3.6 | e2e: `dev` serves the content that `publish-content --local` wrote. |
| 3.7 | Unit: the fingerprint changes for each input, and does not change for the service ID, `generatedFrom`, or content. `status` text output. |
| 3.8 | Unit: the version check (the same, newer, newer with `--auto-upgrade`, older, missing) for `dev` and `deploy`; `upgrade` writes the version; `status` shows both versions. Unit: the write-back of `serviceId` (the marked line is there, is missing, was changed by the customer). Deploy e2e (needs credentials): the second `deploy` with no change does nothing; the version comment has the fingerprint. |
| 3.9 | "One config, three paths" for eject. The fingerprint after eject is the same as the last managed one. `eject` refuses an existing directory without `--force`. The split gives a correct `static-publish.rc.js` and `publish-content.config.js`; `rootDir` and `staticPublisherWorkingDir` point at the same directories as before (for example `../static-publisher`), and so does the `kvstore.json` path in `fastly.toml`; the project file is deleted. This package is `^<version>` in `package.json` and exactly `<version>` in the lockfile, with no `file:` link. `eject` stops for a version that is not on npm; the e2e test (which runs from this repo, never a published version) needs a way around that, for example an env var that only the tests set. |

## Part 4: Hidden files

| Task | Tests to add |
|---|---|
| 4.1 | Unit: encode and decode of hidden entries; `requires` has `hidden` only if a hidden file exists. e2e: a request for a hidden file gets 404 (also with `autoIndex` and `autoExt`); `getMatchingAsset(…, { includeHidden: true })` finds it; a hidden 404 page is served as the fallback; a server without `hidden` in `SUPPORTED_INDEX_FEATURES` does not serve the collection (simulated). `promote` keeps hidden entries. `clean` keeps the content of hidden files. A file named `hidden:x` gets the key `/hidden:x`. |
| 4.2 | Unit: each way to mark a file hidden (`hiddenItems` formats, `assetInclusionTest`). CLI: `collections list` and the `publish-content` summary show the count. |

## Part 5: CI

| Task | Tests to add |
|---|---|
| 5.1 | CLI output contracts for `publish-content --json`, `collections list --json` (with the hidden count), `status --json`, `deploy --json`, and `--version --json`. Logs and the banner go to stderr with `--json`. A failed purge is in the JSON, with exit `0`. |
| 5.2 | Exit codes `0`, `1`, and `2` for a sample of each case. |
| 5.3 | An error with `--json` gives one JSON object with `error.code`, for example `collection-name-invalid`. |
| 5.4 | Idempotent cases: delete a missing collection, publish the same content two times, promote to the same target. |

## Part 6: Hono

| Task | Tests to add |
|---|---|
| 6.1 | `--template hono` is valid; `managed.template: 'hono'` is valid. A switch from `plain` to `hono` in managed mode changes the fingerprint and installs `hono`. |
| 6.2 | Unit: path resolution (`root`, `path`, `rewriteRequestPath`, `..`, encoded characters). |
| 6.3 | Golden files: `hono` × {KV Store, S3}, with and without `collectionSelection`. e2e: serves the published content and uses the response cache; a route before `serveStatic()` and a route after it; `root` with `rewriteRequestPath`; no file for `POST`; no answer for `/healthz`; one read of the index for a file lookup and the fallback; one cache key for the fallback page for all paths. e2e: a preview by cookie, query, and header; `c.var.staticPublisher` is set. The lockfile of `hono` is up to date. "One config, three paths" with `managed.template: 'hono'`. |
| 6.4 | Unit: `build.<template>` is in the generated rc in managed mode, with its path relative to the generated rc, and is kept at eject, with its path relative to the new rc. Warnings for settings that a template does not declare. |
| 6.5 | Unit: the helpers (read the rc; list modules with the naming rules: prefixes, `_` and `.` skipped, subfolders skipped, `.d.ts` ignored, two files with the same name is an error). |
| 6.6 | An empty `hono-extensions/` gives the same golden files as no `hono-extensions/`. The manifest lists modules in file-name order; provided packages are not copied; one `hono` in the bundle; the version-mismatch warning. `postinstall` writes the manifest (or the stub). The fingerprint changes with the files in `hono-extensions/` and its lockfile. `status --json` lists the provided packages. |
| 6.7 | Unit: `defineMiddleware()` and `defineRoutes()` (with and without bindings); the types of `c.env` and `c.var.staticPublisher`. Bindings: the merge, and the error for one key with two values. e2e: a GRIP-like middleware and route; a module added after eject is found; the mount order (middleware → routes → files → fallback). |
| 6.8 | `template init` makes the folder (with the inactive example); updates only the parts that the template owns; `--reset` with and without `--force`; `--check` fails on drift. It fails with no `generatedFrom`, and works only for the current template. Scaffolding with `--template hono` runs it. |
