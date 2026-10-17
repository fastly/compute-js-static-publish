# 8.1: stack 1

Managed mode, previews (collection selection), hidden files, and CI support. The template mechanism is internal only: no `--template` flag and no `managed.template` field (those come in 8.2, item 3b).

Build order: **A → B → H → D → E → F**. The details of each item are in [design.md](design.md), its tests in [tests.md](tests.md), and the open details in [open-items.md](open-items.md).

## PRs (stack 1)

| PR | Items | Contents | Why this grouping |
|---|---|---|---|
| 1 | 1 | Collection name rules | Alone: it changes `Set-Cookie` (security), and it is small and independent. |
| 2 | 2 | `generateApp()` | Alone: a refactor; the golden files prove that it changes no output. |
| 3 | 3 | Templates (internal), template hooks, `generatedFrom` | Alone: it changes the golden files on purpose, so the diff shows exactly what changed. |
| 4 | 4 | Per-request scope in `PublisherServer` | Alone: no API change, and the existing tests pass with no change. |
| 5 | 5 | `serveRequest()` options and `serveFallback()` | Alone, after item 4. |
| 6 | 26, 27, 28 | Hidden files | One feature: the server side cannot be tested without a way to mark files hidden, and the docs belong with the feature. |
| 7 | 8 | `resolveCollection()` and `previewUrl()` | Alone: pure logic, with many unit tests. |
| 8 | 9, 10 | `collectionSelection` in the config, server behavior, the `plain` template, flags | Nothing is visible until all of these exist. Together they can be tested end to end. |
| 9 | 11, 12 | CI basics: `--project-dir`, `--version`, non-interactive mode, `--json`, exit codes | All CLI plumbing, reviewed in the same way. |
| 10 | 13 | The project file, detection, `scaffold --managed` | Alone: the base of managed mode, and usable by itself (publish from the project dir). |
| 11 | 14, 15 | Cache dir, lockfile, `file:` link, `dev` | `dev` is the first way to see the generated app work, so it tests the install logic of item 14. |
| 12 | 16, 17 | Fingerprint, `status`, `deploy`, version check, `upgrade` | `deploy` is built on the fingerprint, and the version check is in both `status` and `deploy`. |
| 13 | 18, 19 | `eject`, docs | `eject` completes managed mode, and the docs describe both directions. |

If a PR is too large in practice, split it before the review.

## Items

### A. Templates and generation

1. ✅ **Collection name rules**: `validateCollectionName()`, checks in the CLI, check in the cookie selector. ([design §2](design.md#2-collection-names-item-1))
2. ✅ **`generateApp(config) → files`**: one code path that generates the app. Golden-file tests. `--default-collection-name`. ([design §3](design.md#3-generateapp-item-2))
3. ✅ **Template mechanism, internal only**: `AppTemplate`, with the current app as the `plain` template. Template hooks in every app. The template record `generatedFrom`. ([design §4](design.md#4-templates-internal-item-3))

### B. Server

4. ✅ **Per-request scope** in `PublisherServer` (`CollectionScope`). The old public fields stay as deprecated getters. ([design §5](design.md#5-publisherserver-items-4-and-5))
5. ✅ **`serveRequest()` options** (`collectionName`, `pathname`, `fallback`, `healthCheck`) and `serveFallback()`.

### H. Hidden files (issue #102)

After group B, because it changes how the server matches files. It does not depend on groups D, E, or F.

26. ✅ **Index format and server**: `hidden:` keys, `requires: hidden`, no match for a request, `getMatchingAsset(…, { includeHidden: true })`. ([design §6](design.md#6-hidden-files-items-26-to-28))
27. ✅ **Publish time**: `hiddenItems`, and `assetInclusionTest` returns `{ hidden: true }`. Counts in the CLI output.
28. ✅ **Docs**: README; `MIGRATING.md` ("Stop using `publicDirPrefix`") recommends hidden files; CHANGELOG. The README says that hidden is not access control.

### D. Collection selection

8. ✅ **`resolveCollection()`** (sources `host`, `path`, `query`, `cookie`, `header`; `sticky`; `allow`) and `previewUrl()`. ([design §7](design.md#7-collection-selection-items-8-to-10))
9. ✅ **`collectionSelection` in the rc**: validation, `noindex`, private caching, `onMissing`.
10. ✅ **Connect it to the `plain` template**, plus the scaffold flags. (The `hono` template comes in 8.2, item 7.)

### E. CI basics

11. ✅ **`--project-dir`**, `--version`, non-interactive behavior, and no secrets in the output. ([design §8](design.md#8-ci-basics-items-11-and-12))
12. ✅ **`--json` and exit codes** for `publish-content` and `collections list`. Idempotent operations.

### F. Managed mode

13. ✅ **The project file `static-publish.project.js`**: detection by file name, `scaffold --managed`, commands from the project dir. ([design §9](design.md#9-managed-mode-items-13-to-19))
14. ✅ **Cache dir** `.static-publish/app/`, the lockfile of the `plain` template, the `file:` link to the CLI's copy of this package, `npm ci`.
15. ✅ **`dev`**.
16. ✅ **Fingerprint** and `status [--json]`.
17. ✅ **`deploy [--force] [--auto-upgrade] [--json]`**: deploy only if the fingerprint changed; write back the service ID; check the recorded version of this package; the `upgrade` command. With S3 storage, the first deploy is by hand.
18. ✅ **`eject [--dir] [--force]`**.
19. ✅ **Docs**: README "Managed and ejected apps", and `MIGRATING.md` (move an existing project to managed mode).
