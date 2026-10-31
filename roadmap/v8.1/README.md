# 8.1: the six parts

8.1 has six parts: templates, previews, managed mode, hidden files, CI support, and Hono. Each part is one PR to `main`, in this order. The details of each part are in [design.md](design.md), and its tests in [tests.md](tests.md).

In these files, a **customer** is a developer who uses this package. A **visitor** is a person who opens the customer's site.

## The PRs and their dependencies

| PR | Part | Needs (hard) | Needs (soft) |
|---|---|---|---|
| 1 | Templates | Nothing | – |
| 2 | Previews | 1: the `plain` template | – |
| 3 | Managed mode and eject | 1: `generateApp()`, `--project-dir`; 2: `collectionSelection` in the project file | – |
| 4 | Publishing: hidden files | – | 2: the same server code |
| 5 | CI: machine-readable output | 3: `--json` for `status` and `deploy` | 4: the count of hidden files in the JSON |
| 6 | Hono | 1: templates, the template option; 2: `serveRequest()` options, `resolveCollection()`; 3: managed mode, `managed.template` | 5: `status --json` lists the packages of the template |

A hard dependency means that the code is built on the earlier PR. A soft dependency means that the two PRs change the same code or output, so the later PR adapts to the earlier one.

```
1 Templates ─► 2 Previews ─► 3 Managed ─┬─► 5 CI ─► 6 Hono
                   ┆                    │
                   ┆┄┄► 4 Hidden files ┄┘
```

- PR 4 has only a soft dependency, so it can be reviewed at the same time as PR 3.
- The terms "managed app" and "ejected app" come in PR 3. Before that, there is only one type of app, and PRs 1 and 2 (code, docs, and PR descriptions) call it a "scaffolded app".
- Each PR description starts with the big picture: the use case of the part, and how the PR fits into 8.1.
- Each PR includes its docs: the README, `MIGRATING.md` where a customer must do something, and the CHANGELOG entries.
- Each part adds a feature first, as text output for people. Part 5 adds the `--json` form of all the commands that exist then.
- If a PR is too large in practice, split it before the review.

## 1. Templates

**Use case:** this part is mostly a base for the other parts. Customers see `--project-dir`, `--version`, and template hooks that they can use in their app.

**In 8.0.0:** `scaffold` makes the app files from strings in the scaffold code. There is no way to make the same app again from the same settings, except to run `scaffold` again. The CLI must run in the app directory (`compute-js/`), and it resolves the working directory (`staticPublisherWorkingDir`) against the current directory.

