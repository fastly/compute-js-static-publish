# Open items (8.1)

No open design questions. These details are to decide or to test in their PRs.

## To decide in the PR

| Item | Detail |
|---|---|
| 11 or 13 | Whether ejected-mode commands also accept `--app-dir`, so that they can run from the repo root |

## Risks and checks

| Item | What to test or check |
|---|---|
| 14 | **D3 is tentative:** a lockfile for each template (A) or exact versions with no lockfile (B). Keep A unless shipping lockfiles turns out to be too difficult. (The spike found no problem with A.) |
| 14 | Not tested in the spike: Windows (npm uses junctions for `file:` links); npm 9 and 10 for nested lockfiles in the tarball; a CLI run from a local checkout of this repo (CLAUDE.md: the bin can lose its execute bit after a rebuild). |
| 14 | `npm ci` with a lockfile that has `registry.npmjs.org` URLs and a private registry in `.npmrc`. |
| 17 | A non-interactive first deploy in KV Store mode (the `[setup]` KV Store has no entries, so it should work). |
