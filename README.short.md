# @fastly/compute-js-static-publish

Fastly Compute + KV Store for static websites and web apps.

This CLI tool helps you:

- ✅ Deploy static sites to Fastly Compute with zero backend
- 📦 Store files in Fastly KV Store efficiently
  - 🎁 Since v8: Support for S3-compatible storage such as Fastly Object Storage
- 🗂 Publish to named collections (`live`, `preview-42`, etc.)
- 🔄 Switch between collections at runtime
- 🧹 Clean up old or expired assets

---

## Quick Start

Create a directory for your project, place your static files in `./public`, then type:

```sh
npx @fastly/compute-js-static-publish@latest --managed --root-dir=./public --kv-store-name=site-content
```

This makes a **managed project**: one file, `static-publish.project.js`, that you commit. The Static Publisher CLI generates the Compute app from it when it needs the app. Add `--template=hono` for a Hono app.

**Since v8:** S3-compatible storage (such as Fastly Object Storage) is also supported. To use it, type `--storage-mode=s3 --s3-region=<region> --s3-bucket=<bucket-name>` in place of `--kv-store-name=site-content`. If the storage needs a custom endpoint, as Fastly Object Storage does, add `--s3-endpoint=<endpoint>` (for example, `--s3-endpoint=https://us-east-1.object.fastlystorage.app`). For more details, see the [S3-compatible storage](https://github.com/fastly/compute-js-static-publish/blob/main/README.md#-using-s3-compatible-storage) section in the full documentation.

Then add this package to your project, so that the version of the CLI does not change by itself. If the directory has no `package.json`, run `npm init -y` first:

```sh
npm install --save-dev @fastly/compute-js-static-publish@latest
```

### 🔧 Local Preview

```sh
npx @fastly/compute-js-static-publish publish-content --local  # 'publish' your files to the simulated local KV Store
npx @fastly/compute-js-static-publish dev                      # preview locally
```

Serves your app at `http://127.0.0.1:7676`. `dev` generates the app in `.static-publish/app/`, which you do not commit. With `dev -- --watch`, a change in the app builds and restarts it.

If the project uses S3-compatible storage, use `publish-content` without `--local`. This uploads your files to the bucket. Set the `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` environment variables before you run `publish-content` and `dev`.

### 🚀 Deploy to Production

When you're ready to go live, [create a free Fastly account](https://www.fastly.com/signup/?tier=free) if you haven't already, and then:

```sh
npx @fastly/compute-js-static-publish deploy             # deploy the app
npx @fastly/compute-js-static-publish publish-content    # upload your static files
```

Both commands need a Fastly API token. Set the `FASTLY_API_TOKEN` environment variable, or add `--fastly-api-token=<token>`. The commands do not read the token of your Fastly CLI profile. If you are logged in with the Fastly CLI, you can give them that token:

```sh
export FASTLY_API_TOKEN=$(npx @fastly/cli auth token)
```

The first `deploy` makes a new service: the Fastly CLI asks for its name and its domain. Then `deploy` writes the Service ID into the project file. Commit the project file after this. With S3-compatible storage, the first deploy also asks for the S3 credentials, so do it on your computer, not in CI.

To upload changes to your static files, run only `publish-content`. It also purges the cache of the service. `deploy` deploys again only when the generated app changes, for example after you run `upgrade` to move the project to a new version of this package.

### Ejected app

To own the code of the Compute app, scaffold without `--managed`. This makes the app in `./compute-js`, and you commit all of its files:

```sh
npx @fastly/compute-js-static-publish@latest --root-dir=./public --kv-store-name=site-content
cd compute-js
npm install
npm run dev:publish          # 'publish' your files to the simulated local KV Store
npm run dev:start            # preview locally
npm run fastly:deploy        # deploy the app
npm run fastly:publish       # upload your static files
```

`fastly:publish` needs a Fastly API token too. If the app uses S3-compatible storage, use `npm run s3:publish` in place of `dev:publish` and `fastly:publish`. The full documentation has the details of [managed and ejected apps](https://github.com/fastly/compute-js-static-publish/blob/main/README.md#managed-and-ejected-apps).

## New in 8.1

- **Managed projects:** keep only `static-publish.project.js` in your repo. The CLI generates the app, and `dev`, `deploy`, `status`, `upgrade`, and `eject` work with it. ([Managed and ejected apps](https://github.com/fastly/compute-js-static-publish/blob/main/README.md#managed-and-ejected-apps))
- **Previews:** declaratively serve another collection for a request, selected by host, path, query, cookie, or header. ([Previews](https://github.com/fastly/compute-js-static-publish/blob/main/README.md#-previews-collection-selection))
- **Hidden files:** publish files that the server does not serve for a request, for your own code to read. Deploy your app with 8.1 before you publish hidden files: an app built with 8.0 does not serve a collection that has hidden files. ([Hidden files](https://github.com/fastly/compute-js-static-publish/blob/main/README.md#hidden-files))
- **Hono:** the `hono` template (`--template=hono`), and middleware for your own Hono app in `@fastly/compute-js-static-publish/hono`, which replaces `@fastly/hono-compute-js-static-publish`. To add your own middleware and routes, read [Using Hono](https://github.com/fastly/compute-js-static-publish/blob/main/README.md#-using-hono) in the full documentation.
- **CI:** `--json` output, exit codes, error codes, `--project-dir`, and `--non-interactive`. ([Using the CLI in CI](https://github.com/fastly/compute-js-static-publish/blob/main/README.md#-using-the-cli-in-ci))
- **Streaming response cache:** on a cache miss, the file goes to the visitor and into the cache at the same time, so the visitor does not wait for the whole file, and the request uses less memory. Apps from the `plain` and `hono` templates do this; in your own code, use `serveRequestStreaming()` and pass `fillPromise` to `event.waitUntil()`. It needs `@fastly/js-compute` 4.2 or later on a Fastly service. ([Streaming the response into the cache](https://github.com/fastly/compute-js-static-publish/blob/main/README.md#streaming-the-response-into-the-cache))

Before you upgrade, read [CHANGELOG.md](https://github.com/fastly/compute-js-static-publish/blob/main/CHANGELOG.md). These changes can break something:

- The name of a new collection must be a DNS label: lowercase `a-z`, `0-9`, and `-`, from 1 to 63 characters, with no `-` at the start or the end. A collection that exists continues to work with another name, with a warning.
- A usage or config error exits with `2`. Before, every error exited with `1`.
- `collectionSelector.fromCookie()`: the activate and reset paths redirect with `308`. Before, they used `302`.
- `PublisherServer`: the fields `serverTiming`, `settingsCached`, and `assetEntryMapCache` are read-only (deprecated). An assignment to them throws a `TypeError` (and is a TypeScript error).

## Features

- Named collections for previews, staging, production
- SPA + fallback handling
- Precompressed Brotli/gzip support
- CLI tools for publish, promote, and cleanup

## Documentation

📘 This package includes the full documentation in [DOCUMENTATION.md](DOCUMENTATION.md), with the CLI reference for this version.
It is also available on GitHub:  
[https://github.com/fastly/compute-js-static-publish/tree/main](https://github.com/fastly/compute-js-static-publish/tree/main)

### Security issues

Please see our [SECURITY.md](SECURITY.md) for guidance on reporting security-related issues.

## License

[MIT](./LICENSE).
