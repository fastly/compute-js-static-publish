---
name: release-and-port
description: Use when you tag or publish a release of this package, change the release workflow, or port changes between the v7 and v8 branches.
---

# Release and port

- `.github/workflows/ci-release.yaml` publishes a release when a `v*` tag is pushed. It uses the reusable workflows in `fastly/devex-reusable-workflows` (npm trusted publishing, and GitHub Packages). The first prerelease identifier becomes the npm dist-tag (`v8.0.0-beta.9` gives `beta`). A tag runs the workflow file in the tagged commit. Thus workflow changes must be on the branch that you tag.
- `prepublishOnly` replaces `README.md` with `README.short.md` in the package. Thus `README.short.md` is the README on npm.
- To find changes to port between `v7` and `v8`, use `git cherry -v origin/v7 origin/v8`. This command shows manual ports as missing, so compare the content. Some differences are intentional: `package.json`, the tsconfigs, and much of `src` (v8 has a separate CLI and server build, and storage providers).
