# Roadmap: 8.1 and 8.2

This folder has the plan for the next two minor releases: the PRs, the design with its decisions, the tests, and the open items.

## Releases

| Release | Stack | Features to announce |
|---|---|---|
| **8.1.0** | Stack 1 | Managed mode (no `compute-js/` in your repo), previews (collection selection), hidden files, CI support (`status`, `deploy`, `--json`) |
| **8.2.0** | Stack 2 | Templates for users (`--template`), starting with Hono, and Hono extensions (`hono-extensions/`) |

- Each release has features that users can see and that we can announce. Templates come in 8.2 together with a template that makes them useful (Hono). In 8.1, the template mechanism is internal only.
- Betas (`8.1.0-beta.N`, `8.2.0-beta.N`) come on the way.

## Stacks

Each stack is one linear chain of PRs ([GitHub stacked PRs](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs)). Each PR builds on the PR before it.

- **Stack 1 (8.1):** groups A → B → H → D → E → F. See [v8.1/README.md](v8.1/README.md).
- **Stack 2 (8.2):** groups C → G, on top of stack 1. See [v8.2/README.md](v8.2/README.md).
- The work is split into numbered **items** (fixed IDs, not in build order), which the design, tests, and open items refer to. Each release's README groups the items into **PRs**, numbered in build order (decided 2026-10-18: one PR for each item only where that helps the review, for example a refactor that must change no output, or a security-relevant change).

Each release is built as a GitHub stack of PRs against `main`, and each PR is reviewed.

## Status marks

✅ decided · ❓ open question · (blank) not discussed yet

## Terms

| Term | Meaning |
|---|---|
| **Project dir** | The directory that has `static-publish.project.js` in managed mode. Often the repo root, but a repo can have several projects. The CLI runs from it, or gets it with `--project-dir`. |
| **App dir** | The Compute app: `.static-publish/app/` in managed mode (generated), `compute-js/` in ejected mode (the user's code). |
| **Managed mode** | The project has only `static-publish.project.js`, and no app in the repo. The CLI generates the app from a template when it needs it (`dev`, `deploy`, `status`). New in 8.1. |
| **Ejected mode** | The app is in the repo (`compute-js/`, with `static-publish.rc.js` and `publish-content.config.js`), and the user owns it. This is the layout of today. Existing projects are ejected projects. |
| **Working dir** | `staticPublisherWorkingDir`: files that the CLI writes when it publishes (for example `kvstore.json` for `--local`). |
| **Template** | What the app's code comes from. `plain` in 8.1 (internal). `plain` and `hono` in 8.2. |
| **Golden files** | Checked-in copies of the expected output of `generateApp()`, used by the tests. |

## Files

| File | Contents |
|---|---|
| [v8.1/README.md](v8.1/README.md) | Stack 1: the PRs and their status |
| [v8.1/design.md](v8.1/design.md) | The design for 8.1, with the decisions |
| [v8.1/tests.md](v8.1/tests.md) | Test rules for both stacks, and the tests for each 8.1 PR |
| [v8.1/open-items.md](v8.1/open-items.md) | Defaults to confirm, risks to test, and details to decide in a PR |
| [v8.1/current-state.md](v8.1/current-state.md) | Facts about the current code that the design depends on |
| [v8.2/README.md](v8.2/README.md) | Stack 2: the PRs and their status |
| [v8.2/design.md](v8.2/design.md) | The design for 8.2, with the decisions |
| [v8.2/tests.md](v8.2/tests.md) | The tests for each 8.2 PR |
| [v8.2/open-items.md](v8.2/open-items.md) | Details to decide in a PR |

## Later

### After 8.2.0 is released

- **Old package** `@fastly/hono-compute-js-static-publish` (its own repo): one last release whose README points to `@fastly/compute-js-static-publish/hono` and `MIGRATING.md`, then `npm deprecate` with the same pointer. It keeps working for v6 and v7 users.

### Not in 8.1 or 8.2

- A non-interactive first deploy with S3 storage: `deploy` would create the service, the `S3_CREDENTIALS` Secret Store with the secrets from env vars, the backend, and the links through the Fastly API.
- Protection for previews (a token or basic auth, with the secret in a Secret Store).
- A `config-store` source for collection selection (select the **default** collection from a Config Store, so that `live` can change with no deploy and no promote).
- Resource declarations: an extension declares backends, stores, or Fanout, and the template adds them to `fastly.toml`. GRIP is the main use case.
- esbuild loader settings in js-compute (so that extensions can import `.html` or `.svg` files).
- `.tsx`/`.jsx` extension modules (for `hono/jsx`).
- File-based routes for Hono extensions (`routes/api/hello.js` → `/api/hello`).
- Un-eject (ejected → managed).
- Upgrade help for ejected apps: compare the ejected files with what the current template would generate (uses `generatedFrom`).

### v9

- Remove the deprecated getters `serverTiming`, `settingsCached`, and `assetEntryMapCache` of `PublisherServer` (item 4).
- Remove `--public-dir` and `server.publicDirPrefix` (deprecated in 8.0, #100). Hidden files (8.1) replace their use.
- Decide whether `scaffold` makes a managed project by default.
