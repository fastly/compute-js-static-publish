# Static Publisher for JavaScript on Fastly Compute

> NOTE: `@fastly/compute-js-static-publish` is provided as a Fastly Labs product. Visit the [Fastly Labs](https://www.fastlylabs.com/) site for terms of use.

> [!NOTE]
> These docs are for v7, a major rewrite that adds powerful new features such as named collections.
> If you're looking for v6, please check out the [v6 branch](https://github.com/fastly/compute-js-static-publish/tree/v6).

> [!WARNING]
> Version 7 no longer supports module assets. If you require this feature, consider using [v6](https://github.com/fastly/compute-js-static-publish/tree/v6).

## 📖 Table of Contents

- [✨ Key Features](#-key-features)
- [🏁 Quick Start](#-quick-start)
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

`@fastly/compute-js-static-publish` helps you deploy static files to [Fastly Compute](https://developer.fastly.com/learning/compute/) using Fastly's KV Store for fast, cacheable, and content-addressed delivery.

## ✨ Key Features

- 📦 Easy to scaffold and deploy
- 🚀 Content stored in Fastly KV Store using hashed keys
- 🔁 Publish new content without deploying new Wasm binaries
- 🗂 Organize releases into named collections which can be previewed (e.g. `live`, `staging`, `preview-123`)
- 🧼 Cleanup tools to remove expired or orphaned files
- ⚙️ Configurable per-collection server configurations (e.g. fallback files)
- 🔒 Supports Brotli/gzip compression, conditional GET, and long cache TTLs

---

## 🏁 Quick Start

### 1. Scaffold a Compute App

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

### 2. Preview Locally

Type the following &mdash; no Fastly account or service required yet!

```sh
cd compute-js
npm install
npm run dev:publish
npm run dev:start
```

Fastly's [local development environment](https://www.fastly.com/documentation/guides/compute/testing/#running-a-local-testing-server) serves your static website at `http://127.0.0.1:7676`, powered by a simulated KV Store.

### 3. Deploy Your App

Ready to go live? All you need is a [free Fastly account](https://www.fastly.com/signup/?tier=free)!

```sh
npm run fastly:deploy
```

The command publishes your Compute app and creates the KV Store. (No content uploaded yet!)

### 4. Publish Content

```sh
npm run fastly:publish
```

Upload static files to the KV Store and applies the server config.  Your website is now up and live!

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
    └── src/
        └── index.js                     # Your Compute app entry point
```

## ⚙️ Configuring `static-publish.rc.js`

This file defines your compute-js-static-publish application's settings. A copy of this is also baked into the Wasm binary and loaded when running your Compute app locally or on the edge.

### Example: `static-publish.rc.js`

```js
const rc = {
  kvStoreName: 'site-content',
  defaultCollectionName: 'live',
  publishId: 'default',
  staticPublisherWorkingDir: './static-publisher',
};

export default rc;
```

### Fields:

All fields are required.

- `kvStoreName` - The name of the KV Store used for publishing.
- `defaultCollectionName` - Collection to serve when none is specified.
- `publishId` - Unique prefix for all keys in the KV Store. Override only for advanced setups (e.g., multiple apps sharing the same KV Store).
- `staticPublisherWorkingDir` - Directory to hold working files during publish.

> [!NOTE]
> Changes to this file require rebuilding the Compute app, since a copy of it is baked into the Wasm binary.

## 🧾 Config for Publishing and Server: `publish-content.config.js`

This file is included as part of the scaffolding. Every time you publish content, the publish settings in this file are used for publishing the content, and the server settings are taken from this file and saved as the settings used by the server for that collection.

```js
const config = {
  // these paths are relative to compute-js dir
  rootDir: '../public',

  // Include/exclude filters (optional):
  excludeDirs: ['node_modules'],
  excludeDotfiles: true,
  includeWellKnown: true,

  // Advanced filtering (optional):
  kvStoreAssetInclusionTest: (key, contentType) => {
    return true; // include everything by default
  },

  // Override which compressed variants to create for each asset during publish (optional):
  contentCompression: ['br', 'gzip'],

  // Content type definitions/overrides (optional):
  contentTypes: [
    { test: /\.custom$/, contentType: 'application/x-custom', text: false },
  ],

  // Server settings
  server: {
    publicDir: './public',
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
- `kvStoreAssetInclusionTest` - Function to determine inclusion and variant behavior per file.
- `contentCompression` - Array of compression formats to pre-generate (`['br', 'gzip']` by default).
- `contentTypes` - Additional or override content type definitions.

- `server` - Server runtime config that contains the following fields:  
   - `publicDir` - The 'public' directory. The Publisher Server will
     resolve requests relative to this directory (default: same value as 'root-dir').
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

### Expiration (Auto-cleanup)

Collections can expire automatically:

- Expired collections are ignored by the server and return 404s
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

This only affects the current request (in Compute, requests do not share state).

#### Example: Subdomain-based Routing

In the following example, assume that the Compute application is hosted using a wildcard domain `*.example.com`. A request for `preview-pr-123.example.com` would activate the collection `'pr-123'`.

```js
import { PublisherServer, collectionSelector } from '@fastly/compute-js-static-publish';
import rc from '../static-publish.rc.js';

const publisherServer = PublisherServer.fromStaticPublishRc(rc);

addEventListener("fetch", event => {
  const request = event.request;
  const collectionName = collectionSelector.fromHostDomain(request, /^preview-([^\.]*)\./);
  if (collectionName != null) {
    publisherServer.setActiveCollectionName(collectionName);
  }

  event.respondWith(publisherServer.serveRequest(request));
});
```

### 🔀 Selecting a Collection at Runtime

The `collectionSelector` module provides helpers to extract a collection name from different parts of a request:

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

### Local development

During development, the local preview server (`npm run dev:start`) will run against assets loaded into the simulated KV Store provided by the local development environment.

Prior to starting the server, publish the content to the simulated KV Store:

```sh
npm run dev:publish          # 'publish' your files to the simulated local KV Store
npm run dev:start            # preview locally
```

This simulates publishing by writing to `kvstore.json` instead of uploading to the actual KV Store. You can preview your site at `http://127.0.0.1:7676` - no Fastly account or service required.

Note that for local development, you will have to stop and restart the local development server each time you publish updates to your content.

To publish to an alternative collection name, use:

```sh
npm run dev:publish -- --collection-name=preview-123
```

### Production 

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

### 🔍 Dry Run Mode

Preview what will be deleted without making changes:

```sh
npx @fastly/compute-js-static-publish clean --dry-run
```

> ⚠️ Cleanup never deletes the default collection and never deletes content that’s still in use.

## 🔄 Content Compression

This project supports pre-compressing and serving assets in Brotli and Gzip formats. Compression is controlled at two different stages:

- **During publishing**, the `contentCompression` field in the `publish` section of `publish-content.config.js` defines which compressed variants (e.g., `br`, `gzip`) should be generated and uploaded to the KV Store.

Assets are stored in multiple formats (uncompressed + compressed) if configured. The following file types are compressed by default:

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
  if (request.url.endsWith('/api/hello')) {
    return new Response(JSON.stringify({ greeting: "hi" }), {
      headers: { 'content-type': 'application/json' }
    });
  }

  return new Response("Not Found", { status: 404 });
}
```

## 📥 Using Published Assets in Your Code

To access files you've published, use the `getMatchingAsset()` and `loadKvAssetVariant()` methods on `publisherServer`.

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
const kvAssetVariant = await publisherServer.loadKvAssetVariant(asset, null); // pass 'gzip' or 'br' for compressed

kvAssetVariant.kvStoreEntry;      // KV Store entry (type KVStoreEntry defined in 'fastly:kv-store')
kvAssetVariant.size;              // Size of the variant
kvAssetVariant.hash;              // SHA256 of the variant
kvAssetVariant.contentEncoding;   // 'gzip', 'br', or null
kvAssetVariant.numChunks;         // Number of chunks (for large files)
```

You can stream `kvAssetVariant.kvStoreEntry.body` directly to a `Response`, or read it using `.text()`, `.json()`, or `.arrayBuffer()` depending on its content type.

---

## 📚 CLI Reference

### Available Commands

#### Outside a Compute App Directory
- `npx @fastly/compute-js-static-publish@latest [options]` - Scaffold a new Compute app

#### Inside a Compute App Directory
- `publish-content` - Publish static files to the KV Store under a named collection
- `clean` - Delete expired and unreferenced KV entries
- `collections list` - List all published collections
- `collections delete` - Delete a specific collection index
- `collections promote` - Copy a collection to another name
- `collections update-expiration` - Modify expiration time for an existing collection

### 🛠 App Scaffolding

Run outside an existing Compute app directory:

```sh
npx @fastly/compute-js-static-publish@latest \
  --root-dir=./public \
  --kv-store-name=site-content \
  [--output=./compute-js] \
  [--static-publisher-working-dir=<output>/static-publisher] \
  [--publish-id=<prefix>] \
  [--public-dir=./public] \
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
- `--kv-store-name`: Required. Name of KV Store to use.
- `--output`: Compute app destination (default: `./compute-js`)
- `--static-publisher-working-dir`: Directory to hold working files (default: `<output>/static-publisher`).
- `--name`: Application name to insert into `fastly.toml`
- `--description`: Application description to insert into `fastly.toml`
- `--author`: Author to insert into `fastly.toml`
- `--service-id`: Optional existing Fastly Compute service ID

**Used in building config files:**
- `--root-dir`: Required. Directory of static site content.
- `--publish-id`: Optional key prefix for KV entries (default: `'default'`).
- `--public-dir`: Public files base directory (default: same as `--root-dir`).
- `--static-dir`: One or more directories to serve with long cache TTLs.
- `--spa`: SPA fallback file path (e.g., `./public/spa.html`).
- `--not-found-page`: 404 fallback file path (e.g., `./public/404.html`).
- `--auto-index`: List of filenames to use as index files.
- `--auto-ext`: Extensions to try when resolving URLs.

### 🚀 Inside a Compute App Directory

Once you're in the scaffolded Compute app directory (with `static-publish.rc.js` present), you can run these subcommands:

#### `publish-content`

```sh
npx @fastly/compute-js-static-publish publish-content \
  [--root-dir=./public] \
  [--collection-name=preview-42] \
  [--config=./publish-content.config.js] \
  [--expires-in=7d | --expires-at=2025-05-01T12:00Z | --expires-never] \
  [--local] \
  [--fastly-api-token=...]
```

Publishes static files from your local root directory into a named collection, either in the Fastly KV Store (default) or to a local dev directory (`--local`). Files that already exist with the same hash are skipped automatically.

After this process is complete, the PublisherServer object in the Compute application will see the updated index of files and updated server settings from the `publish-content.config.js` file.

##### Options:

- `--collection-name`: Name of the collection to create/update (default: value in `static-publish.rc.js`)
- `--config`: Path to a config file to configure server behavior for this collection (default: `./publish-content.config.js`)
- `--root-dir`: Source directory to read files from (overrides value in `publish-content.config.js`)
- `--kv-overwrite`: Cannot be used with `--local`. When using Fastly KV Store, always overwrites existing entries, even if unchanged.

**Expiration:**

- `--expires-in`: Time-to-live from now (e.g. `1h`, `2d`, `1w`)
- `--expires-at`: Absolute expiration time (ISO format: `2025-05-01T12:00Z`)
- `--expires-never`: Collection never expires

*At most one of **`--expires-in`**, **`--expires-at`**, or **`--expires-never`** may be specified*

**Global Options:**

- `--local`: Instead of working with the Fastly KV Store, operate on local files that will be used to simulate the KV Store with the local development environment.

- `--fastly-api-token`: API token to use when publishing. If not set, the tool will check:
   - **`FASTLY_API_TOKEN` environment variable**
   - Logged-in Fastly CLI profile

#### `clean`

```sh
npx @fastly/compute-js-static-publish clean \
  [--delete-expired-collections] \
  [--dry-run]
```

Cleans up expired or unreferenced items in the Fastly KV Store.
This can include expired collection indexes and orphaned content assets.

##### Options:

- `--delete-expired-collections`: If set, expired collection index files will be deleted.
- `--dry-run`: Show what would be deleted without performing any deletions.

**Global Options:**

- `--local`: Instead of working with the Fastly KV Store, operate on local files that will be used to simulate the KV Store with the local development environment.

- `--fastly-api-token`: API token to use when publishing. If not set, the tool will check:
    - **`FASTLY_API_TOKEN` environment variable**
    - Logged-in Fastly CLI profile

#### `collections list`

```sh
npx @fastly/compute-js-static-publish collections list
```
Lists all collections currently published in the KV Store.

##### Options:

**Global Options:**

- `--local`: Instead of working with the Fastly KV Store, operate on local files that will be used to simulate the KV Store with the local development environment.

- `--fastly-api-token`: API token to use when publishing. If not set, the tool will check:
    - **`FASTLY_API_TOKEN` environment variable**
    - Logged-in Fastly CLI profile

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

**Global Options:**

- `--local`: Instead of working with the Fastly KV Store, operate on local files that will be used to simulate the KV Store with the local development environment.

- `--fastly-api-token`: API token to use when publishing. If not set, the tool will check:
    - **`FASTLY_API_TOKEN` environment variable**
    - Logged-in Fastly CLI profile

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

**Global Options:**

- `--local`: Instead of working with the Fastly KV Store, operate on local files that will be used to simulate the KV Store with the local development environment.

- `--fastly-api-token`: API token to use when publishing. If not set, the tool will check:
    - **`FASTLY_API_TOKEN` environment variable**
    - Logged-in Fastly CLI profile

#### `collections delete`

```sh
npx @fastly/compute-js-static-publish collections delete \
  --collection-name=preview-42
```

Deletes a collection index from the KV Store. The content files will remain as they may still be referenced by other collection indexes.

Use the `npx @fastly/compute-js-static-publish clean` command afterward to remove content files that are no longer referenced by any collection.

##### Options:

- `--collection-name`: The name of the collection to delete (required)

**Global Options:**

- `--local`: Instead of working with the Fastly KV Store, operate on local files that will be used to simulate the KV Store with the local development environment.

- `--fastly-api-token`: API token to use when publishing. If not set, the tool will check:
    - **`FASTLY_API_TOKEN` environment variable**
    - Logged-in Fastly CLI profile

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
   | activatePath (default `/activate`) | Set the cookie   | `collection` (required) - name of the collection<br /> `redirectTo` (optional, `/` by default) | `302` redirect with a `Set-Cookie` header |
   | resetPath (default `/reset`)       | Clear the cookie | `redirectTo` (optional, `/` by default)                                                        | `302` redirect that expires the cookie    |
   
   If a visitor accesses `/activate?collection=blue&redirectTo=/preview`, the helper will issue a redirect and drop `publisher-collection=blue` into their cookie jar.
      - If someone forgets `?collection=?`? Then `/activate` replies with HTTP `400`.
   
   When the visitor hits `/reset`, the cookie is deleted.

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
  if (collectionName != null) {
    publisherServer.setActiveCollectionName(collectionName);
  }
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

## Issues

If you encounter any non-security-related bug or unexpected behavior, please [file an issue][bug] using the bug report template.

[bug]: https://github.com/fastly/compute-js-static-publish/issues/new?labels=bug

### Security issues

Please see our [SECURITY.md](SECURITY.md) for guidance on reporting security-related issues.

## License

[MIT](./LICENSE).
