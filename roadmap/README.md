# Roadmap: 8.1

This folder has the plan for the next minor release, 8.1: the parts and their PRs, the design with its decisions, the tests, and the open items.

## 8.1.0

8.1 has six parts. Each part is one PR to the development branch `dev/8.1`, and each PR is reviewed. At the end, one PR merges `dev/8.1` into `main`.

| Part | Use case |
|---|---|
| 1. Templates | The base for the other parts. Customers see `--project-dir`, `--version`, and template hooks. |
| 2. Previews | "Show me this branch or PR before it goes live." |
| 3. Managed mode and eject | "I want my static site on Compute, but I do not want to maintain a Compute app." |
| 4. Publishing: hidden files | "Publish a file that the app uses, but that a visitor cannot open directly." |
| 5. CI: machine-readable output | Run the CLI from automation with no person present, and read the result. |
| 6. Hono | "My site is mostly static, but I need a small amount of code: an API route, auth, or GRIP streaming." |

The parts, their tasks, and the order of the PRs are in [v8.1/README.md](v8.1/README.md).

- All of it is an addition. Existing projects work as before.
- Betas (`8.1.0-beta.N`) come on the way. They are tagged on `dev/8.1`.

## Terms

| Term | Meaning |
|---|---|
| **Customer** | A developer who uses this package. |
| **Visitor** | A person who opens the customer's site. |
| **Project dir** | The directory that has the config file: `static-publish.rc.js` (in a scaffolded or ejected app), or `static-publish.project.js` (in managed mode). Often the repo root, but a repo can have several projects. The CLI runs from it, or gets it with `--project-dir`. |
| **App dir** | The Compute app: `compute-js/` in a scaffolded or ejected app (the customer's code), `.static-publish/app/` in managed mode (generated). |
| **Scaffolded app** | The app that `scaffold` makes, as in 8.0.0. Parts 1 and 2 use this term. Part 3 calls it an ejected app. |
| **Managed mode** | The project has only `static-publish.project.js`, and no app in the repo. The CLI generates the app from a template when it needs it (`dev`, `deploy`, `status`). New in part 3. |
| **Ejected mode** | The app is in the repo (`compute-js/`, with `static-publish.rc.js` and `publish-content.config.js`), and the customer owns it. Every scaffolded app, and every existing project, is an ejected app. The term comes in part 3. |
| **Working dir** | `staticPublisherWorkingDir`: files that the CLI writes when it publishes (for example `kvstore.json` for `--local`). |
| **Template** | What the app's code comes from: `plain` (the app of 8.0.0) or `hono` (part 6). |
| **Golden files** | Checked-in copies of the expected output of `generateApp()`, used by the tests. |

## Files

| File | Contents |
|---|---|
| [v8.1/README.md](v8.1/README.md) | The six parts: use case, how 8.0.0 works, tasks; the PRs and their dependencies |
| [v8.1/design.md](v8.1/design.md) | The design of each part, with the decisions |
| [v8.1/tests.md](v8.1/tests.md) | Test rules, and the tests for each task |
| [v8.1/current-state.md](v8.1/current-state.md) | Facts about the 8.0.0 code that the design depends on |

## Later

### Separate from the six parts (8.0.x or 8.1)

These do not depend on the six parts. Each can be a separate PR to `main`, in a patch release or in 8.1.

- **Remove the Beta label of S3-compatible storage** in 8.1: in `README.md`, `README.short.md`, `MIGRATING.md`, the CLI help text, the CLI log messages, and the code comments.
- **Retry an empty body** (follow-up to #116 and #52). If storage returns an empty body for a file whose size is not 0, `checkBodyLength()` throws before the response starts, and the client gets a `500`. Instead, the server could read the entry again for the same request. First, collect data from the log message `expected N bytes, got 0` to find how frequently this occurs.
- **Run only the end-to-end tests that use real services.** Each `describe` in `test/e2e` skips with `skipUnlessFastlyCli()` or `skipUnlessEnv()`. Thus, with credentials, the local tests always run too. Idea: an environment variable such as `CJSP_TEST_SKIP_LOCAL=1` in `test/e2e/helpers.js`.
- **End-to-end tests in CI.** `ci-test.yaml` runs only `npm test`.
   - The local tests (`fastly compute serve`) need only the Fastly CLI, so they can run for each PR.
   - The tests that use real services need repository secrets. `deployed.test.js` replaces the active version of the test service, so two runs must not overlap. Use a manual or a scheduled job, not a job for each PR.
- **GitHub releases from CI.** After the npm publish, `ci-release.yaml` creates the GitHub release for the tag. The notes are the section of that version in `CHANGELOG.md`, and a link to the comparison with the previous release. For a new major version, add a link to `MIGRATING.md`. A prerelease tag gets `--prerelease`. A release from the `v7` branch gets `--latest=false`, so that it does not become the latest release (the `v7` branch needs the same workflow change). Before v8.0.0, the repository had no GitHub releases.

### After 8.1.0 is released

- **Old package** `@fastly/hono-compute-js-static-publish` (its own repo): one last release whose README points to `@fastly/compute-js-static-publish/hono` and `MIGRATING.md`, then `npm deprecate` with the same pointer. It keeps working for v6 and v7 customers.

### v9

- Remove the deprecated getters `serverTiming`, `settingsCached`, and `assetEntryMapCache` of `PublisherServer` (task 2.2).
- Remove `--public-dir` and `server.publicDirPrefix` (deprecated in 8.0, #100). Hidden files (part 4) replace their use.
- Decide whether `scaffold` makes a managed project by default.

### Possible future features

- A non-interactive first deploy with S3 storage: `deploy` would create the service, the `S3_CREDENTIALS` Secret Store with the secrets from env vars, the backend, and the links through the Fastly API.
- Protection for previews (a token or basic auth, with the secret in a Secret Store).
- A `config-store` source for collection selection (select the **default** collection from a Config Store, so that `live` can change with no deploy and no promote).
- Resource declarations: an extension declares backends, stores, or Fanout, and the template adds them to `fastly.toml`. GRIP is the main use case.
- esbuild loader settings in js-compute (so that extensions can import `.html` or `.svg` files).
- `.tsx`/`.jsx` extension modules (for `hono/jsx`).
- File-based routes for Hono extensions (`routes/api/hello.js` → `/api/hello`).
- Un-eject (ejected → managed).
- Upgrade help for ejected apps: compare the ejected files with what the current template would generate (uses `generatedFrom`).
