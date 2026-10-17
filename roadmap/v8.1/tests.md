# Tests

Goal: each PR adds the tests that make its code safe to change later. A refactor must not change a golden file. A change to a golden file must be visible in the PR diff.

## Rules for both stacks

- **Pure functions for logic.** Put logic that can be tested in modules that do not import `fastly:*` (`src/models`, or a pure module in `src/server`), so that `test/unit` can import it from `build/`.
- **Golden files** in `test/golden/<case>/`: the full output of `generateApp()` for each case. The test compares each file and the list of file names. To update them, run with `UPDATE_GOLDEN=1`. Without it, a difference is a failure. The golden files have no absolute paths: the version of this package and the `file:` path are replaced with a fixed placeholder.
- **One config, three paths.** When managed mode and `eject` exist, a test makes the same `AppConfig` through scaffold flags, through a project file (`static-publish.project.js`), and through `eject`, and checks that `generateApp()` gives the same files for all three.
- **CLI output contracts.** For each `--json` command, a test checks the fields and the exit code, so that CI tools can trust them.
- **e2e** only for what needs a real server or the Fastly CLI (`fastly compute serve`). The e2e tests that need no credentials must pass in each PR.

## Tests for each PR (8.1)

| Item | Tests to add |
|---|---|
| 1 | Unit: valid and not valid names (length 1, 63, and 64; `-` at the start and the end; uppercase; `_`; `.`; `/`). Each character that breaks a cookie is refused. CLI: publish to a new bad name fails; an existing bad name warns. Cookie selector: `activate` with a bad name sets no cookie. |
| 2 | Golden files: `plain` × {KV Store, S3}; with `--spa`, `--not-found-page`, `--static-dir`; with `--service-id`; with `--public-dir` (deprecated); with `--default-collection-name`. A test that `action()` writes exactly the files of `generateApp()`. |
| 3 | The golden files change only by the four hook scripts and `generatedFrom` (both intended). `run-template-hook <name>` does nothing without `scripts/template_<name>.js`, runs it when it exists, and fails the command if the hook fails. A unit test over all templates: no clash with what `generateApp()` writes. |
| 4 | Unit or e2e: two requests in one reused sandbox do not share state. The deprecated getters return the state of the current scope. |
| 5 | e2e: each `serveRequest()` option; `serveFallback()`; the `\|no-html` and `\|fallback` cache keys; the response cache keys on the collection. |
| 26 | Unit: encode and decode of hidden entries; `requires` has `hidden` only if a hidden file exists. e2e: a request for a hidden file gets 404 (also with `autoIndex` and `autoExt`); `getMatchingAsset(…, { includeHidden: true })` finds it; a hidden 404 page is served as the fallback; a server without `hidden` in `SUPPORTED_INDEX_FEATURES` does not serve the collection (simulated, as in #103). `promote` keeps hidden entries. `clean` keeps the content of hidden files. A file named `hidden:x` gets the key `/hidden:x`. |
| 27 | Unit: each way to mark a file hidden (`hiddenItems` formats, `assetInclusionTest`). CLI: `collections list` and the `publish-content` summary show the count. |
| 8 | Unit: each source; the order of sources; `sticky` redirects (and the error without a `cookie` source); `allow` globs; name rules; patterns with fixed text; a host label longer than 63 characters; `previewUrl()` for each source. |
| 9 | Unit: validation of `collectionSelection`. e2e: `noindex`, `Cache-Control: private`, `onMissing` both ways. |
| 10 | Golden files: `plain` with `collectionSelection`. e2e: a preview by cookie, query, and header, on `plain`. A template without `supports.collectionSelection` fails (a test template). |
| 11 | CLI: `--version` prints only the version, in any directory (no rc, rc, project file). CLI: `--project-dir` from another directory (the working dir is resolved against the config file's directory); non-interactive (flag and `CI` env var) with missing input fails with a message; a token value never appears in the output (also in errors). |
| 12 | CLI output contracts for `publish-content --json` and `collections list --json`; exit codes; idempotent cases (delete a missing collection, publish the same content two times, promote to the same target). Logs and the banner go to stderr with `--json`; `--version --json`. |
| 13 | Unit: validation of `staticPublisherWorkingDir` (`./x`, `../x`, and `./../x` pass; absolute paths, `./`, `./..`, `..`, and `../..` fail). Unit: validation of the project file and its sections. The generated rc has only the top-level fields (no `publishContent`, `managed`, `build`, or `generatedFrom`); a change to `publishContent` does not change the fingerprint. `publish-content --config` replaces `publishContent`. "One config, three paths" for scaffold and managed. Detection: project file, rc, neither, both (error). |
| 14 | The lockfile of each template is up to date (CI check). `npm ci` runs only when `package.json` or the lockfile changed. The tarball has the lockfiles (`npm pack --dry-run`). The generated app gets the `file:` link with a CLI started by `npx` and by a local install: `npm ci` does not change the lockfile, the bin is linked, a `postinstall` hook runs, and the app builds. |
| 15 | e2e: `dev` serves the content that `publish-content --local` wrote. |
| 16 | Unit: the fingerprint changes for each input, and does not change for the service ID, `generatedFrom`, or content. CLI output contract for `status --json`. |
| 17 | Unit: the version check (the same, newer, newer with `--auto-upgrade`, older, missing) for `dev` and `deploy`; `upgrade` writes the version; `status` shows both versions. Unit: the write-back of `serviceId` (the marked line is there, is missing, was changed by the user). Deploy e2e (needs credentials): the second `deploy` with no change does nothing; the version comment has the fingerprint. |
| 18 | "One config, three paths" for eject. The fingerprint after eject is the same as the last managed one. `eject` refuses an existing directory without `--force`. The split gives a correct `static-publish.rc.js` and `publish-content.config.js`; `rootDir` and `staticPublisherWorkingDir` point at the same directories as before (for example `../static-publisher`), and so does the `kvstore.json` path in `fastly.toml`; the project file is deleted. This package is `^<version>` in `package.json` and exactly `<version>` in the lockfile, with no `file:` link. `eject` stops for a version that is not on npm; the e2e test (which runs from this repo, never a published version) needs a way around that, for example an env var that only the tests set. |
