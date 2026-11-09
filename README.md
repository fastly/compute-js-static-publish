# Static Publisher for JavaScript on Fastly Compute

> NOTE: `@fastly/compute-js-static-publish` is provided as a Fastly Labs product. Visit the [Fastly Labs](https://www.fastlylabs.com/) site for terms of use.

> [!NOTE]
> v8 adds Beta support for S3-compatible storage, such as Fastly [Object Storage](https://www.fastly.com/products/storage). For more details, see the [S3-compatible storage](#-using-s3-compatible-storage-beta) section.  

> [!NOTE]
> These docs are for v7 or newer, a major rewrite that adds powerful new features such as named collections.
> If you're looking for v6, please check out the [v6 branch](https://github.com/fastly/compute-js-static-publish/tree/v6).

> [!WARNING]
> v7 and newer no longer support module assets. If you require this feature, consider using [v6](https://github.com/fastly/compute-js-static-publish/tree/v6).

## 📖 Table of Contents

- [✨ Key Features](#-key-features)
- [🏁 Quick Start](#-quick-start)
  - [📦 Fastly KV Store](#-using-the-fastly-kv-store) 
  - [🎁 S3 Compatible Storage](#-using-s3-compatible-storage-beta) (Beta)
- [⚙️ Configuring `static-publish.rc.js`](#️-configuring-static-publishrcjs)
- [🧾 Config for Publishing and Server: `publish-content.config.js`](#-config-for-publishing-and-server-publish-contentconfigjs)
- [📦 Collections (Publish, Preview, Promote)](#-collections-publish-preview-promote)
- [🧹 Cleaning Up](#-cleaning-up)
- [🔄 Content Compression](#-content-compression)
- [🧩 Using PublisherServer in Custom Apps](#-using-publisherserver-in-custom-apps)
- [🔥 Using Hono](#-using-hono)
- [📥 Using Published Assets in Your Code](#-using-published-assets-in-your-code)
- [📚 CLI Reference](#-cli-reference)
- [📕 Appendix](#-appendix)
- [📚 Next Steps](#-next-steps)

Serve static websites and web apps at the edge &mdash; no backends and no CDN invalidation delays.

`@fastly/compute-js-static-publish` helps you deploy and serve static files using [Fastly Compute](https://developer.fastly.com/learning/compute/) for fast, cacheable, and content-addressed delivery. The library can be configured to store your data in either of the following:
* Fastly [Key Value Store](https://www.fastly.com/products/kv-store)
* S3-compatible storage, such as Fastly [Object Storage](https://www.fastly.com/products/storage) (Beta) 

## ✨ Key Features

- 📦 Easy to scaffold and deploy
- 🚀 Content stored using hashed keys, in Fastly KV Store or S3-compatible storage (Beta) including Fastly Object Storage
- 🔁 Publish new content without needing to deploy new Wasm binaries
- 🗂 Organize releases into named collections which can be previewed (e.g. `live`, `staging`, `preview-123`)
- 🧼 Cleanup tools to remove expired or orphaned files
- ⚙️ Configurable per-collection server configurations (e.g. fallback files)
- 🔒 Supports Brotli/gzip compression, conditional GET, and long cache TTLs

---

## 🏁 Quick Start

### 📦 Using the Fastly KV Store

#### 1. Scaffold a Compute App

Create a directory for your project, place your static files in `./public`, then type:

```sh
npx @fastly/compute-js-static-publish@latest \
  --root-dir=./public \
  --kv-store-name=site-content
```

You get a Compute app in `./compute-js` with:

- `fastly.toml` (service config)
- `src/index.js` (entry point)
- `static-publish.rc.js` (app config)
- `publish-content.config.js` (publish-time / runtime behavior)

Once the application is scaffolded, install dependencies:

```sh
cd compute-js
npm install
```

#### 2. Preview Locally

Type the following &mdash; no Fastly account or service required yet!

```sh
npm run dev:publish
npm run dev:start
```

Fastly's [local development environment](https://www.fastly.com/documentation/guides/compute/testing/#running-a-local-testing-server) serves your static website at `http://127.0.0.1:7676`, powered by a simulated KV Store.

#### 3. Deploy Your App

Ready to go live? All you need is a [free Fastly account](https://www.fastly.com/signup/?tier=free)!

```sh
npm run fastly:deploy
```

The command publishes your Compute app and creates the KV Store. (No content uploaded yet!)

#### 4. Publish Content

```sh
npm run fastly:publish
```

This command uploads your static files to the KV Store and applies the server config.  Your website is now up and live!

`fastly:publish` needs a Fastly API token that can write to the KV Store. Set the `FASTLY_API_TOKEN` environment variable, or add `-- --fastly-api-token=<token>`. The command does not read the token of your Fastly CLI profile. If you are logged in with the Fastly CLI, you can give it that token:

```sh
FASTLY_API_TOKEN=$(npx fastly auth token) npm run fastly:publish
```

### 🎁 Using S3 Compatible Storage (Beta)

#### 1. Scaffold a Compute App

Create a directory for your project, place your static files in `./public`, then type:

```sh
npx @fastly/compute-js-static-publish@latest \
  --root-dir=./public \
  --storage-mode=s3 \
  --s3-region=<s3 region> \
  --s3-bucket=<bucket name>
```

> [!NOTE]
> If the storage requires a custom endpoint, such as is the case with Fastly Object Storage, specify it using `--s3-endpoint=<endpoint>`. For example:
>
> ```sh
> npx @fastly/compute-js-static-publish@latest \
>   --root-dir=./public \
>   --storage-mode=s3 \
>   --s3-region=us-east-1 \
>   --s3-bucket=my-static-content-bucket \
>   --s3-endpoint=https://us-east-1.object.fastlystorage.app
> ```
>
> For the regions of Fastly Object Storage and their endpoints, see [Working with Object Storage](https://www.fastly.com/documentation/guides/platform/object-storage/working-with-object-storage/#managing-object-storage-buckets-and-objects).

You get a Compute app in `./compute-js` with:

- `fastly.toml` (service config)
- `src/index.js` (entry point)
- `static-publish.rc.js` (app config)
- `publish-content.config.js` (publish-time / runtime behavior)

Once the application is scaffolded, install dependencies:

```sh
cd compute-js
npm install
```

#### 2. Publish your content to S3-compatible storage

Before publishing your content, your S3-compatible bucket must already exist.

> [!TIP]
> If you're using Fastly Object Storage, [create your Fastly account](https://www.fastly.com/signup/?tier=free) if you haven't already, and then follow the [Object Storage quick start](https://www.fastly.com/documentation/guides/platform/object-storage/object-storage-quick-start/) to set up your bucket.

Type the following:

```sh
npm run s3:publish
```

#### 3. Preview Locally

Type the following to preview your site locally:

```sh
npm run dev:start
```

Fastly's [local development environment](https://www.fastly.com/documentation/guides/compute/testing/#running-a-local-testing-server) serves your static website at `http://127.0.0.1:7676`. Your content is fetched from S3-compatible storage.

#### 4. Deploy Your App

Ready to go live? All you need is a [free Fastly account](https://www.fastly.com/signup/?tier=free)!

```sh
npm run fastly:deploy
```

The app reads the S3 credentials from the Secret Store that has the resource link name `S3_CREDENTIALS` on your service.

When the Fastly CLI creates a new service, it creates a Secret Store named `S3_CREDENTIALS`, links it to the service with the same name, and prompts you for the values `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`.

---

## 🗂 Project Layout

Here's what your project might look like after scaffolding:

```
my-project/
├── public/                              # Your static site files (HTML, CSS, JS, etc.)
│   ├── index.html
│   ├── scripts.js
│   ├── styles.css
│   └── (... other static files ...)
└── compute-js/                          # The scaffolded Compute application
    ├── fastly.toml                      # Fastly service configuration
    ├── package.json                     # Scaffolded package metadata
    ├── package-lock.json                # Dependency lockfile
    ├── .gitignore                       # Ignores build artifacts by default
    ├── static-publish.rc.js             # App config
    ├── publish-content.config.js        # Publishing / runtime config
    ├── static-publisher/                # ⚠️ Do not commit - generated content for local dev and publishing
    │   ├── kvstore.json                 # Simulates KV Store content for local preview
    │   └── kv-store-content/            # Preprocessed and compressed files for KV upload
    ├── scripts/                         # Optional: template hooks (template_<hook>.js, template_watch.js)
    └── src/
        └── index.js                     # Your Compute app entry point
```

### Managed and ejected apps

From 8.1.0, a project can be **managed** or **ejected**:

| | Managed | Ejected |
|---|---|---|
| In the repo | One file, `static-publish.project.js`, in the project dir | The app dir (`compute-js/`) with `static-publish.rc.js` and `publish-content.config.js`, as above |
| Who owns the app code | This package: it generates the app | You |
| Upgrade this package | Run `upgrade`; the next `deploy` deploys the new app | Change the files by hand (see `MIGRATING.md`) |
| Deploy | `deploy`, only when the generated app changed | `npm run fastly:deploy` (or `deploy`) |
| Customize | The options of the project file | Anything |

An **ejected app** is in the repo, and you own its code. Every app that `scaffold` makes without `--managed`, and every app made before 8.1.0, is an ejected app. A **managed project** has only a project file in the repo, and this package generates the app when it needs it.

`scaffold` makes an ejected app, as before. `scaffold --managed` makes a managed project. `eject` converts a managed project into an ejected app. To move an existing app to managed mode, see `MIGRATING.md`.

#### Managed projects

`scaffold --managed` writes only one file, `static-publish.project.js`, in the current directory (the project dir), and adds `.static-publish/` and the working directory to the `.gitignore` there:

```
my-site/
├── static-publish.project.js            # Commit this: the only config file
├── public/                              # Your static site files
├── .gitignore                           # Ignores .static-publish/ and static-publisher/
└── static-publisher/                    # ⚠️ Do not commit - the working directory
```

The project file has the settings that an ejected app has in its two files:

- The top level has the fields of `static-publish.rc.js` (`storageMode`, `kvStore` or `s3`, `publishId`, `defaultCollectionName`, `staticPublisherWorkingDir`, `collectionSelection`), and the settings of the template (`build` and `templateOptions`, see [Hono extensions](#hono-extensions)).
- `publishContent` has the fields of `publish-content.config.js`. `publish-content --config <file>` replaces it for one run.
- `managed` has the settings of the generated app (`name`, `description`, `authors`, `serviceId`, `staticPublishVersion`, the version of this package that the project uses, and `fastlyToml`, see below).

Paths in the project file are relative to it. The name of the file marks the mode: a directory with `static-publish.project.js` is a managed project, and a directory with `static-publish.rc.js` is an ejected app. A directory with both is an error.

`publish-content`, `collections`, and `clean` run in the project dir (or with `--project-dir`), and read the project file. `publish-content` purges the service of `managed.serviceId`, after `--fastly-service-id` and `FASTLY_SERVICE_ID`.

To run the app on your computer:

```sh
npx @fastly/compute-js-static-publish publish-content --local
npx @fastly/compute-js-static-publish dev
```

`dev` generates the app in `.static-publish/app/`, installs its dependencies with `npm ci` if they changed, and runs `fastly compute serve` in it. Options after `--` go to `fastly compute serve`, for example `dev -- --addr=127.0.0.1:8080`. With `dev -- --watch`, a change in the app builds and restarts it, and the watch script of the template (`scripts/template_watch.js`, see [Template hooks](#-template-hooks)), if it has one, runs next to `fastly compute serve`. The app serves the content of the local KV Store, `kvstore.json` in the working directory.

**Local resources and setup in `fastly.toml`.** The CLI generates the `fastly.toml` of the app. To add resources for `fastly compute serve` (`[local_server]`) or for the first deploy, which makes the service (`[setup]`), add them to `managed.fastlyToml`, in the structure of [`fastly.toml`](https://www.fastly.com/documentation/reference/compute/fastly-toml/). For example, a local Secret Store and a local Config Store:

```js
managed: {
  // ...
  fastlyToml: {
    local_server: {
      secret_stores: { oauth: [ { key: 'GITHUB_CLIENT_SECRET', env: 'GITHUB_CLIENT_SECRET' } ] },
      config_stores: { site_config: { format: 'inline-toml', contents: { greeting: 'hello' } } },
    },
    setup: {
      secret_stores: { oauth: { entries: { GITHUB_CLIENT_SECRET: { description: 'The client secret' } } } },
    },
  },
},
```

- Only `local_server` and `setup` can be added. The CLI writes the other parts of `fastly.toml`.
- The CLI also writes some resources: the KV Store of the content, and in S3 mode, the `S3_CREDENTIALS` Secret Store and the `s3_storage` backend. A resource with one of these names is an error.
- Do not put a secret in the project file: in `local_server`, read it from an environment variable (`env`) or a file (`file`) that is not committed.
- `local_server` does not change the fingerprint, because it is only for `fastly compute serve`. `setup` changes it.
- `eject` writes the sections into the `fastly.toml` of the ejected app.

`managed.template` selects the template of the app: `plain` (the default) or `hono`. To switch, change it. The next `dev` or `deploy` generates the app again with the new template, and `npm ci` installs its dependencies. The fingerprint changes, so `deploy` deploys again. Files of the old template can stay in `.static-publish/app/`. They do not change the build. To remove them, delete `.static-publish/`: the next `dev` or `deploy` generates it again.

The same version of this package always generates the same app, with the same versions of all dependencies: this package has a lockfile for the app of each template. The app uses the copy of this package that runs the CLI, through a `file:` link. Thus, add this package as a dev dependency of your project, and run the CLI from it, so that the version is pinned:

```sh
npm install --save-dev @fastly/compute-js-static-publish
```

To deploy the app:

```sh
npx @fastly/compute-js-static-publish deploy
```

`deploy` generates the app, installs it if necessary, and runs `fastly compute build` and `fastly compute deploy`, only if the app changed. It needs a Fastly API token (`FASTLY_API_TOKEN` or `--fastly-api-token`).

- **The fingerprint** is a SHA-256 of the generated app and the version of this package. It does not depend on the content, on `publishContent`, on the Service ID, or on the path of this package on your computer. `deploy` writes it into the comment of the new service version (`static-publish <version> fp:<fingerprint>`, then ` | <text>` with `--comment <text>`, for example a commit SHA). The next `deploy` reads the comment of the active version, and does nothing if the fingerprint is the same. `--force` deploys anyway.
- **The first deploy** makes a new service (the Fastly CLI asks for its name and domain, unless `--non-interactive`), and writes its ID into `managed.serviceId`. Commit the project file then. To deploy to a service that exists, use `--fastly-service-id` or `FASTLY_SERVICE_ID`. With S3 storage, the first deploy must be done on your computer, because the Fastly CLI asks for the S3 credentials of the Secret Store; with `--non-interactive`, it is an error.
- `status` shows the fingerprint of the app, the fingerprint of the active version, and if a deploy is necessary, and the preview URLs of [collection selection](#-previews-collection-selection). Without an API token, the deployed fingerprint is unknown.

**The version of this package.** `managed.staticPublishVersion` records the version of this package that the project uses. `dev` and `deploy` compare it with the version that runs:

| The CLI that runs | Result |
|---|---|
| The same version | Continue. |
| A newer version | Stop. Run `upgrade` to move the project to the new version (and commit the project file), or use `--auto-upgrade`. |
| An older version | Stop. An older version never deploys over an app that a newer version made. |

Thus a new release of this package never changes your app by itself, also with `npx @fastly/compute-js-static-publish@latest`.

**Eject.** `eject` converts a managed project into an ejected app that you own:

- It writes the app that `deploy` would deploy into `./compute-js` (or `--dir`). It refuses a directory that exists, unless `--force`.
- It splits the project file into `compute-js/static-publish.rc.js` (with `generatedFrom`) and `compute-js/publish-content.config.js`, and writes the paths again, so that they point at the same directories (for example `staticPublisherWorkingDir: '../static-publisher'`). Then it deletes `static-publish.project.js`.
- `publishContent` must be data: eject cannot copy functions or regular expressions (for example `assetInclusionTest`). If it has them, eject stops before it writes anything. Remove them, eject, and add them to `compute-js/publish-content.config.js` by hand.
- `package.json` gets `"@fastly/compute-js-static-publish": "^<version>"`, and the lockfile has exactly `<version>`, so that the first ejected build is the same app. This needs a version that is published on npm, and one `npm install` (network access).
- After eject, run the commands in `compute-js/`. Run `publish-content --local` again before `npm run dev:start`. You can delete `.static-publish/`.

**API token scopes.** Give CI the least access that it needs. As far as we know (check the [Fastly documentation of API tokens](https://www.fastly.com/documentation/reference/api/auth-tokens/)):

| Command | Scope |
|---|---|
| `status` (the active version of the service) | `global:read` |
| `publish-content` and `collections` with the KV Store (writes) | `global` |
| The purge after `publish-content` (S3 storage) | `purge_select` |
| `deploy` | `global` |

Limit the token to the service of the project, where possible.


### 🪝 Template hooks

The `package.json` of a scaffolded app has these scripts:

```json
"prebuild":    "compute-js-static-publish run-template-hook prebuild",
"build":       "js-compute-runtime ./src/index.js ./bin/main.wasm",
"postbuild":   "compute-js-static-publish run-template-hook postbuild",
"postinstall": "compute-js-static-publish run-template-hook postinstall"
```

`run-template-hook <name>` runs `scripts/template_<name>.js` if that file exists, and otherwise does nothing. Thus, to run your own code before or after each build, or after each `npm install`, add one of these files:

- `scripts/template_prebuild.js`
- `scripts/template_postbuild.js`
- `scripts/template_postinstall.js`

The file runs with Node.js, in the directory of the app. If it fails, the build or the install fails. `fastly compute build`, `fastly compute serve`, and `fastly compute publish` run `npm run build`, so they also run the build hooks. `npm install --ignore-scripts` does not run the hooks.

The app also has a `dev:watch` script:

```json
"dev:watch":   "compute-js-static-publish run-dev-watch"
```

`npm run dev:watch` runs `fastly compute serve --watch`, which builds and restarts the app when a file in the app directory changes. Options after `--` go to `fastly compute serve`, for example `npm run dev:watch -- --addr=127.0.0.1:8080`. If the app has `scripts/template_watch.js`, that file runs with Node.js next to the Fastly CLI, until the Fastly CLI stops. Use it to watch files outside the app directory: when they change, write a file in the app directory, and the Fastly CLI builds the app again.

## ⚙️ Configuring `static-publish.rc.js`

This file defines your compute-js-static-publish application's settings. A copy of this is also baked into the Wasm binary and loaded when running your Compute app locally or on the edge.

> [!NOTE]
> Making changes to this file requires rebuilding the Compute app, since a copy of it is baked into the Wasm binary.

### Using the Fastly KV Store

#### Fields:

All fields are required unless specified otherwise.

- `storageMode` - Specifies the storage mode. Set to `'kv-store'`.
- `kvStore.kvStoreName` - The name of the KV Store used for publishing.
- `defaultCollectionName` - Collection to serve when none is specified.
- `publishId` - Unique prefix for all keys in the KV Store. Override only for advanced setups (e.g., multiple apps sharing the same KV Store).
- `staticPublisherWorkingDir` - Directory to hold working files during publish. The path is relative to the directory of `static-publish.rc.js`.
- `generatedFrom` - (optional) A record of how the app was made: the template, the version of this package, and the date. The scaffolder writes it. The app does not use it.

#### Example: `static-publish.rc.js`

```js
const rc = {
  storageMode: 'kv-store',
  kvStore: {
    kvStoreName: 'site-content',
  },
  defaultCollectionName: 'live',
  publishId: 'default',
  staticPublisherWorkingDir: './static-publisher',
};

export default rc;
```

### Using S3-compatible storage (BETA)

#### Fields:

All fields are required unless specified otherwise.

- `storageMode` - Specifies the storage mode. Set to `'s3'`.
- `s3.region` - The region of the S3-compatible bucket.
- `s3.bucket` - The name of the S3-compatible bucket.
- `s3.endpoint` - (optional) The custom endpoint for the S3-compatible bucket.
- `defaultCollectionName` - Collection to serve when none is specified.
- `publishId` - Unique prefix for all keys in the bucket. Override only for advanced setups (e.g., multiple apps sharing the same bucket).
- `staticPublisherWorkingDir` - Directory to hold working files during publish. The path is relative to the directory of `static-publish.rc.js`.
- `generatedFrom` - (optional) A record of how the app was made: the template, the version of this package, and the date. The scaffolder writes it. The app does not use it.

#### Example: `static-publish.rc.js`

```js
const rc = {
  storageMode: 's3',
  s3: {
    region: 'us-east-1',
    bucket: 'my-site-content',
  },
  defaultCollectionName: 'live',
  publishId: 'default',
  staticPublisherWorkingDir: './static-publisher',
};

export default rc;
```

## 🧾 Config for Publishing and Server: `publish-content.config.js`

This file is included as part of the scaffolding. Every time you publish content, the publish settings in this file are used for publishing the content, and the server settings are taken from this file and saved as the settings used by the server for that collection.

```js
const config = {
  // these paths are relative to compute-js dir
  rootDir: '../public',

  // Include/exclude filters (optional):
  excludeDirs: ['node_modules'],
  excludeDotFiles: true,
  includeWellKnown: true,

  // Advanced filtering (optional):
  assetInclusionTest: (key, contentType) => {
    return true; // include everything by default
  },

  // Files to publish as hidden files (optional):
  hiddenItems: ['/404.html', '/templates/'],

  // Override which compressed variants to create for each asset during publish (optional):
  contentCompression: ['br', 'gzip'],

  // Brotli quality, 0 to 11 (optional, default 11):
  brotliQuality: 11,

  // Content type definitions/overrides (optional):
  contentTypes: [
    { test: /\.custom$/, contentType: 'application/x-custom', text: false },
  ],

  // Server settings
  server: {
    spaFile: '/spa.html',
    notFoundPageFile: '/404.html',
    autoIndex: ['index.html'],
    autoExt: ['.html'],
    staticItems: ['/static/', '/assets/'],
    allowedEncodings: ['br', 'gzip'],
  }
};

export default config;
```

You can override this file for a single `publish-content` command by specifying an alternative using `--config` on the command line.

### Fields:

- `rootDir` - Directory to scan for content, relative to this file (required).
- `excludeDirs` - Array of directory names or regex patterns to exclude (default: `['./node_modules']`).
- `excludeDotFiles` - Exclude dotfiles and dot-named directories (default: true).
- `includeWellKnown` - Always include `.well-known` even if dotfiles are excluded (default: true).
- `assetInclusionTest` - Function to determine inclusion and variant behavior per file. Return `false` to leave the file out, `true` to include it, or `{ hidden: true }` to include it as a [hidden file](#hidden-files).
- `hiddenItems` - The files to publish as [hidden files](#hidden-files). The same format as `server.staticItems`, tested against the asset key (the path relative to `rootDir`): a directory that ends with `/`, an exact path, a glob pattern, or `'re:/<regex>/<flags>'` (default: none).
- `contentCompression` - Array of compression formats to pre-generate (`['br', 'gzip']` by default).
- `brotliQuality` - Brotli quality for the `br` variants, an integer from 0 to 11 (default: 11). Quality 11 gives the smallest files but is the slowest. Quality 10 is approximately 3 times faster, and its files are approximately 2% larger. If you change this value, variants that are already in storage are not compressed again.
- `contentTypes` - Additional or override content type definitions.

- `server` - Server runtime config that contains the following fields:  
   - `publicDirPrefix` - **Deprecated.** A future version will remove it.
     A prefix that the Publisher Server adds to the path of each
     request, to get the asset key. Use it if the files to serve are in a subdirectory
     of `rootDir`. For example, if `rootDir` is `'../site'` and the files to serve are in
     `'../site/public'`, set it to `'/public'`. The value starts with `/` and does not
     end with `/` (default: `''`). The scaffolder sets it from `--root-dir` and `--public-dir`.
   - `spaFile` - Path to a file to be used to serve in a SPA application.
   - `notFoundPageFile` - Path to a file to be used to serve as a 404 not found page.
   - `autoIndex` - List of files to automatically use as index.
   - `autoExt` - List of extensions to automatically apply to a path and retry when
     the requested path is not found.
   - `staticItems` - Directories to specify as containing 'static' files. The
     Publisher Server will serve files from these directories with a long TTL.
   - `allowedEncodings` - Specifies which compression formats the server is allowed
     to serve based on the client's `Accept-Encoding` header.

### Hidden files

A hidden file is published, but the Publisher Server does not serve it for a request, also not through `autoExt` or `autoIndex`. Use hidden files for:

- The 404 page: a request for `/404.html` must not get the 404 page with status `200`. If the `spaFile` or the `notFoundPageFile` is hidden, the server still serves it as the fallback page.
- Files that your code reads, for example templates. Get them with `getMatchingAsset(key, { includeHidden: true })` (see [Using Published Assets in Your Code](#-using-published-assets-in-your-code)).

A file is hidden if `hiddenItems` selects it, or if `assetInclusionTest` returns `{ hidden: true }` for it:

```js
const config = {
  rootDir: '../public',
  hiddenItems: ['/404.html', '/templates/'],
  assetInclusionTest: (key) => key.endsWith('.tpl') ? { hidden: true } : true,
  server: {
    notFoundPageFile: '/404.html',
  },
};
```

`publish-content` and `collections list` show the number of hidden files.

> [!WARNING]
> **Hidden is not access control.** Hidden files are in storage (the KV Store or the bucket), the same as the other files, and code that asks for hidden files can serve them. Do not use hidden files for secrets.

A collection that has hidden files requires the `hidden` feature. An app that is built with a version earlier than 8.1.0 does not serve such a collection (8.0), or does not find its hidden files (earlier versions). Build and deploy your app with 8.1.0 or later before you publish hidden files.

## 📦 Collections (Publish, Preview, Promote)

Collections are a powerful feature that allow you to publish and manage multiple versions of your site simultaneously. Each collection is a named set of:

- Static files
- Server configuration (e.g., fallback file, static directories, etc.)
- An index file that maps paths to those hashes

Collections are published using a `--collection-name`, and can be reused, updated, or deleted independently. For example, you can create a staging version of your site using:

```sh
npx @fastly/compute-js-static-publish publish-content \
  --collection-name=staging \
  --expires-in=7d \
  --config=./publish-content.config.js
```

You can overwrite or republish any collection at any time. Old file hashes will be reused automatically where contents match.

A collection name must be a DNS label: lowercase `a-z`, `0-9`, and `-`, from 1 to 63 characters, with no `-` at the start or the end (for example `live`, `staging`, `pr-42`). Thus a name is safe in storage keys, in cookies, and in hostnames. If a CI tool makes collection names from branch names, it must convert them to this form (for example `feature/Foo_bar` to `feature-foo-bar`). A collection that was published before this rule continues to work, with a warning, but new collections must follow it.

### Expiration (Auto-cleanup)

Collections can expire automatically:

- Expired collections are ignored by the server and return 404s
- A request for a collection other than the default collection that is expired or not published gets a plain-text 404 that names the collection. The response cache does not store it, so the collection is served as soon as you publish it. If the default collection is not published, the server returns a 500.
- The default collection never expires
- Expiration limits can be modified (shortened, extended, reenstated) using `collections update-expiration` 
- They are cleaned up by `clean --delete-expired-collections`

```sh
--expires-in=3d                 # relative (e.g. 1h, 2d, 1w)
--expires-at=2025-05-01T12:00Z  # absolute (ISO 8601)
--expires-never                 # the collection never expires
```

*(Only one of **`--expires-in`**, **`--expires-at`**, or **`--expires-never`** may be specified)*

### Switching the active collection

By default, the server app serves assets from the "default collection", named in `static-publish.rc.js` under `defaultCollectionName`. To switch the active collection, you add custom code to your Compute app that calls `publisherServer.setActiveCollectionName(name)`:

```js
publisherServer.setActiveCollectionName("preview-42");
```

Pass `null` to select the default collection.

If the app turns on sandbox reuse, Compute can use a sandbox for more than one request (see [Sandbox lifecycle](https://www.fastly.com/documentation/guides/compute/developer-guides/sandbox-lifecycle/)), and the active collection stays set until you change it. Thus, call `setActiveCollectionName()` for each request, also when the request does not select a collection.

#### Example: Subdomain-based Routing

In the following example, assume that the Compute application is hosted using a wildcard domain `*.example.com`. A request for `preview-pr-123.example.com` would activate the collection `'pr-123'`.

```js
import { PublisherServer, collectionSelector } from '@fastly/compute-js-static-publish';
import rc from '../static-publish.rc.js';

const publisherServer = PublisherServer.fromStaticPublishRc(rc);

addEventListener("fetch", event => {
  const request = event.request;
  const collectionName = collectionSelector.fromHostDomain(request, /^preview-([^\.]*)\./);
  publisherServer.setActiveCollectionName(collectionName); // null selects the default collection

  event.respondWith(publisherServer.serveRequest(request));
});
```

### 👀 Previews: Collection Selection

`collectionSelection` in `static-publish.rc.js` chooses the collection that serves each request, for example to show a preview of a pull request. It is off by default: without it, every request gets the default collection.

```js
const rc = {
  // ...
  collectionSelection: {
    // Tried in order. The first source that gives a collection wins.
    // If no source gives a collection, the default collection is used.
    sources: [
      { type: 'host',   pattern: '{collection}.preview.example.com' },
      { type: 'path',   prefix: '/_preview/{collection}', sticky: 'cookie' },
      { type: 'query',  param: 'collection', sticky: 'cookie' },
      { type: 'cookie', cookieName: 'publisher-collection',
        activatePath: '/activate', resetPath: '/reset', maxAge: 604800 },
      { type: 'header', name: 'x-publisher-collection' },
    ],
    // The collections that can be selected ('*' matches any characters). Default: any.
    allow: ['pr-*', 'staging'],
    // The selected collection does not exist or has expired:
    // 'not-found' (default) gives a 404 response, 'default' serves the default collection.
    onMissing: 'not-found',
    // X-Robots-Tag: noindex on the responses of a selected collection. Default: true.
    noindex: true,
  },
};
```

| Source | Reads | Notes |
|--------|-------|-------|
| `host` | The hostname, matched against `pattern` | Needs a wildcard domain and TLS for it. The pattern has one `{collection}` in one label, with fixed text around it if you want (`branch-{collection}.preview.example.com`). A host label has at most 63 characters. Make sure that your production hostname does not match the pattern. |
| `path` | A path prefix, which is removed before the file lookup | Works on `*.edgecompute.app`. Links that start with `/` lose the prefix, so use it with `sticky: 'cookie'`, or for a site with relative links. The links in HTML do not change. |
| `query` | A query parameter | Only the request that has it. Usually used with `sticky: 'cookie'`. |
| `cookie` | A cookie | Also serves the activate path (`/activate?collection=<name>&redirectTo=<path>`) and the reset path. |
| `header` | A request header | For tests, CI checks, and API clients. |

- `sticky: 'cookie'` on a `path` or `query` source: when the source matches, set the cookie of the `cookie` source, and redirect (`308`) to the URL without the prefix or the parameter. It needs a `cookie` source.
- A name must follow the [collection name rule](#-collections-publish-preview-promote) and match `allow`. Otherwise the source is skipped.
- Redirects go only to a path on the same site. `redirectTo` with another site redirects to `/`.
- The responses of a selected collection (not the default collection) get `X-Robots-Tag: noindex` (unless `noindex` is `false`). They get `Cache-Control: private` if the URL does not name the collection. See [Shared caches](#shared-caches).
- To find out if a selected collection exists, `PublisherServer` reads its index, also when the [response cache](#️-caching-responses-with-the-core-cache) has the response.

The `plain` app does this in `src/index.js`. Apps scaffolded before 8.1.0 do not. To add it to such an app, change `src/index.js`:

```js
const selection = publisherServer.resolveCollection(request);
if (selection.response != null) {
  return selection.response; // a redirect (sticky, activate, reset), or an error
}
const response = await publisherServer.serveRequest(request, {
  collectionName: selection.collectionName, // null: the default collection
  pathname: selection.pathname,             // the path without the prefix of a path source
});
```

To scaffold an app with collection selection, use the [`--collection-selection` flags](#options). To show a link to a collection, for example in CI, use `previewUrl()`. It uses the first source that can make a URL:

```js
import { previewUrl } from '@fastly/compute-js-static-publish';
import rc from './static-publish.rc.js';

previewUrl('pr-42', 'https://example.edgecompute.app', rc.collectionSelection);
// with the sources above: 'https://pr-42.preview.example.com/'
```

> [!WARNING]
> A preview is public to anyone who knows its name. Use `allow` to limit the collections that can be selected, and do not publish content that must stay private.

#### Shared caches

A shared cache, for example a CDN in front of your service, can store a response and give it to other visitors. The [response cache](#️-caching-responses-with-the-core-cache) of `PublisherServer` keeps the responses of each collection apart, so this section is only about shared caches. For a shared cache, the response of a collection that is not the default collection depends on how the request selects the collection:

| Source | Does the URL name the collection? | `Cache-Control` |
|--------|-----------------------------------|-----------------|
| `host`, `path`, `query` | Yes | As for the default collection. A shared cache can store the response. |
| `cookie`, `header` | No: the same URL can serve another collection | `private`. A shared cache does not store the response. |
| `path` or `query` with `sticky: 'cookie'` | No: after the redirect, the cookie selects the collection | `private` |

A response gets `private` also when your code gives `serveRequest()` a `collectionName` that the sources of the request do not select. For a `query` source, the shared cache must keep the query string in its cache key.

**Previews with a cookie or a header:** the default collection and the preview have the same URLs. A shared cache can store a response of the default collection, and give it to a visitor who has the preview cookie. That visitor then sees the default collection in place of the preview. If a shared cache is in front of your service, select previews with a `host` or `path` source.

**More than one site in one service:** you can serve one site from each collection. Select the collection with a `host` source, for example `{collection}.example.com`, so that a shared cache can store the responses of each site. Also set `noindex: false`, because otherwise each site that is not the default collection gets `X-Robots-Tag: noindex`. A collection that expires stops being served, so do not set an expiration time for these collections.

**Without `collectionSelection`:** if your code chooses the collection, for example with `collectionSelector.fromCookie()` and `setActiveCollectionName()`, or with the `collectionName` option, `PublisherServer` does not add `Cache-Control: private` or `X-Robots-Tag: noindex`. Your code must add them when the URL does not name the collection. Otherwise a shared cache can store a preview and give it to other visitors.

`serveRequest()` returns a normal `Response`. To use a different cache policy, change its headers in your code before you return it.

#### A preview for each pull request

A CI job can publish each pull request to its own collection, and remove it when the pull request closes. `--expires-in` stops serving a preview after that time, also if the second job does not run. But its index stays in storage until `clean --delete-expired-collections`, and its files stay until `clean`.

This GitHub Actions workflow publishes the collection `pr-<number>`, and, when the pull request closes, deletes the collection and runs `clean`. It needs the `FASTLY_API_TOKEN` secret (and, for the purge, the `FASTLY_SERVICE_ID` secret).

```yaml
name: Preview
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

# clean must not run while a publish runs, so all jobs that change the same
# storage use one concurrency group. Use the same group in every workflow that
# publishes or cleans, for example the workflow that publishes `live`.
concurrency:
  group: static-publish-storage
  cancel-in-progress: false

jobs:
  publish:
    if: github.event.action != 'closed'
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: compute-js
    env:
      FASTLY_API_TOKEN: ${{ secrets.FASTLY_API_TOKEN }}
      FASTLY_SERVICE_ID: ${{ secrets.FASTLY_SERVICE_ID }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: npm ci
      - run: npx @fastly/compute-js-static-publish publish-content --collection-name=pr-${{ github.event.number }} --expires-in=7d

  remove:
    if: github.event.action == 'closed'
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: compute-js
    env:
      FASTLY_API_TOKEN: ${{ secrets.FASTLY_API_TOKEN }}
      FASTLY_SERVICE_ID: ${{ secrets.FASTLY_SERVICE_ID }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: npm ci
      - run: npx @fastly/compute-js-static-publish collections delete --collection-name=pr-${{ github.event.number }}
      - run: npx @fastly/compute-js-static-publish clean --delete-expired-collections
```

For a pull request that never published, `collections delete` finds no collection and deletes nothing.

### 🔀 Selecting a Collection at Runtime

For previews, use [collection selection](#-previews-collection-selection). To select a collection in your own code, the `collectionSelector` module provides helpers to extract a collection name from different parts of a request:

```js
collectionSelector.fromHostDomain(request, /^preview-([^\.]*)\./);
```

#### From the Request URL

```js
collectionSelector.fromRequestUrl(request, url => url.pathname.split('/')[2]);
```

#### With a Custom Request Matcher

```js
collectionSelector.fromRequest(request, req => req.headers.get('x-collection') ?? 'live');
```

#### From a Cookie

See [fromCookie](#fromcookie) for details on this feature.

```js
const { collectionName, redirectResponse } = collectionSelector.fromCookie(request);
```

#### From a Fastly Config Store

```js
collectionSelector.fromConfigStore('my-config-store', 'collection-key');
```

### 🚀 Promoting a Collection

If you're happy with a preview or staging collection and want to make it live, use the `collections promote` command:

```sh
npx @fastly/compute-js-static-publish collections promote \
  --collection-name=staging
  --to=live
```

This copies all content and server settings from the `staging` collection to `live`.

You can also specify a new expiration:

```sh
npx @fastly/compute-js-static-publish collections promote \
  --collection-name=preview-42 \
  --to=staging \
  --expires-in=7d
```

> [!NOTE]
> The collection denoted by `defaultCollectionName` is exempt from expiration.

## 🛠 Development → Production Workflow

### Using the KV Store

#### Local development

During development, the local development server (`npm run dev:start`) runs against assets loaded into the simulated KV Store provided by the local development environment.

Prior to starting the server, publish the content to the simulated KV Store:

```sh
npm run dev:publish          # 'publish' your files to the simulated local KV Store
npm run dev:start            # preview locally
```

This simulates publishing by writing to `kvstore.json` instead of uploading to the actual KV Store. You can preview your site at `http://127.0.0.1:7676` - no Fastly account or service required.

Note that for local development, you will have to stop and restart the local development server each time you publish updates to your content.

To publish to an alternative collection name, use the following command and then restart the local development server:

```sh
npm run dev:publish -- --collection-name=preview-123
```

#### Production

When you're ready for production:

1. [Create a free Fastly account](https://www.fastly.com/signup/?tier=free) if you haven't already.
2. Run `npm run fastly:deploy`
    - This builds your Compute app into a Wasm binary
    - Deploys it to a new or existing Fastly Compute service
    - If creating a new service:
        - you'll be prompted for backend info - **you can skip this**, as no backend is needed (all content is served from KV)
        - KV Store will be created if necessary and automatically linked to your new service.

Once deployed, publish content like so:

```sh
npm run fastly:publish
```

`fastly:publish` needs a Fastly API token that can write to the KV Store. Set the `FASTLY_API_TOKEN` environment variable, or add `-- --fastly-api-token=<token>`. The command does not read the token of your Fastly CLI profile. If you are logged in with the Fastly CLI, you can give it that token:

```sh
FASTLY_API_TOKEN=$(npx fastly auth token) npm run fastly:publish
```

This:

- Uses the default collection name
- Uploads static files to the KV Store
- Stores server configuration for the collection

> [!TIP]
> Upload to a specific collection by specifying the collection name when publishing content:
> ```sh
> npm run fastly:publish -- --collection-name=preview-42
> ```

**No Wasm redeploy needed** unless you:

- Modify `src/index.js` - such as when you update your custom routing logic (e.g. collection selection) or
- Change `static-publish.rc.js`

If you do need to rebuild and redeploy the Compute app, simply run:

```sh
npm run fastly:deploy
```

### Using S3-compatible storage (BETA)

#### Local development

During development, the local development server (`npm run dev:start`) runs against assets published to S3-compatible storage.

In this mode, the content in the S3-compatible storage can be updated independent of the Compute application running in the local development server.

Before publishing your content, your S3-compatible bucket must already exist.

> [!TIP]
> If you're using Fastly Object Storage, [create your Fastly account](https://www.fastly.com/signup/?tier=free) if you haven't already, and then follow the [Object Storage quick start](https://www.fastly.com/documentation/guides/platform/object-storage/object-storage-quick-start/) to set up your bucket.

Publish your content by typing:

```sh
npm run s3:publish
```

Then start the local development server:

```sh
npm run dev:start
```

#### Production 

When you're ready for production:

1. [Create a free Fastly account](https://www.fastly.com/signup/?tier=free) if you haven't already.
2. Run `npm run fastly:deploy`
   - This builds your Compute app into a Wasm binary
   - Deploys it to a new or existing Fastly Compute service
   - If creating a new service, the Fastly CLI uses the `[setup]` section of `fastly.toml`:
      - It creates the backend `s3_storage`. It prompts you for the hostname and the port of the backend.
        The default values are the hostname of your S3 endpoint and 443. Press Enter to accept them.
      - It creates the Secret Store `S3_CREDENTIALS` and prompts you for the values of
        `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`. Use credentials that can read the bucket.
      - It links the backend and the Secret Store to your new service.
   - If you deploy to an existing service, the Fastly CLI does not use the `[setup]` section.
     Add the backend and the Secret Store to the service yourself, with the same names.

Once deployed, publish content like so:

```sh
npm run s3:publish
```

After the deploy, `fastly.toml` has the service ID, so `s3:publish` also purges the service's cache. For this purge, set `FASTLY_API_TOKEN` (or add `-- --fastly-api-token=<token>`) in addition to the S3 credentials. Without it, `s3:publish` stops with an error before it uploads files.

This:

- Uses the default collection name
- Uploads static files to the S3-compatible bucket
- Stores server configuration for the collection

> [!TIP]
> Upload to a specific collection by specifying the collection name when publishing content:
> ```sh
> npm run s3:publish -- --collection-name=preview-42
> ```

**No Wasm redeploy needed** unless you:

- Modify `src/index.js` - such as when you update your custom routing logic (e.g. collection selection) or  
- Change `static-publish.rc.js`

If you do need to rebuild and redeploy the Compute app, simply run:

```sh
npm run fastly:deploy
```

## 🧹 Cleaning Up

Every time you publish, old files are left behind for safety. **However, files with the same content will be re-used across collections and publishing events.** They are only stored once in the KV Store using their content hash as a key. This ensures that unchanged files aren't duplicated, keeping storage efficient and deduplicated.

Over time, however, collections may expire, old versions of files will be left behind, and some assets in the KV Store will no longer be referenced by any live collection. To avoid bloat, use:

```sh
npm run dev:clean
```
and
```sh
npm run fastly:clean
```

These scripts run against the local and Fastly KV Stores respectively, and run the following command:
```
npx @fastly/compute-js-static-publish clean --delete-expired-collections
```

This removes:

- Expired collection index files (only if `--delete-expired-collections` is passed)
- Unused content blobs (no longer referenced)
- Orphaned server config files

> [!WARNING]
> Do not run `clean` while `publish-content` can run for the same storage. `publish-content` writes the index of a collection after it uploads the files, so `clean` can delete files that the new index then refers to. In CI, put the jobs that publish and the job that cleans in the same `concurrency` group (see [A preview for each pull request](#a-preview-for-each-pull-request)).

### 🔍 Dry Run Mode

Preview what will be deleted without making changes:

```sh
npx @fastly/compute-js-static-publish clean --dry-run
```

> ⚠️ Cleanup never deletes the default collection and never deletes content that’s still in use.

## 🔄 Content Compression

This project supports pre-compressing and serving assets in Brotli and Gzip formats. Compression is controlled at two different stages:

- **During publishing**, the `contentCompression` field in the `publish` section of `publish-content.config.js` defines which compressed variants (e.g., `br`, `gzip`) should be generated and uploaded to storage.

Assets are stored in multiple formats (uncompressed + compressed) if configured. A compressed variant is uploaded and used only if it is smaller than the original. (For very small files, the compressed variant is often larger.) If a variant is already in storage, it is not compressed or uploaded again. Files are compressed in parallel on the Node.js thread pool. By default, the CLI sets `UV_THREADPOOL_SIZE` to the number of CPU cores (minimum 4, maximum 16). To use a different value, set `UV_THREADPOOL_SIZE` yourself. To make compression faster, you can also set a lower `brotliQuality`. The following file types are compressed by default:

- Text-based: `.html`, `.js`, `.css`, `.svg`, `.json`, `.txt`, `.xml`, `.map`
- Certain binary formats: `.bmp`, `.tar`

- **At runtime**, the `allowedEncodings` field in the `server` section of `publish-content.config.js` specifies which compression formats the server is allowed to serve based on the client's `Accept-Encoding` header.

`PublisherServer` will serve the smallest appropriate version based on the `Accept-Encoding` header.

## 🧩 Using PublisherServer in Custom Apps

You can combine PublisherServer with custom logic to support APIs, authentication, redirects, or A/B testing. `PublisherServer` returns `null` when it cannot handle a request, allowing you to chain in your own logic.

```js
import { PublisherServer } from '@fastly/compute-js-static-publish';
import rc from '../static-publish.rc.js';

const publisherServer = PublisherServer.fromStaticPublishRc(rc);

addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const response = await publisherServer.serveRequest(request);
  if (response) {
    return response;
  }

  // Add your custom logic here
  const url = new URL(request.url);
  if (url.pathname === '/api/hello') {
    return new Response(JSON.stringify({ greeting: "hi" }), {
      headers: { 'content-type': 'application/json' }
    });
  }

  return new Response("Not Found", { status: 404 });
}
```

### Options of `serveRequest()`

`serveRequest(request, options)` takes these options. Without options, it works as above.

| Option | Description | Default |
|--------|-------------|---------|
| `collectionName` | The collection to serve, for this call only. `null` selects the default collection. | The active collection (see [Switching the active collection](#switching-the-active-collection)) |
| `pathname` | The path to look up, in place of the path of the request URL. It must be decoded, and it must start with `/`. | The decoded path of the request URL |
| `fallback` | `false`: if no file matches, do not serve the SPA file or the 404 page. Return `null`. | `true` |
| `healthCheck` | `false`: do not answer `/healthz`. | `true` |

`serveRequest()` returns `null` for a method other than `GET` and `HEAD`, and when there is no response (no file matches, and there is no fallback page or `fallback` is `false`). If the default collection has no settings in storage, the response is `500`. A collection other than the default collection that is not published, or that expired, gets a plain-text `404` that names it.

`serveFallback(request, { collectionName })` serves the SPA file (`200`) or the 404 page (`404`) of the collection, as `serveRequest()` does when no file matches. It returns `null` for a method other than `GET` and `HEAD`, for a client that does not accept HTML, or when the collection has no fallback page. Use it with `fallback: false`, to run your own logic between the files and the fallback page:

```js
async function handleRequest(request) {
  const response = await publisherServer.serveRequest(request, { fallback: false });
  if (response) {
    return response;
  }

  const url = new URL(request.url);
  if (url.pathname === '/api/hello') {
    return new Response(JSON.stringify({ greeting: "hi" }), {
      headers: { 'content-type': 'application/json' }
    });
  }

  return (await publisherServer.serveFallback(request)) ?? new Response("Not Found", { status: 404 });
}
```

### ⏱️ Measuring Performance with `Server-Timing`

`PublisherServer` can report how long it spends reading from storage. To turn this on, give it the name of a request header:

```js
publisherServer.setServerTimingRequestHeader('X-Publisher-Server-Timing');
```

A request that has this header gets a [`Server-Timing`](https://www.w3.org/TR/server-timing/) response header. Requests without it are not affected. This is off by default.

```
Server-Timing: settings;dur=12.3, index;dur=40.1, index-body;dur=31.0, index-parse;dur=24.2, asset;dur=11.4
```

| Name | Duration of |
|------|-------------|
| `settings` | Reading and parsing the collection's settings |
| `index` | Reading the collection's index, until the response headers arrive |
| `index-body` | Reading the body of the index |
| `index-parse` | Parsing the index |
| `asset` | Reading the file, until the response headers arrive. Can appear more than one time, one time for each variant that is tried. |
| `cache` | Looking up the response cache, if it is on (see [Caching Responses with the Core Cache](#️-caching-responses-with-the-core-cache)). `desc` is `hit` (with the age of the cached response, for example `hit age=42s`), `miss`, or `bypass`. |

An entry is missing if `PublisherServer` did not read that item for this request, for example because the item is cached in memory, or because the response came from the response cache.

`serveRequest()` starts the measurements for each request. If you call `getMatchingAsset()` and `serveAsset()` directly, call `beginRequest()` first:

```js
publisherServer.beginRequest(request);
const asset = await publisherServer.getMatchingAsset(pathname);
if (asset != null) {
  return publisherServer.serveAsset(request, asset);
}
```

Any client can send the request header. Choose a name that is not easy to guess if you do not want to show these timings to the public.

### 🗄️ Caching Responses with the Core Cache

To serve a file, `PublisherServer` reads the collection's settings, the collection's index, and the file. Fastly can cache these reads, but `PublisherServer` must still parse the index for each request, and the index of a large site is large. To skip this work, `PublisherServer` can cache whole responses with the Fastly [Core Cache](https://www.fastly.com/documentation/guides/concepts/cache/) API:

```js
publisherServer.setResponseCache({ maxAge: 3600 });
```

`maxAge` is in seconds. This is off by default.

`maxBodySize` sets the largest response, in bytes, to cache. The default is 16 MiB (`16 * 1024 * 1024`). A larger response is served from storage each time:

```js
publisherServer.setResponseCache({ maxAge: 3600, maxBodySize: 4 * 1024 * 1024 });
```

- A response is cached by the publish ID, the collection, the path, and the client's `Accept-Encoding`. A cache hit does not read the settings, the index, or the file.
- A path that does not match a file is cached, too, so a missing path does not read the index again.
- With the options of `serveRequest()`, the path in the key is the `pathname` option, and the collection is the `collectionName` option. A response with `fallback: false` has its own key. `serveFallback()` caches one response for each collection, for all paths.
- If several requests miss the same response at the same time, one request produces it, and the others wait for it.
- Only `200` and `404` responses are cached. Conditional requests (`304`) and `HEAD` requests are answered from the cached response.
- Each cached response has the surrogate key `<publishId>-<collectionName>`. After you publish, `publish-content` purges this key (see [`--fastly-service-id`](#publish-content)), so the next request gets the new content.

`serveRequest()` uses the response cache automatically. If you call `getMatchingAsset()` and `serveAsset()` directly, wrap them in `serveCached()`. When a response is not cached yet, `serveCached()` calls your function to produce it, with a `GET` request that has no conditional headers:

```js
publisherServer.beginRequest(request);
const response = await publisherServer.serveCached(request, pathname, async (fillRequest) => {
  const asset = await publisherServer.getMatchingAsset(pathname);
  if (asset == null) {
    return null; // not found; this result is cached, too
  }
  return publisherServer.serveAsset(fillRequest, asset);
});
```

The second argument identifies the response in the collection. If anything other than the path and `Accept-Encoding` changes your response, include it in this value.

Notes:

- A response is read completely before it is cached. The request that caches it uses memory of about two times the body, up to two times `maxBodySize`. A Compute instance has a limit on its memory, so do not set `maxBodySize` larger than 48 MiB (`48 * 1024 * 1024`). Other requests that wait for the same response get it when it is cached.
- A response is cached only if its body has the size in the file's metadata. If storage returns a different body, nothing is cached, the request gets an error, and the next request reads the file again.
- With `--local`, `publish-content` cannot purge the local cache. Restart `fastly compute serve` to see newly published content, or leave the response cache off in local development.
- On staging, a purge must include the `Fastly-Purge-Environment: staging` header to clear the staging cache. Without it, a purge clears only the production cache. Use `publish-content --purge-environment=production,staging` to purge both.

## 🔥 Using Hono

`@fastly/compute-js-static-publish/hono` has middleware for [Hono](https://hono.dev/) apps. It serves the published files with `PublisherServer`, so a Hono app gets all the features of the server: `autoIndex`, `autoExt`, the compressed variants, `304` responses, the [response cache](#️-caching-responses-with-the-core-cache), `Server-Timing`, and [collection selection](#-previews-collection-selection).

### The `hono` template

To scaffold a Hono app, add `--template hono` (in a managed project: `managed.template: 'hono'`):

```sh
npx @fastly/compute-js-static-publish@latest --template hono --root-dir=./public --kv-store-name=site-content
```

The app is TypeScript: `src/index.ts`, with code like the example below, and `tsconfig.json`. Add your own routes in `src/index.ts`. The build (`js-compute-runtime ./src/index.ts`) removes the types, but does not check them. To check the types, run `npx tsc` in the app. The app has `typescript` as a dev dependency.

### Hono extensions

To add your own middleware and routes to the `hono` template, put modules in the extensions folder, `hono-extensions/`. In a managed project, this is the only way to add code, because the CLI generates the app. In an ejected app, you can also edit `src/index.ts`.

`scaffold --template hono` makes the folder next to the project file (managed) or next to `compute-js/` (ejected). To make it later, or to update it, run:

```sh
npx @fastly/compute-js-static-publish template init
```

```
hono-extensions/
├── package.json        # Your dependencies, and the peer dependencies on the packages that the app provides
├── tsconfig.json       # For your editor
├── 10-auth.ts          # A module
├── api.ts              # A module
├── _example.ts         # An example, not a module (the name starts with _)
└── lib/                # Your helpers (not modules)
```

- **Modules** are the files directly in the folder, with the extension `.ts`, `.mts`, `.js`, or `.mjs`. Files that start with `_` or `.`, and `.d.ts` files, are not modules. The build does not look in subfolders, so use them, for example `lib/`, for your helpers.
- **The name** of a module is the file name without the number prefix and the extension: `10-auth.ts` is `auth`. Two modules with the same name are an error.
- **The phases:** a module adds its handlers to the app in one or more phases. The app runs the phases in this order, and in each phase the modules in the order of the file names (add a number prefix to set the order):

  ```
  selectCollection() → middleware → beforeFiles → serveStatic() → afterFiles → serveFallback()
  ```

  - `middleware`: before all other phases. All modules add their middleware before any module adds its routes, so a middleware such as a login check also applies to the routes of the other modules.
  - `beforeFiles`: before the published files.
  - `afterFiles`: after the published files. These handlers get only the requests that no published file matches, for example to make a page for a path that has no file, before the 404 page. The published files are served only for `GET` and `HEAD`, so these handlers also get all other methods.

A module default-exports `defineExtension()`. Give it a function for each phase that the module uses. Each function gets the Hono app and the options of the module, and adds handlers with `app.use()`, `app.get()`, `app.post()`, and the other methods of Hono. With only a function in place of the object, the function is the `middleware` phase:

```ts
// hono-extensions/10-header.ts
import { defineExtension } from '@fastly/compute-js-static-publish/hono';

export default defineExtension((app, options?: { value?: string }) => {
  app.use('*', async (c, next) => {
    await next();
    c.header('x-site', options?.value ?? 'default');
  });
});
```

```ts
// hono-extensions/api.ts
import { defineExtension } from '@fastly/compute-js-static-publish/hono';

export default defineExtension({ bindings: { config: 'ConfigStore:site_config' } }, {
  middleware: (app) => {
    app.use('/api/*', async (c, next) => {
      await next();
      c.header('cache-control', 'no-store');
    });
  },
  beforeFiles: (app) => {
    app.get('/api/greeting', async (c) => c.json({ greeting: await c.env.config?.get('greeting') }));
  },
  afterFiles: (app) => {
    app.get('/blog/:slug', (c) => c.redirect(`/archive/${c.req.param('slug')}/`, 301));
  },
});
```

**Options** come from `templateOptions.hono.extensions` in the project file (or in `static-publish.rc.js`), with the name of the module as the key. Each phase of a module gets the same options. The build shows a warning for options of a module that does not exist:

```js
templateOptions: {
  hono: {
    bindings: { config: 'ConfigStore:site_config' },
    extensions: { header: { value: 'my-site' } },
  },
},
```

**Bindings** put Fastly resources on `c.env`, as `buildFire()` of `@fastly/hono-fastly-compute` does. A module declares the bindings that it uses in the first argument of `defineExtension()`, and `c.env` in its handlers has their types, for example `ConfigStore | undefined` for `'ConfigStore:site_config'` (`undefined` if the resource does not exist or is not linked to the service). `templateOptions.hono.bindings` adds bindings for the app. The same name with the same resource in two places is allowed. The same name with two different resources stops the build, and the message names both places. `c.var` is not typed in a module, so that a module can set its own variables.

**Errors** in a module stop the build, and the message names the file: a default export that is not `defineExtension()`, an object with no phase, a key that is not a phase, or a phase that is not a function.

**The build** bundles the modules into `src/hono-extensions.generated.js` of the app (the `prebuild` [template hook](#-template-hooks)). The packages that the app provides stay imports, so that the app has one copy of each: the dependencies of the app (for example `hono` and `@fastly/hono-fastly-compute`), this package, and `fastly:*`. Thus, do not install them in the folder. `template init` writes them as peer dependencies in `hono-extensions/package.json`, with the versions that the app has. Install other packages in the folder (`npm install` in `hono-extensions/`), and the build bundles them.

- `build.hono.extensionsDir` sets another folder, relative to the project file (or to `static-publish.rc.js`). The default is `./hono-extensions`.
- Without the folder, or without modules, the app has no extensions. `dev` and `deploy` of a managed project then show how to make the folder.
- In a managed project, the files of the folder (without `node_modules/`) are part of the fingerprint, so a change to a module makes `deploy` deploy again.
- Keep the code of the extensions in the folder. A module can import a file from outside the folder, and the build bundles it, but a change to that file does not change the fingerprint, and the watcher does not see it.

**`template init`** makes the folder with `package.json`, `tsconfig.json`, and the example. In a folder that exists, it updates only the peer dependencies, and adds the starter files that are missing. It never changes your modules. `--reset` writes the starter files again (it asks first, or needs `--force` with `--non-interactive`). `--check` changes nothing, and fails with `template-init-needed` if the folder is out of date, for example after an upgrade of this package; use it in CI.

**Watch:** `dev -- --watch` (managed) and `npm run dev:watch` (ejected) also watch the extensions folder, also if it does not exist yet. A change in the folder bundles the modules again, and then the Fastly CLI builds and restarts the app. If a module has an error, the watcher shows it and the app keeps the last modules that built.

**Examples** in [`examples/hono/`](https://github.com/fastly/compute-js-static-publish/tree/main/examples/hono) show complete extensions. They are not part of the npm package, and you cannot scaffold an app with them: for a new project, copy the `hono-extensions/` folder of an example into your project, and set it up as the README of the example shows. The README also shows how to add an example to a project that exists.

- [`grip`](https://github.com/fastly/compute-js-static-publish/tree/main/examples/hono/grip): realtime streams and Server-Sent Events with Fastly Fanout, and a publish endpoint with a shared key. One module with two phases: the `middleware` phase hands off only `/events/*` to Fanout, and the `beforeFiles` phase has the endpoints.
- [`oauth`](https://github.com/fastly/compute-js-static-publish/tree/main/examples/hono/oauth): a login with GitHub or Google in front of some paths of the site (`protect`), with a signed session cookie.

Each example takes its secrets from a Secret Store. For `dev`, `managed.fastlyToml` adds a local Secret Store that reads environment variables.

### Hono in your own app

Add `hono` and `@fastly/hono-fastly-compute` to your app:

```sh
npm install hono @fastly/hono-fastly-compute
```

Then serve the files from your Hono app. Add your own routes before `serveStatic()` or after it:

```js
import { Hono } from 'hono';
import { fire } from '@fastly/hono-fastly-compute';
import { fromStaticPublishRc } from '@fastly/compute-js-static-publish/hono';
import rc from '../static-publish.rc.js';

const { serveStatic, serveFallback, selectCollection } = fromStaticPublishRc(rc);

const app = new Hono();

// Select the collection of each request with collectionSelection in
// static-publish.rc.js, for example for previews.
app.use('*', selectCollection());

app.get('/api/hello', (c) => c.json({ hello: 'world' }));

// Serve the published files. If no file matches, the request goes to the next handler.
app.use('*', serveStatic());

// When nothing matches, serve the SPA file or the 404 page.
app.notFound(serveFallback());

fire(app);
```

`fire()` from [`@fastly/hono-fastly-compute`](https://hono.dev/docs/getting-started/fastly) runs the app on Fastly Compute. Use version 0.4.0 or later with `@fastly/js-compute` v4. To use a KV Store, a Config Store, or other resources from `c.env`, use `buildFire()` with bindings. Do not use `hono/service-worker`: by default, it sends each 404 response to `fetch()`, and Compute has no default backend.

`fromStaticPublishRc(rc)` returns:

- `serveStatic(options?)`: middleware that serves the file that matches the request. If no file matches, or the method is not `GET` or `HEAD`, it calls the next handler, so a route after it gets the request. It does not serve the SPA file or the 404 page, and it does not answer `/healthz`.
- `serveFallback(options?)`: for `app.notFound()`. It serves the SPA file or the 404 page. If there is neither, or the client does not accept HTML, it gives Hono's default 404 response.
- `selectCollection()`: middleware that selects the collection of each request with the [`collectionSelection`](#-previews-collection-selection) of `static-publish.rc.js`. It returns the redirects of the selection (a `sticky` source, and the activate and reset paths of the `cookie` source), and sets `c.var.staticPublisher`. Then `serveStatic()` and `serveFallback()` use the selected collection. For a `path` source, `serveStatic()` looks up the path without the prefix.
- `publisherServer`: the `PublisherServer`, to configure it. For example, `publisherServer.setResponseCache({ maxAge: 3600 })`.

If you make the `PublisherServer` yourself, use `fromPublisherServer(publisherServer)` in place of `fromStaticPublishRc(rc)`.

`serveStatic()` takes options like the `serveStatic()` of Hono:

| Option | Description |
|---|---|
| `root` | The directory that request paths are relative to, in the published files (after `publicDirPrefix`, if it is set). The default is `./`. A path that resolves outside `root` is not served. |
| `path` | The path to serve, in place of the request path. For example, `./favicon.ico`. |
| `rewriteRequestPath` | `(path, c) => string`. Changes the request path before it is resolved against `root`. |
| `collectionName` | The collection: a string, `null` for the default collection, or `(c) => string \| null \| undefined`. Without it, or if the function returns `undefined`, the collection is the one that `selectCollection()` selected, or else the active collection. |

For example, to serve `/assets/*` from the `static` directory:

```js
app.use('/assets/*', serveStatic({ root: './static', rewriteRequestPath: (path) => path.replace(/^\/assets/, '') }));
```

`serveFallback()` takes the `collectionName` option, too. To give a default to all the middleware, pass it to `fromStaticPublishRc(rc, { collectionName })`. An option in a call replaces the default.

In TypeScript, use `StaticPublisherVariables` for the variables of the app, so that `c.var.staticPublisher` has a type:

```ts
import { fromStaticPublishRc, type StaticPublisherVariables } from '@fastly/compute-js-static-publish/hono';

const app = new Hono<{ Variables: StaticPublisherVariables }>();
app.get('/api/collection', (c) => c.json({ collection: c.var.staticPublisher.collectionName }));
```

The middleware imports only types from `hono`, so it does not add `hono` to your bundle. `hono` (v4) is an optional peer dependency of this package.

To move from `@fastly/hono-compute-js-static-publish`, see [MIGRATING.md](./MIGRATING.md).

## 📥 Using Published Assets in Your Code

To access files you've published, use the `getMatchingAsset()` and `loadAssetVariant()` methods on `publisherServer`.

### Access Metadata for a File:

```js
const asset = await publisherServer.getMatchingAsset('/index.html');
if (asset != null) {
  // Asset exists with that path
  asset.contentType;      // e.g., 'text/html'
  asset.lastModifiedTime; // Unix timestamp
  asset.size;             // Size in bytes of the base version
  asset.hash;             // SHA256 hash of base version
  asset.variants;         // Available variants (e.g., ['gzip'])
}
```

`getMatchingAsset(key, options)` takes these options:

- `applyAuto` - Also try `autoExt` and `autoIndex`, as for a request (default: `false`). The second argument can also be a boolean, the value of `applyAuto`.
- `includeHidden` - Also find [hidden files](#hidden-files) (default: `false`).

```js
const template = await publisherServer.getMatchingAsset('/templates/email.html', { includeHidden: true });
```

`getAssetEntryMap()` returns the whole index. The key of a hidden file in it is `hidden:` and then the asset key, for example `hidden:/404.html`.

### Load the File from KV Store:

```js
const assetVariant = await publisherServer.loadAssetVariant(asset, null); // pass 'gzip' or 'br' for compressed

assetVariant.storageEntry;      // Storage entry (type StorageEntry defined in './src/storage/storage-provider.ts')
assetVariant.size;              // Size of the variant
assetVariant.hash;              // SHA256 of the variant
assetVariant.contentEncoding;   // 'gzip', 'br', or null
assetVariant.numChunks;         // Number of chunks (for large files)
```

You can stream `assetVariant.storageEntry.body` directly to a `Response`, or read it using `.text()`, `.json()`, or `.arrayBuffer()` depending on its content type.

---

## 📚 CLI Reference

### Available Commands

#### Outside a Compute App Directory
- `npx @fastly/compute-js-static-publish@latest [options]` - Scaffold a new Compute app

#### Inside a Compute App Directory
- `publish-content` - Publish static files to storage (KV Store or S3-compatible storage) under a named collection
- `clean` - Delete expired and unreferenced entries in storage
- `collections list` - List all published collections
- `collections delete` - Delete a specific collection index
- `collections promote` - Copy a collection to another name
- `collections update-expiration` - Modify expiration time for an existing collection

### 🤖 Using the CLI in CI

These rules are for tools that run the CLI with no person present, for example a GitHub Actions workflow. They are part of the contract of the CLI: a change that breaks them comes only in a major release.

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0` | Success. Also when there is nothing to do, for example when you publish the same content again, promote to a collection again, or delete a collection that does not exist. A failed purge after a successful publish is only a warning (see `purge.ok` in the JSON). |
| `1` | The operation failed, for example storage cannot be reached, or the deploy failed. A retry can help. |
| `2` | A usage or config error, for example an unknown option, a missing option, a collection name that breaks the rule, or a config file that cannot be loaded. A retry cannot help. |

**`--json`:** `publish-content`, `collections list`, `collections delete`, `collections promote`, `status`, `deploy` (in a managed project), and `--version` can write their result as one JSON object to stdout, at the end. All log lines then go to stderr, so that they still show in the CI log. With another command, `--json` is an error (`json-not-supported`).

```sh
npx @fastly/compute-js-static-publish publish-content \
  --project-dir=./compute-js --collection-name=pr-42 --json > result.json
```

Each object has `schemaVersion` (now `1`). A new field keeps the version. A field is removed or changed only in a major release, with a new `schemaVersion`.

`publish-content --json`:

```json
{
  "schemaVersion": 1,
  "collection": "pr-42",
  "publishId": "default",
  "files": { "total": 352, "hidden": 2 },
  "storageItems": { "uploaded": 12, "reused": 340 },
  "expiresAt": "2026-12-01T00:00:00.000Z",
  "purge": {
    "ok": true,
    "serviceId": "SERVICE_ID",
    "environments": [ { "environment": "production", "result": "purged" } ]
  }
}
```

- `files` counts the files in the index. `storageItems` counts the items in storage: each file, and each compressed variant that is kept. Thus `storageItems.uploaded` can be larger than `files.total`.
- `expiresAt` is `null` if the collection does not expire.
- `purge` is `null` if there was no purge (`--local`, or no Service ID). `purge.ok` is `false` if a purge failed. Then the visitors can get the old content from the cache until it expires. Each item of `environments` has a `result`: `purged`, `not-staged` (a `staging` purge, and the service has no staged version), or `failed` (with a `reason`).

`collections list --json`:

```json
{
  "schemaVersion": 1,
  "publishId": "default",
  "defaultCollection": "live",
  "collections": [
    {
      "name": "live", "isDefault": true,
      "publishedAt": "2026-11-01T00:00:00.000Z", "expiresAt": null, "expired": false,
      "requires": [ "hidden" ], "unsupported": [], "files": 352, "hidden": 2
    }
  ]
}
```

`collections delete --json`. `deleted` is `false` with `"reason": "not-found"` if the collection does not exist (also exit `0`). `purge` is as in `publish-content`:

```json
{ "schemaVersion": 1, "collection": "pr-42", "publishId": "default", "deleted": true, "purge": null }
```

`collections promote --json`. `expiresAt` is the expiration time of the target after the promote, or `null`:

```json
{ "schemaVersion": 1, "from": "staging", "to": "live", "publishId": "default", "expiresAt": null }
```

`status --json` in a managed project. `needsDeploy` is `null` if it is not known (no API token):

```json
{
  "schemaVersion": 1,
  "mode": "managed",
  "serviceId": "SERVICE_ID",
  "staticPublishVersion": { "recorded": "8.1.0", "running": "8.1.0", "check": "same" },
  "fingerprint": { "current": "3f…", "deployed": "3f…", "deployedStaticPublishVersion": "8.1.0" },
  "activeVersion": 12,
  "domain": "example.edgecompute.app",
  "needsDeploy": false,
  "reasons": [],
  "previewUrls": [ { "type": "query", "url": "https://example.edgecompute.app/?collection={collection}" } ],
  "template": {
    "name": "hono",
    "provides": {
      "@fastly/hono-fastly-compute": "0.4.0",
      "@fastly/js-compute": "4.0.0",
      "hono": "4.13.14",
      "@fastly/compute-js-static-publish": "8.1.0"
    }
  }
}
```

`template.provides` lists the packages that the app of the template provides to the folder of the template (for example `hono-extensions/`), with their versions.

In an ejected app, `status --json` gives `{ "schemaVersion": 1, "mode": "ejected", "serviceId": "SERVICE_ID" }`.

`deploy --json`. `deployed` is `false` with `"reason": "up-to-date"` if the active version already has this app:

```json
{
  "schemaVersion": 1,
  "deployed": true,
  "serviceId": "SERVICE_ID",
  "version": 13,
  "domain": "example.edgecompute.app",
  "fingerprint": "3f…",
  "staticPublishVersion": "8.1.0"
}
```

`--version --json` gives `{ "schemaVersion": 1, "version": "8.1.0" }`.

**Errors:** with `--json`, stdout has one object, `{ "schemaVersion": 1, "error": { "code": "…", "message": "…" } }`. The error also goes to stderr. `message` is for people and can change. `code` is one of these values. A script can use it:

| Code | Exit code | Meaning |
|------|-----------|---------|
| `usage` | `2` | An unknown command or option, or a missing or incorrect option value |
| `config-invalid` | `2` | `static-publish.rc.js`, `static-publish.project.js`, or `publish-content.config.js` cannot be loaded, or is not valid |
| `collection-name-invalid` | `2` | A collection name breaks the [rule](#-collections-publish-preview-promote) |
| `collection-not-found` | `2` | The command needs a collection that does not exist |
| `project-dir-not-found` | `2` | `--project-dir` is not a directory, or has no config file |
| `json-not-supported` | `2` | `--json` with a command that does not support it |
| `credentials-missing` | `2` | An API token or S3 credentials are necessary, but not given |
| `version-mismatch` | `2` | `managed.staticPublishVersion` is not the version of the CLI that runs |
| `first-deploy-manual` | `2` | The first deploy of a managed project with S3 storage, with `--non-interactive` |
| `version-not-published` | `2` | `eject` needs a version of this package that is on npm |
| `template-init-needed` | `2` | `template init --check`: the folder of the template (for example `hono-extensions/`) is out of date. Run `template init` |
| `deploy-failed` | `1` | The build or the deploy of the app failed |
| `failed` | `1` | The operation failed, for example storage cannot be reached |

New codes can come in a minor release. Treat a code that you do not know by its exit code.

**Secrets:** give the Fastly API token in `FASTLY_API_TOKEN`, and S3 credentials in `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`. The CLI replaces the values of the token and the S3 secret access key with `[REDACTED]` in its output, also in errors and in the JSON.

### 🛠 App Scaffolding

Run outside an existing Compute app directory:

#### Minimum required options

```sh
# Using KV store storage
npx @fastly/compute-js-static-publish@latest \
  --root-dir=./public \
  --kv-store-name=<site-content>

# Using S3 storage (BETA)
npx @fastly/compute-js-static-publish@latest \
  --root-dir=./public \
  --storage-mode=s3 \
  --s3-region=<s3 region> \
  --s3-bucket=<bucket name> \
  [--s3-endpoint=<endpoint>]
```

#### Full options list

```sh
npx @fastly/compute-js-static-publish@latest \
  --root-dir=./public \
  { [--storage-mode=kv-store] --kv-store-name=<site-content> | \
    --storage-mode=s3 --s3-region=<s3 region> --s3-bucket=<bucket name> [--s3-endpoint=<endpoint>] } \
  [--output=./compute-js] \
  [--static-publisher-working-dir=<output>/static-publisher] \
  [--publish-id=<prefix>] \
  [--default-collection-name=live] \
  [--template=plain|hono] \
  [--static-dir=./public/static] \
  [--spa=./public/spa.html] \
  [--not-found-page=./public/404.html] \
  [--auto-index=index.html,index.htm] \
  [--auto-ext=.html,.htm] \
  [--name=my-site] \
  [--description='My Compute static site'] \
  [--author='you@example.com'] \
  [--service-id=your-fastly-service-id]
```

#### Options:

**Used to generate the Compute app:**
- `--storage-mode`: Specifies the storage mode. Must be either `kv-store` or `s3` (default: `kv-store`).

   If `--storage-mode=kv-store`:
   - `--kv-store-name`: Required. Name of KV Store to use.

   If `--storage-mode=s3`:
   - `--s3-region`: Required. Region of the S3-compatible bucket.
   - `--s3-bucket`: Required. Name of the S3-compatible bucket.
   - `--s3-endpoint`: Optional. Custom endpoint of the S3-compatible bucket, if necessary.

- `--output`: Compute app destination (default: `./compute-js`)
- `--static-publisher-working-dir`: Directory to hold working files (default: `<output>/static-publisher`).
- `--name`: Application name to insert into `fastly.toml`
- `--description`: Application description to insert into `fastly.toml`
- `--author`: Author to insert into `fastly.toml`
- `--service-id`: Optional existing Fastly Compute service ID
- `--template`: The template of the app's code (default: `plain`). `plain` is a JavaScript app that calls `PublisherServer.serveRequest()` from a fetch event listener. `hono` is a TypeScript [Hono](https://hono.dev/) app (see [Using Hono](#-using-hono)).
- `--managed`: Write only `static-publish.project.js` (a [managed project](#managed-projects)) in the current directory, in place of the app. `--output` is not used.

**Used in building config files:**
- `--root-dir`: Required. Directory of static site content.
- `--publish-id`: Optional key prefix for KV entries (default: `'default'`).
- `--default-collection-name`: The collection to serve when no collection is selected (default: `'live'`).
- `--public-dir`: **Deprecated.** A future version will remove it. Public files base directory, under `--root-dir` (default: same as `--root-dir`). Files that are under `--root-dir` but not under `--public-dir` are published, but requests cannot get them.
- `--static-dir`: One or more directories to serve with long cache TTLs.
- `--spa`: SPA fallback file path, from the current directory (e.g., `./public/spa.html`). The file must exist under `--root-dir`.
- `--not-found-page`: 404 fallback file path, from the current directory (e.g., `./public/404.html`). The file must exist under `--root-dir`. If you do not set it, the scaffolder uses `404.html` in `--root-dir` if that file exists.
- `--auto-index`: List of filenames to use as index files.
- `--auto-ext`: Extensions to try when resolving URLs.

**Collection selection** (written as `collectionSelection` in `static-publish.rc.js`; see [Previews: Collection Selection](#-previews-collection-selection)):
- `--collection-selection`: A source. Can be repeated; the sources are tried in the order of the flags.
   - `host:<pattern>`, for example `host:{collection}.preview.example.com`
   - `path:<prefix>[,sticky]`, for example `path:/_preview/{collection},sticky`
   - `query:<param>[,sticky]`, for example `query:collection,sticky`
   - `cookie[:<cookieName>][,maxAge=<seconds>][,activatePath=<path>][,resetPath=<path>]`
   - `header:<name>`, for example `header:x-publisher-collection`
- `--collection-allow`: The collections that can be selected, for example `pr-*,staging`.
- `--collection-on-missing`: `not-found` (default) or `default`.
- `--collection-noindex`: `true` (default) or `false`.

### 🚀 Inside a Compute App Directory

Once you're in the scaffolded Compute app directory (with `static-publish.rc.js` present), you can run these subcommands.

To run a subcommand from another directory, for example the root of your repo in CI, give the app directory with `--project-dir`:

```sh
npx @fastly/compute-js-static-publish publish-content \
  --project-dir=./compute-js \
  --collection-name=staging
```

With `--project-dir`, all relative paths are relative to that directory: the paths in `static-publish.rc.js` and `publish-content.config.js`, and also the paths in the other options (for example `--config` and `--root-dir`). The directory must have a `static-publish.rc.js` (an app) or a `static-publish.project.js` (a [managed project](#managed-projects)). To scaffold an app in another directory, use `--output`.

To print the version of this package, run `npx @fastly/compute-js-static-publish --version`. It works in any directory.

With `--non-interactive`, or when the `CI` environment variable is set, the CLI never asks for input: missing input is an error. `deploy` then also runs the Fastly CLI with `--non-interactive`. The output never shows the values of `--fastly-api-token`, `--s3-secret-access-key`, `FASTLY_API_TOKEN`, and `S3_SECRET_ACCESS_KEY`.

For `--json`, the exit codes, and the error codes, see [Using the CLI in CI](#-using-the-cli-in-ci).

#### `publish-content`

```sh
npx @fastly/compute-js-static-publish publish-content \
  [--root-dir=./public] \
  [--collection-name=preview-42] \
  [--config=./publish-content.config.js] \
  [--expires-in=7d | --expires-at=2025-05-01T12:00Z | --expires-never] \
  [--overwrite-existing] \
  [--brotli-quality=<0-11>] \
  [--local] \
  [--fastly-api-token=...] \
  [--fastly-service-id=...] \
  [--purge-environment=production,staging] \
  [--s3-access-key-id=... --s3-secret-access-key=...] \
  [--verbose]
```

Publishes static files from your local root directory into a named collection, in the storage that `static-publish.rc.js` specifies: the Fastly KV Store, S3-compatible storage (BETA), or a local dev directory (`--local`, KV Store mode only).

Before it scans your files, the command lists the files that are already in storage. Files that already exist with the same hash are not compressed or uploaded again. With the KV Store, a file larger than 20 MiB is stored in chunks, and the command uploads a chunk again if the chunk in storage does not have the correct size. Then the command uploads the remaining files in batches.

After this process is complete, the PublisherServer object in the Compute application will see the updated index of files and updated server settings from the `publish-content.config.js` file.

##### Options:

- `--collection-name`: Name of the collection to create/update (default: value in `static-publish.rc.js`)
- `--config`: Path to a config file to configure server behavior for this collection (default: `./publish-content.config.js`)
- `--root-dir`: Source directory to read files from (overrides value in `publish-content.config.js`)
- `--overwrite-existing`: Always upload all files, even if they are already in storage. `--kv-overwrite` is an alias.
- `--brotli-quality`: Brotli quality for the `br` variants, an integer from 0 to 11. Overrides `brotliQuality` in `publish-content.config.js`. This is useful in CI, where the config file is generated at each run.
- `--fastly-service-id`: The Fastly Service ID to purge after publishing. The command purges the surrogate key `<publishId>-<collectionName>`, so that the service stops serving cached copies of the collection's settings, index, files, and responses (see [response cache](#️-caching-responses-with-the-core-cache)). If not set, the tool will check:
   - **`FASTLY_SERVICE_ID` environment variable**
   - `service_id` in `fastly.toml`

  If none is found, the command skips the purge. The purge also needs an API token (see `--fastly-api-token`). With `--local`, there is no purge. If the purge fails, the command shows a warning and completes, because the content is already published.
- `--purge-environment`: The environments to purge: `production` (the default), `staging`, or both, as a comma-separated list (`--purge-environment=production,staging`). You can also repeat the option. Purge `staging` if you test the collection on a [staged service version](https://www.fastly.com/documentation/guides/getting-started/services/working-with-staging/), because a purge without it does not clear the staging cache. If the service has no staged version, there is nothing to purge in `staging`. The API then gives the same error as for a service ID that is not correct, so the command shows a message for both causes, not a warning.
- `--verbose`: Verbose mode. When enabled, the command logs a line for each file that the command scans, and for each upload. Without this option, the command logs the progress after each 1,000 files or uploads.

**Expiration:**

- `--expires-in`: Time-to-live from now (e.g. `1h`, `2d`, `1w`)
- `--expires-at`: Absolute expiration time (ISO format: `2025-05-01T12:00Z`)
- `--expires-never`: Collection never expires

*At most one of **`--expires-in`**, **`--expires-at`**, or **`--expires-never`** may be specified*

**KV Store Options:**

- `--local`: Instead of working with the Fastly KV Store, operate on local files that will be used to simulate the KV Store with the local development environment. KV Store mode only. In S3 mode, `--local` is an error, because there is no local simulation of S3 storage.

- `--fastly-api-token`: API token to use when publishing. If not set, the tool uses the **`FASTLY_API_TOKEN` environment variable**.

**S3 Storage Options (BETA):**

- `--s3-access-key-id`, `--s3-secret-access-key`: Access key ID and secret access key for S3-compatible storage. If not set, the tool will check the `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` environment variables.
- `--s3-upload-concurrency`: Number of objects to upload at the same time, from 1 to 256 (default: 64). Each upload keeps its file in memory, so a site with many large files can need a lower value.

#### `clean`

```sh
npx @fastly/compute-js-static-publish clean \
  [--delete-expired-collections] \
  [--dry-run]
```

Cleans up expired or unreferenced items in storage (KV Store or S3-compatible storage).
This can include expired collection indexes and orphaned content assets.

##### Options:

- `--delete-expired-collections`: If set, expired collection index files will be deleted.
- `--dry-run`: Show what would be deleted without performing any deletions.

**KV Store Options:**

- `--local`: Instead of working with the Fastly KV Store, operate on local files that will be used to simulate the KV Store with the local development environment. KV Store mode only. In S3 mode, `--local` is an error, because there is no local simulation of S3 storage.

- `--fastly-api-token`: API token to use when publishing. If not set, the tool uses the **`FASTLY_API_TOKEN` environment variable**.

**S3 Storage Options (BETA):**

- `--s3-access-key-id`, `--s3-secret-access-key`: Access key ID and secret access key for S3-compatible storage. If not set, the tool will check the `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` environment variables.

#### `collections list`

```sh
npx @fastly/compute-js-static-publish collections list
```
Lists all collections currently published in storage.

##### Options:

**KV Store Options:**

- `--local`: Instead of working with the Fastly KV Store, operate on local files that will be used to simulate the KV Store with the local development environment. KV Store mode only. In S3 mode, `--local` is an error, because there is no local simulation of S3 storage.

- `--fastly-api-token`: API token to use when publishing. If not set, the tool uses the **`FASTLY_API_TOKEN` environment variable**.

**S3 Storage Options (BETA):**

- `--s3-access-key-id`, `--s3-secret-access-key`: Access key ID and secret access key for S3-compatible storage. If not set, the tool will check the `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` environment variables.

#### `collections promote`

```sh
npx @fastly/compute-js-static-publish collections promote \
  --collection-name=preview-42 \
  --to=live \
  [--expires-in=7d | --expires-at=2025-06-01T00:00Z | --expires-never]
```
Copies an existing collection (content + config) to a new collection name.

##### Options:

- `--collection-name`: The name of the source collection to promote (required)
- `--to`: The name of the new (target) collection to create or overwrite (required)

**Expiration:**

- `--expires-in`: Time-to-live from now (e.g. `1h`, `2d`, `1w`)
- `--expires-at`: Absolute expiration time (ISO format)
- `--expires-never`: Collection never expires

*At most one of **`--expires-in`**, **`--expires-at`**, or **`--expires-never`** may be specified*. If not provided, then the existing expiration rule of the collection being promoted is used. 

**KV Store Options:**

- `--local`: Instead of working with the Fastly KV Store, operate on local files that will be used to simulate the KV Store with the local development environment. KV Store mode only. In S3 mode, `--local` is an error, because there is no local simulation of S3 storage.

- `--fastly-api-token`: API token to use when publishing. If not set, the tool uses the **`FASTLY_API_TOKEN` environment variable**.

**S3 Storage Options (BETA):**

- `--s3-access-key-id`, `--s3-secret-access-key`: Access key ID and secret access key for S3-compatible storage. If not set, the tool will check the `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` environment variables.

#### `collections update-expiration`

```sh
npx @fastly/compute-js-static-publish collections update-expiration \
  --collection-name=preview-42 \
  --expires-in=3d | --expires-at=2025-06-01T00:00Z | --expires-never
```
Sets or updates the expiration time of an existing collection.

##### Options:
- `--collection-name`: The name of the collection to update (required)

**Expiration:**

- `--expires-in`: Time-to-live from now (e.g. `1h`, `2d`, `1w`)
- `--expires-at`: Absolute expiration time (ISO format)
- `--expires-never`: Collection never expires

*Exactly one of **`--expires-in`**, **`--expires-at`**, or **`--expires-never`** must be specified*

**KV Store Options:**

- `--local`: Instead of working with the Fastly KV Store, operate on local files that will be used to simulate the KV Store with the local development environment. KV Store mode only. In S3 mode, `--local` is an error, because there is no local simulation of S3 storage.

- `--fastly-api-token`: API token to use when publishing. If not set, the tool uses the **`FASTLY_API_TOKEN` environment variable**.

**S3 Storage Options (BETA):**

- `--s3-access-key-id`, `--s3-secret-access-key`: Access key ID and secret access key for S3-compatible storage. If not set, the tool will check the `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` environment variables.

#### `collections delete`

```sh
npx @fastly/compute-js-static-publish collections delete \
  --collection-name=preview-42
```

Deletes a collection index from storage. The content files will remain as they may still be referenced by other collection indexes.

Use the `npx @fastly/compute-js-static-publish clean` command afterward to remove content files that are no longer referenced by any collection.

If a Service ID is found, the command then purges the surrogate key `<publishId>-<collectionName>`, so that the service stops serving cached responses of the deleted collection. This uses the same options as [`publish-content`](#publish-content).

##### Options:

- `--collection-name`: The name of the collection to delete (required)

- `--fastly-service-id`: The Fastly Service ID to purge after deleting. If not set, the tool checks the `FASTLY_SERVICE_ID` environment variable, then `service_id` in `fastly.toml`. If none is found, the command skips the purge. The purge also needs an API token (see `--fastly-api-token`). With `--local`, there is no purge. If the purge fails, the command shows a warning and completes, because the collection is already deleted.

- `--purge-environment`: The environments to purge: `production` (the default), `staging`, or both, as a comma-separated list. You can also repeat the option.

**KV Store Options:**

- `--local`: Instead of working with the Fastly KV Store, operate on local files that will be used to simulate the KV Store with the local development environment. KV Store mode only. In S3 mode, `--local` is an error, because there is no local simulation of S3 storage.

- `--fastly-api-token`: API token to use when publishing. If not set, the tool uses the **`FASTLY_API_TOKEN` environment variable**.

**S3 Storage Options (BETA):**

- `--s3-access-key-id`, `--s3-secret-access-key`: Access key ID and secret access key for S3-compatible storage. If not set, the tool will check the `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` environment variables.

---

## 📕 Appendix

### fromCookie

`collectionSelector.fromCookie` is a utility function that enables the use of a browser
cookie to select the active collection.

```js
import { collectionSelector } from '@fastly/compute-js-static-publish';

const { collectionName, redirectResponse } =
  collectionSelector.fromCookie(request, {
    // Everything here is optional – these are just examples
    cookieName:      'publisher-collection', // default
    activatePath:    '/activate',            // default
    resetPath:       '/reset',               // default
    cookieHttpOnly:  true,                   // default
    cookieMaxAge:    60 * 60 * 24 * 7,       // 7-days. default is `null`, never expires.
    cookiePath:      '/',                    // default
  });

if (redirectResponse) {
  // honor the redirect
  return redirectResponse;
}

// `collectionName` now holds the active collection (or `null` if none)
```

#### What it does, in plain English

1. Reads a cookie

   It looks for a cookie named cookieName (default `publisher-collection`) and hands you the value as `collectionName`.

2. Handles two helper endpoints for you

   | Endpoint                           | Purpose          | Query params                                                                                   | Result                                    |
   |------------------------------------|------------------|------------------------------------------------------------------------------------------------|-------------------------------------------|
   | activatePath (default `/activate`) | Set the cookie   | `collection` (required) - name of the collection<br /> `redirectTo` (optional, `/` by default) | `308` redirect with a `Set-Cookie` header |
   | resetPath (default `/reset`)       | Clear the cookie | `redirectTo` (optional, `/` by default)                                                        | `308` redirect that expires the cookie    |
   
   If a visitor accesses `/activate?collection=blue&redirectTo=/preview`, the helper will issue a redirect and drop `publisher-collection=blue` into their cookie jar.
      - If someone forgets `?collection=?`? Then `/activate` replies with HTTP `400`.
   
   When the visitor hits `/reset`, the cookie is deleted.

   > [!NOTE]
   > The collection that the cookie selects is not in the URL. Add `Cache-Control: private` to the responses of a preview, so that a shared cache does not store them. See [Shared caches](#shared-caches). With [`collectionSelection`](#-previews-collection-selection), `PublisherServer` does this for you.

3. Safety flags are baked in

   - `HttpOnly` is on by default (configurable), to help avoid XSS issues.
   - `Secure` is automatically added on HTTPS requests.
   - `SameSite=Lax` is always set – reasonable default for previews.

#### Option reference

| Option           | Type              | Default                  | Notes                                          |
|------------------|-------------------|--------------------------|------------------------------------------------|
| `cookieName`     | string            | `'publisher-collection'` | Name of the cookie to read/write               |
| `activatePath`   | string            | `'/activate'`            | Path that sets the cookie                      |
| `resetPath`      | string            | `'/reset'`               | Path that clears the cookie                    |
| `cookieHttpOnly` | boolean           | `true`                   | Turn off if the client-side needs to read it   |
| `cookieMaxAge`   | number\|undefined | `undefined`              | Seconds until expiry; omit for session cookies |
| `cookiePath`     | string            | `'/'`                    | Path attribute in the cookie                   |

#### Example

`fromCookie` can be dropped into a Fastly Compute app: 

```js
async function handleRequest(event) {
  const request = event.request;

  // --- Cookie handling starts here
  const { collectionName, redirectResponse } = collectionSelector.fromCookie(request);
  if (redirectResponse) {
    // obey redirect first
    return redirectResponse;
  }
  publisherServer.setActiveCollectionName(collectionName); // null selects the default collection
  // --- Cookie handling ends here

  // Regular routing follows...
  const response = await publisherServer.serveRequest(request);
  if (response != null) {
    return response;
  }
  return new Response('Not found', { status: 404 });
}
```

---

## 📚 Next Steps

- View CLI command help: `npx @fastly/compute-js-static-publish --help`
- Use in CI to automate branch previews
- Visit [https://developer.fastly.com](https://developer.fastly.com) for Compute platform docs

## Development

To build the package, run `npm run build`. To run the tests, see [test/README.md](./test/README.md).

In the code, its comments, and the docs for developers of this package, a **customer** is a developer who uses this package to publish a site, and a **visitor** is a person who opens the customer's site.

## Issues

If you encounter any non-security-related bug or unexpected behavior, please [file an issue][bug] using the bug report template.

[bug]: https://github.com/fastly/compute-js-static-publish/issues/new?labels=bug

### Security issues

Please see our [SECURITY.md](SECURITY.md) for guidance on reporting security-related issues.

## License

[MIT](./LICENSE).
