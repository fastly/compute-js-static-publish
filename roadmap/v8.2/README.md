# 8.2: stack 2

Templates for users, starting with Hono, and the Hono extensions. On top of stack 1 ([../v8.1/README.md](../v8.1/README.md)).

Build order: **C → G**. The details of each item are in [design.md](design.md), its tests in [tests.md](tests.md), and the open details in [open-items.md](open-items.md).

## PRs (stack 2)

PR numbers continue from stack 1.

| PR | Items | Contents |
|---|---|---|
| 14 | 3b | `--template` and `managed.template` |
| 15 | 6 | The Hono middleware (`/hono`) |
| 16 | 7 | The `hono` template |
| 17 | 20, 21 | Core changes for templates: `build.<template>`, declared settings, the public helper API |
| 18 | 22, 23 | The Hono extension hooks, the manifest, `defineMiddleware()` and `defineRoutes()` (they work only together) |
| 19 | 24, 25 | `template init`, and the e2e tests for `hono-extensions/` |

If a PR is too large in practice, split it before the review.

## Items

### C. Templates for users, and Hono

3b. ✅ **`--template` and `managed.template`**: the user-facing part of item 3. A missing value means `plain`, so 8.1 projects work with no change. Docs for templates. ([design §2](design.md#2-templates-for-users-item-3b))
6. ✅ **`@fastly/compute-js-static-publish/hono`**: the Hono middleware. ([design §3](design.md#3-hono-middleware-item-6))
7. ✅ **The `hono` template**, and its e2e test. It also connects the template to collection selection and to managed mode. ([design §4](design.md#4-the-hono-template-item-7))

### G. Hono extensions (`hono-extensions/`)

20. ✅ **`build.<template>`** in the rc, and the settings that each template declares. A core change, with `hono` as its only user. ([design §5](design.md#5-hono-extensions-items-20-to-25))
21. ✅ **Public helper API** for template scripts. A core change.
22. ✅ **`scripts/template_prebuild.js` and `scripts/template_postinstall.js`** in the `hono` template: copy `hono-extensions/` into the app, write the manifest, include it in the fingerprint.
23. ✅ **`defineMiddleware()` and `defineRoutes()`**, with bindings. No `ctx`.
24. ✅ **`template init [--reset [--force]] [--check]`**. Scaffolding with `--template hono` runs it at the end.
25. ✅ **e2e tests** for `hono-extensions/`.
