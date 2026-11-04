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

### Managed projects

`scaffold --managed` writes only one file, `static-publish.project.js`, in the current directory (the project dir), and adds `.static-publish/` and the working directory to the `.gitignore` there:

```
my-site/
├── static-publish.project.js            # Commit this: the only config file
├── public/                              # Your static site files
├── .gitignore                           # Ignores .static-publish/ and static-publisher/
└── static-publisher/                    # ⚠️ Do not commit - the working directory
```

The project file has the settings that an ejected app has in its two files:

- The top level has the fields of `static-publish.rc.js` (`storageMode`, `kvStore` or `s3`, `publishId`, `defaultCollectionName`, `staticPublisherWorkingDir`, `collectionSelection`).
- `publishContent` has the fields of `publish-content.config.js`. `publish-content --config <file>` replaces it for one run.
- `managed` has the settings of the generated app (`name`, `description`, `authors`, `serviceId`, and `staticPublishVersion`, the version of this package that the project uses).

Paths in the project file are relative to it. The name of the file marks the mode: a directory with `static-publish.project.js` is a managed project, and a directory with `static-publish.rc.js` is an ejected app. A directory with both is an error.

`publish-content`, `collections`, and `clean` run in the project dir (or with `--project-dir`), and read the project file. `publish-content` purges the service of `managed.serviceId`, after `--fastly-service-id` and `FASTLY_SERVICE_ID`.

To run the app on your computer:

```sh
npx @fastly/compute-js-static-publish publish-content --local
npx @fastly/compute-js-static-publish dev
```

`dev` generates the app in `.static-publish/app/`, installs its dependencies with `npm ci` if they changed, and runs `fastly compute serve` in it. Options after `--` go to `fastly compute serve`, for example `dev -- --addr=127.0.0.1:8080`. The app serves the content of the local KV Store, `kvstore.json` in the working directory.

The same version of this package always generates the same app, with the same versions of all dependencies: this package has a lockfile for the app of each template. The app uses the copy of this package that runs the CLI, through a `file:` link. Thus, add this package as a dev dependency of your project, and run the CLI from it, so that the version is pinned:

```sh
npm install --save-dev @fastly/compute-js-static-publish
```

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

`npm run dev:watch` runs `fastly compute serve --watch`, which builds and restarts the app when a file in the app directory changes. Options after `--` go to `fastly compute serve`, for example `npm run dev:watch -- --addr=127.0.0.1:8080`. If the app has `scripts/template_watch.js`, that file runs with Node.js next to the Fastly CLI, until the Fastly CLI stops. Use it to watch files outside the app directory: when they change, write a file in the app directory, and the Fastly CLI builds the app again. `dev:watch` does not work on Windows.

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
- `assetInclusionTest` - Function to determine inclusion and variant behavior per file.
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

You can combine PublisherServer with custom logic to support APIs, authentication, redirects, or A/B testing. Handle your own routes before you call `serveRequest()`.

`serveRequest()` returns `null` for a method other than `GET` or `HEAD`, and when no file matches and no SPA file or 404 page applies. If `publish-content.config.js` sets a 404 page or an SPA file, `serveRequest()` serves that page for each path that has no file. Thus, code after `serveRequest()` does not run for those requests.

```js
import { PublisherServer } from '@fastly/compute-js-static-publish';
import rc from '../static-publish.rc.js';

const publisherServer = PublisherServer.fromStaticPublishRc(rc);

addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  // Add your custom logic here, before serveRequest()
  const url = new URL(request.url);
  if (url.pathname === '/api/hello') {
    return new Response(JSON.stringify({ greeting: "hi" }), {
      headers: { 'content-type': 'application/json' }
    });
  }

  const response = await publisherServer.serveRequest(request);
  if (response != null) {
    return response;
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

`serveFallback(request, { collectionName })` serves the SPA file (`200`) or the 404 page (`404`) of the collection, as `serveRequest()` does when no file matches. It returns `null` for a method other than `GET` and `HEAD`, for a client that does not accept HTML, or when the collection has no fallback page. Use it with `fallback: false`, to run your own logic between the files and the fallback page. The scaffolded app (`src/index.js`) uses this order:

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
  [--template=plain] \
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
- `--template`: The template of the app's code (default: `plain`). `plain` is the only template.
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
