# Tests (8.2)

The rules for both stacks are in [../v8.1/tests.md](../v8.1/tests.md#rules-for-both-stacks).

| Item | Tests to add |
|---|---|
| 3b | `--template plain` and no `--template` give the same files. A name that is not valid (including `constructor`) fails and writes nothing. A project file without `managed.template` gives the same files as `template: 'plain'`. |
| 6 | Unit: path resolution (`root`, `path`, `rewriteRequestPath`, `..`, encoded characters). |
| 7 | Golden files: `hono` × {KV Store, S3}, with and without `collectionSelection`. e2e (as on the Hono branch): serves the published content and uses the response cache; a route before `serveStatic()` and a route after it; `root` with `rewriteRequestPath`; no file for `POST`; no answer for `/healthz`; one read of the index for a file lookup and the fallback; one cache key for the fallback page for all paths. e2e: a preview by cookie, query, and header; `c.var.staticPublisher` is set. The lockfile of `hono` is up to date. "One config, three paths" with `managed.template: 'hono'`. A switch from `plain` to `hono` in managed mode changes the fingerprint and installs `hono`. |
| 20 | Unit: `build.<template>` is not in the generated rc in managed mode, and is kept at eject. Warnings for settings that a template does not declare. |
| 21 | Unit: the helpers (read the rc; list modules with the naming rules: prefixes, `_` and `.` skipped, subfolders skipped, `.d.ts` ignored, two files with the same name is an error). |
| 22 | An empty `hono-extensions/` gives the same golden files as no `hono-extensions/`. The manifest lists modules in file-name order; provided packages are not copied; one `hono` in the bundle; the version-mismatch warning. Bindings: the merge, and the error for one key with two values. `postinstall` writes the manifest (or the stub). The fingerprint changes with the files in `hono-extensions/` and its lockfile. |
| 23 | Unit: `defineMiddleware()` and `defineRoutes()` (with and without bindings); the types of `c.env` and `c.var.staticPublisher`. |
| 24 | `template init` makes the folder (with the inactive example); updates only the parts that the template owns; `--reset` with and without `--force`; `--check` fails on drift. It fails with no `generatedFrom`, and works only for the current template. Scaffolding with `--template hono` runs it. |
| 25 | e2e: a GRIP-like middleware and route; a module added after eject is found; the mount order (middleware → routes → files → fallback). |
