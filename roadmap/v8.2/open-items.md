# Open items (8.2)

No open design questions. These details are to decide or to check in their PRs.

| Item | Detail |
|---|---|
| 7 | The name of the template's middleware that sets `c.var.staticPublisher` (the design uses `staticPublisherVars()` as an example), and the exported type for `c.var`. |
| 22 | The exact shape of the manifest entries (the design uses `{ name, module }`), and how `defineMiddleware()` stores the bindings for `template_prebuild.js` to collect. |
| 22 | Whether the Fastly CLI's file watcher (`fastly compute serve --watch`) sees changes in `hono-extensions/`, which is outside the app dir. If not, pass it to the watcher's directory option. |
| 22 | Check binding names (for example Config Store names that are not valid identifiers) at build time. |
| 24 | A hint from `deploy` and `dev` when `managed.template` is `hono` but there is no extensions folder. |
| 18, 24 | `eject` writes `build.hono.extensionsDir` again relative to the rc's new location (for example `../hono-extensions`). |
| 20, 22 | **How `template_prebuild.js` gets `build.hono.extensionsDir` in managed mode.** The generated rc has no `build` section (to keep the generator's settings out of the Wasm binary), but the hook in the generated app must know the folder. Options: the generated rc keeps `build`, with the path written relative to the app dir (it is only a path, so it does no harm in the Wasm binary); or the generator writes a small build file for the hooks (for example `.static-publish/app/static-publish.build.json`). |
| 20 | Optional: in managed mode, leave the `templateOptions` keys of other templates out of the generated rc (they are not used). |
