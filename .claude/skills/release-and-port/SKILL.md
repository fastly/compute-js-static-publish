---
name: release-and-port
description: Use when you tag or publish a release of this package, change the release workflow, or port changes between the `v7` branch and `main`.
---

# Release and port

- `.github/workflows/ci-release.yaml` publishes a release when a `v*` tag is pushed. It uses the reusable workflows in `fastly/devex-reusable-workflows` (npm trusted publishing, and GitHub Packages). The first prerelease identifier becomes the npm dist-tag (`v8.0.0-beta.9` gives `beta`). A tag runs the workflow file in the tagged commit. Thus workflow changes must be on the branch that you tag.
- A tag without a prerelease part (for example `v8.0.0`) gets the dist-tag `latest`. The workflow on `v7` changes `latest` to `latest-v7`. Thus a stable v7 release from the `v7` branch does not move `latest`. A prerelease tag on `v7` still gets its prerelease identifier as the dist-tag.
- To release v7, push one commit to the `v7` branch that sets the version in `package.json` and `package-lock.json`, and moves the `[unreleased]` entries of `CHANGELOG.md` to a new version section. Update the compare links at the end of `CHANGELOG.md`. Then tag this commit (for example `v7.0.9`) and push the tag.
- `prepublishOnly` replaces `README.md` with `README.short.md` in the package. Thus `README.short.md` is the README on npm.
- To find changes to port between `v7` and `main`, use `git cherry -v origin/v7 origin/main`. This command shows manual ports as missing, so compare the content. Some differences are intentional: `package.json`, the tsconfigs, and much of `src` (v8 has a separate CLI and server build, and storage providers).
- `CHANGELOG.md` in each branch records only the releases of that branch's major version. Do not copy a release of an older major (for example 7.0.8 from `v7`) into the `CHANGELOG.md` of a newer branch. The `CHANGELOG.md` of `main` says that it does not list v7 releases after 7.0.8 or v6 releases after 6.3.0. When a new major merges into `main`, update that note for the major that becomes old.
