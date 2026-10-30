---
name: release-and-port
description: Use when you tag or publish a release of this package, change the release workflow, or port changes between the `v7` branch and `main`.
---

# Release and port

- `.github/workflows/ci-release.yaml` publishes a release when a `v*` tag is pushed. It uses the reusable workflows in `fastly/devex-reusable-workflows` (npm trusted publishing, and GitHub Packages). The first prerelease identifier becomes the npm dist-tag (`v8.0.0-beta.9` gives `beta`). A tag runs the workflow file in the tagged commit. Thus workflow changes must be on the branch that you tag.
- A tag without a prerelease part (for example `v8.0.0`) gets the dist-tag `latest`. The workflow on `v7` changes `latest` to `latest-v7`. Thus a stable v7 release from the `v7` branch does not move `latest`. A prerelease tag on `v7` still gets its prerelease identifier as the dist-tag.
- To release v8 from `main` (each PR to `main` needs an approval):
   1. Make a branch `release/v<version>` (for example `release/v8.0.1`) from `main`.
   2. In that branch, set the version in `package.json` and `package-lock.json`. In `CHANGELOG.md`, move the `[unreleased]` entries to a new version section with the date, and update the compare links at the end of the file. A version section compares with the previous release, not with its betas, and its entries do not build on each other. Remove fixes for bugs that only a beta of this version had.
   3. Push the branch, and open a PR to `main`.
   4. After the approval, tag the head commit of the PR (for example `v8.0.1`), and push the tag. Do not add commits to the branch after the tag.
   5. Merge the PR. The repository allows only merge commits, so the tagged commit is in the history of `main`. Then delete the branch.
   6. Some minutes after the release workflow is complete, check the dist-tags with `npm view @fastly/compute-js-static-publish dist-tags`. A new version can take some minutes to show on npm.
- To tag a prerelease (a beta or an RC) from work that is not merged yet, for example the top of a PR stack: make a version commit on top of that branch (it changes only `package.json` and `package-lock.json`), tag that commit (for example `v8.1.0-beta.1`), and push only the tag. No branch contains the version commit, so it is in no PR and does not go into `main`. `ci-release.yaml` checks that `package.json` in the tagged commit has the version from the tag name, so the version commit is necessary. The version goes into `main` only with the final release's version commit. Example: `v8.0.0-rc.1` (commit `b027785`), on top of the branch of #99.
- To release v7, push one commit to the `v7` branch that sets the version in `package.json` and `package-lock.json`, and moves the `[unreleased]` entries of `CHANGELOG.md` to a new version section. Update the compare links at the end of `CHANGELOG.md`. Then tag this commit (for example `v7.0.9`) and push the tag.
- `prepublishOnly` copies the full `README.md` to `DOCUMENTATION.md`, then replaces `README.md` with `README.short.md`. Thus `README.short.md` is the README on npm, the full README is the README on GitHub, and the package has the full README as `DOCUMENTATION.md`. Git ignores `DOCUMENTATION.md`.
- To find changes to port between `v7` and `main`, use `git cherry -v origin/v7 origin/main`. This command shows manual ports as missing, so compare the content. Some differences are intentional: `package.json`, the tsconfigs, and much of `src` (v8 has a separate CLI and server build, and storage providers).
- `CHANGELOG.md` in each branch records only the releases of that branch's major version. Do not copy a release of an older major (for example 7.0.8 from `v7`) into the `CHANGELOG.md` of a newer branch. The `CHANGELOG.md` of `main` says that it does not list v7 releases after 7.0.8 or v6 releases after 6.3.0. When a new major merges into `main`, update that note for the major that becomes old.
