# Open items (8.1)

No open design questions. These details are to decide or to test in their PRs.

## To decide in the PR

| Item | Detail |
|---|---|
| 9 | The small API that tells "collection not found" from "file not found", for `onMissing` |
| 10 | The final syntax of the collection-selection flags |
| 18 | `.gitignore` after eject: the working dir (`my-site/static-publisher/`) stays ignored by the project's `.gitignore`. `generateApp()` adds the working dir to the app's own `.gitignore` only if it is inside the app dir. The `.static-publish/` line in the project's `.gitignore` is stale after eject: `eject` says so in its summary, but never changes the user's `.gitignore`. |
| 16 | The format of the version comment (for example `static-publish 8.1.0 fp:<sha256>`), and whether a user comment (for example a commit SHA) can be added |
| 11 or 13 | Whether ejected-mode commands also accept `--app-dir`, so that they can run from the repo root |
| 12 | The list of `error.code` values |
| 11 | Resolve `staticPublisherWorkingDir` against the directory of the config file (the project file or the rc), not the current directory. Today the code uses `path.resolve(staticPublisherWorkingDir, …)` (for example in `kv-store-local-provider.ts`), which is the same only while commands run where the config file is. `--project-dir` makes them differ. |

## Risks and checks

| Item | What to test or check |
|---|---|
| 14 | **D3 is tentative:** a lockfile for each template (A) or exact versions with no lockfile (B). Keep A unless shipping lockfiles turns out to be too difficult. (The spike found no problem with A.) |
| 14 | Not tested in the spike: Windows (npm uses junctions for `file:` links); npm 9 and 10 for nested lockfiles in the tarball; a CLI run from a local checkout of this repo (CLAUDE.md: the bin can lose its execute bit after a rebuild). |
| 14 | `npm ci` with a lockfile that has `registry.npmjs.org` URLs and a private registry in `.npmrc`. |
| 17 | Whether `deploy` warns when the CLI runs from the npx cache (the deployed Wasm binary then contains the user's home directory). |
| 17 | A non-interactive first deploy in KV Store mode (the `[setup]` KV Store has no entries, so it should work). |