**Tasks** ([design](design.md#part-1-templates)):

- 1.1 **`generateApp(config) → files`**: one function that makes all the app files from the settings. Golden-file tests compare its output with checked-in copies.
- 1.2 **Templates as real files** in the package, with their dependencies in a real `package.json`. The **`plain`** template is the app of 8.0.0.
- 1.3 **`--template`** for `scaffold`. `plain` is the only valid value in this part.
- 1.4 **Template hooks:** every app gets `prebuild`, `postbuild`, and `postinstall` scripts. Each runs `scripts/template_<name>.js` if that file exists, and otherwise does nothing.
- 1.5 **`generatedFrom`:** a record in `static-publish.rc.js` of the template and the version that made the app.
- 1.6 **`--default-collection-name`** for `scaffold` (in 8.0.0, the name is always `live`).
- 1.7 **`--project-dir`:** run the CLI from any directory. In this part, it is the directory that has `static-publish.rc.js`. The working directory is resolved against the directory of the config file, not the current directory.
- 1.8 **`--version`:** prints only the version of this package.

The `plain` template has no collection selection yet. Part 2 adds it.

## 2. Previews (collection selection)

**Use case:** "Show me this branch or PR before it goes live."

**In 8.0.0:** the CLI can publish to any collection, and `collections promote` copies one collection to another. The server can serve any collection: the code in `src/index.js` selects it with `setActiveCollectionName()`. The `collectionSelector` module has helpers that get the collection name from the hostname (`fromHostDomain`), the URL (`fromRequestUrl`), a cookie (`fromCookie`), or a Config Store (`fromConfigStore`). With `fromRequest`, or with their own code, customers can select a collection by any rule. But each customer must write this code in `src/index.js`, and the scaffolded app does not include it. Collection names have no rules. There are no preview URLs, and search engines can index a preview, because its responses look the same as the responses of production.

**Tasks** ([design](design.md#part-2-previews)):

- 2.1 **Collection name rules** (a DNS label), so that CI can make names from branches and PR numbers (`pr-42`). The CLI and the cookie selector check them.
- 2.2 **Per-request scope** in `PublisherServer`: the state of a request is not kept between requests.
- 2.3 **`serveRequest()` options** (`collectionName`, `pathname`, `fallback`, `healthCheck`) and **`serveFallback()`**.
- 2.4 **`resolveCollection()`**, one function for all templates, and **`previewUrl()`**, which gives the link for a collection.
- 2.5 **`collectionSelection`** in `static-publish.rc.js`: select a collection by a hostname, a path, a query parameter, a cookie, or a header, with settings in place of code. `allow`, `sticky`, `onMissing`. Responses from previews get `noindex` and `Cache-Control: private`.
- 2.6 **Connect it to the `plain` template**, plus the `scaffold` flags. The scaffolded app supports previews with no code.
- 2.7 **The end of a preview.** In 8.0.0, nothing removes a preview when its branch or PR closes: `--expires-in` stops serving it, but its index stays in storage until `clean --delete-expired-collections`, and its files stay until `clean`. The README has no CI example for it. Add a CI example that, when a PR closes, runs `collections delete` for its preview, and then `clean` (see [`clean` while a publish runs](../README.md#separate-from-the-six-parts-80x-or-81) for when `clean` is safe). Decide while building: only docs, or also a command or a flag that does both steps.

The `collectionSelector` helpers and custom selectors continue to work, for customers who need a rule that the config does not have.

## 3. Managed mode and eject

**Use case:** "I want my static site on Compute, but I do not want to maintain a Compute app."

**In 8.0.0:** customers commit the generated app (`compute-js/`) and upgrade it by hand with `MIGRATING.md`. Or they scaffold it again in CI from a long list of flags, and deploy each time, because nothing tells them if a deploy is necessary.

This part defines the terms **managed app** (the package generates the app when it needs it, and the app is not in the repo) and **ejected app** (the app is in the repo, and the customer owns it). All existing projects are ejected apps.

**Tasks** ([design](design.md#part-3-managed-mode-and-eject)):

- 3.1 **The project file** `static-publish.project.js`: one config file in the repo. Detection by file name. `scaffold --managed` makes a managed project. Without `--managed`, `scaffold` makes the same app as in 8.0.
- 3.2 **Non-interactive mode:** with `--non-interactive`, or when the `CI` environment variable is set, the CLI never asks a question. Missing input is an error with a clear message. No secrets in the output.
- 3.3 **Stricter rules for the working directory:** a relative path, not the directory of the config file and not a directory above it. `eject` needs this, because it moves the config file.
- 3.4 **`managed.template`** in the project file. `plain` is the only valid value in this part, and a missing value means `plain`.
- 3.5 **Pinned dependencies:** the cache dir `.static-publish/app/`, the lockfile of the template, the `file:` link to the CLI's copy of this package, and `npm ci`.
- 3.6 **`dev`**.
- 3.7 **The fingerprint** and **`status`**, which tells if a deploy is necessary.
- 3.8 **`deploy [--force] [--auto-upgrade]`**: deploy only when the fingerprint changed. Write back the service ID. The project records the version of this package, and the **`upgrade`** command changes it.
- 3.9 **`eject [--dir] [--force]`**: gives the customer the full app, if they need more control.

`status` and `deploy` print text in this part. Part 5 adds `--json`.

## 4. Publishing: hidden files

**Use case:** "Publish a file that the app uses, but that a visitor cannot open directly."

**In 8.0.0:** every published file can be requested by its path. There is no way to publish a file that a request cannot get. The only workarounds are `publicDirPrefix` (deprecated in 8.0, to be removed in v9), or a check by hand in `src/index.js`.

**Tasks** ([design](design.md#part-4-hidden-files)):

- 4.1 **Index format and server:** `hidden:` keys, `requires: hidden`, no match for a request, `getMatchingAsset(…, { includeHidden: true })`. A hidden 404 page still works as the fallback. An older server never serves a collection that has hidden files.
- 4.2 **Publish time:** `hiddenItems` in the publish config, or `{ hidden: true }` from `assetInclusionTest`. `publish-content` and `collections list` show how many files are hidden.
- 4.3 **Docs:** hidden is not access control. `MIGRATING.md` recommends hidden files in place of `publicDirPrefix`.

## 5. CI: machine-readable output

**Use case:** run the CLI from automation with no person present, for example a GitHub Action, and read the result.

**In 8.0.0:** the output of the CLI is only text for people. The exit codes are not defined, so a script can only tell success from failure, and cannot tell if a retry can help.

**Tasks** ([design](design.md#part-5-ci-machine-readable-output)):

- 5.1 **`--json`** for `publish-content`, `collections list`, `status`, `deploy`, and `--version`. Stdout has exactly one JSON object, with `schemaVersion: 1`. The log goes to stderr.
- 5.2 **Exit codes:** `0` success; `1` the operation failed, and a retry can help; `2` a usage or config error, and a retry cannot help.
- 5.3 **Error codes:** errors with `--json` have a stable code for scripts, for example `collection-name-invalid` for a name that breaks the rules of part 2.
- 5.4 **Idempotent operations:** to publish the same content again, to promote to the same target, or to delete a collection that does not exist, is a success.

## 6. Hono

**Use case:** "My site is mostly static, but I need a small amount of code: an API route, auth, or GRIP streaming."

**In 8.0.0:** Hono support is in a separate package, `@fastly/hono-compute-js-static-publish`, which supports only v6 and v7. It looks up files in the index directly, so it does not use `autoIndex`, `autoExt`, or the response cache.

**Tasks** ([design](design.md#part-6-hono)):

- 6.1 **The value `hono`** for `--template` (part 1) and for `managed.template` (part 3). Switching templates in managed mode.
- 6.2 **The `/hono` middleware** (`serveStatic()`, `serveFallback()`), which replaces the old package. It uses `serveRequest()`, so it gets all the features of the server.
- 6.3 **The `hono` template**, with previews connected, in managed and in ejected apps.
- 6.4 **Template settings:** `build.<template>`, `templateOptions.<template>`, and the settings that each template declares.
- 6.5 **A public helper API** for the scripts that a template ships.
- 6.6 **Hono extensions, build:** the `hono` template's hooks copy `hono-extensions/` into the app and write the manifest.
- 6.7 **Hono extensions, modules:** `defineMiddleware()` and `defineRoutes()`, with bindings.
- 6.8 **`template init [--reset [--force]] [--check]`**.

After 8.1.0 is released, the old package gets one last release with a pointer to `@fastly/compute-js-static-publish/hono`, and is deprecated (see [../README.md](../README.md#after-810-is-released)).
