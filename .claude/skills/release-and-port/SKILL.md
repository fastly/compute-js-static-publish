---
name: release-and-port
description: Use when you tag or publish a release of this package, change the release workflow, or port changes between the `v7` branch and `main`.
---

# Release and port

- `.github/workflows/ci-release.yaml` publishes a release when a `v*` tag is pushed. It uses the reusable workflows in `fastly/devex-reusable-workflows` (npm trusted publishing, and GitHub Packages). The first prerelease identifier becomes the npm dist-tag (`v8.0.0-beta.9` gives `beta`). A tag runs the workflow file in the tagged commit. Thus workflow changes must be on the branch that you tag.
- A tag without a prerelease part (for example `v7.0.8`) gets the dist-tag `latest`. Thus a v7 release from the `v7` branch also moves `latest` back to 7.x. After a v7 release, run `npm dist-tag add @fastly/compute-js-static-publish@<latest 8.x version> latest`, or first change the workflow on `v7` so that it uses a different dist-tag.
- `prepublishOnly` replaces `README.md` with `README.short.md` in the package. Thus `README.short.md` is the README on npm.
- To find changes to port between `v7` and `main`, use `git cherry -v origin/v7 origin/main`. This command shows manual ports as missing, so compare the content. Some differences are intentional: `package.json`, the tsconfigs, and much of `src` (v8 has a separate CLI and server build, and storage providers).
- `CHANGELOG.md` in each branch records only the releases of that branch's major version. Do not copy a release of an older major (for example 7.0.8 from `v7`) into the `CHANGELOG.md` of a newer branch. The `CHANGELOG.md` of `main` says that it does not list v7 releases after 7.0.7 or v6 releases after 6.3.0. When a new major merges into `main`, update that note for the major that becomes old.
