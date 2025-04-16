# Static Publisher for JavaScript on Fastly Compute

## 📖 Table of Contents

- [✨ Key Features](#-key-features)
- [🏁 Quick Start](#-quick-start)
- [⚙️ Configuring `static-publish.rc.js`](#️-configuring-static-publishrcjs)
- [🧾 Default Server Config: `publish-content.config.js`](#-default-server-config-publish-contentconfigjs)
- [📦 Collections (Preview, Deploy, Promote)](#-collections-preview-deploy-promote)
- [🧹 Cleaning Up](#-cleaning-up)
- [🔄 Content Compression](#-content-compression)
- [🧩 Using PublisherServer in Custom Apps](#-using-publisherserver-in-custom-apps)
- [📥 Using Published Assets in Your Code](#-using-published-assets-in-your-code)
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
npx @fastly/compute-js-static-publish \
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
npm run start
```

Fastly's [local development environment](https://www.fastly.com/documentation/guides/compute/testing/#running-a-local-testing-server) serves your static website at `http://127.0.0.1:7676`, powered by a simulated KV Store.

### 3. Deploy Your App

Ready to go live? All you need is a [free Fastly account](https://www.fastly.com/signup/?tier=free)!

```sh
npm run deploy
```

The command publishes your Compute app and creates the KV Store. (No content uploaded yet!)

### 4. Publish Content

```sh
npm run publish-content
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
};

export default rc;
```

### Fields:

- `kvStoreName` - The name of the KV Store used for publishing (required).
- `defaultCollectionName` - Collection to serve when none is specified (required).
- `publishId` - Unique prefix for all keys in the KV Store (required). Override only for advanced setups (e.g., multiple apps sharing the same KV Store).

> [!NOTE]
> Changes to this file require rebuilding the Compute app, since a copy of it is baked into the Wasm binary.

## 🧾 Default Server Config: `publish-content.config.js`

This file is included as part of the scaffolding. Every time you publish content, the publish settings in this file are used for publishing the content, and the server settings are taken from this file and saved as the settings used by the server for that collection.

You can override this file for a single `publish-content` command by specifying an alternative using `--config` on the command line.

```js
const config = {
  // these paths are relative to compute-js dir
  rootDir: '../public',
  staticPublisherWorkingDir: './static-publisher',

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

> [!NOTE]
> Changes to this file apply when content is published.

### Fields:

- `rootDir` - Directory to scan for content, relative to this file (required).
- `staticPublisherWorkingDir` - Directory to hold working files during publish (default: `'./static-publisher'`).
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

## 📦 Collections (Preview, Deploy, Promote)

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

- Expired collections return 404s
- They’re ignored by the server
- Their files are cleaned up by `clean`

```sh
--expires-in=3d                  # relative (e.g. 1h, 2d, 1w)
--expires-at=2025-05-01T12:00Z  # absolute (ISO 8601)
```

### Switching the active collection

By default, the app serves from the collection named in `static-publish
.rc.js` under `defaultCollectionName`. To switch the active collection, you add custom code to your Compute app that calls `publisherServer.setActiveCollectionName(name)`:

```js
publisherServer.setActiveCollectionName("preview-42");
```

This only affects the current request (in Compute, requests do not share state).

#### Example: Subdomain-based Routing

```js
import { PublisherServer, collectionSelector } from '@fastly/compute-js-static-publish';
import rc from '../static-publish.rc.js';

const publisherServer = PublisherServer.fromStaticPublishRc(rc);

addEventListener("fetch", event => {
  const request = event.request;
  const collectionName = collectionSelector.fromHostDomain(request, /^preview-(.*)\./);
  if (collectionName != null) {
    publisherServer.setActiveCollectionName(collectionName);
  }

  event.respondWith(publisherServer.serveRequest(request));
});
```

### 🔀 Selecting a Collection at Runtime

The `collectionSelector` module provides helpers to extract a collection name from different parts of a request:

```js
collectionSelector.fromHostDomain(request, /^preview-(.*)\./);
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
```

This copies all content and server settings from the `staging` collection to the collection named in your `defaultCollectionName`. To copy to a different name, add `--to=some-other-name`.

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

During development, starting the local preview server (`npm run start`) will run `publish-content --local-only` automatically via a `prestart hook`. This simulates publishing by writing to `kvstore.json` instead of uploading to the actual KV Store. You can preview your site at `http://127.0.0.1:7676` - no Fastly account or service required.

When you're ready for production:

1. [Create a free Fastly account](https://www.fastly.com/signup/?tier=free) if you haven't already.
2. Run `npm run deploy`
   - This builds your Compute app into a Wasm binary
   - Deploys it to a new or existing Fastly Compute service
   - If creating a new service:
      - you'll be prompted for backend info - **you can skip this**, as no backend is needed (all content is served from KV)
      - KV Store will be created if necessary and automatically linked to your new service.

Once deployed, publish content like so:

```sh
npm run publish-content
```

This:

- Uses the default collection name
- Uploads static files to the KV Store
- Stores server configuration for the collection

> [!TIP]
> Upload to a specific collection by specifying the collection name when publishing content:
> ```sh
> npm run publish-content -- --collection-name=preview-42
> ```

**No Wasm redeploy needed** unless you:

- Modify `src/index.js` - such as when you update your custom routing logic (e.g. collection selection) or  
- Change `static-publish.rc.js`

If you do need to redeploy, simply run:

```sh
npm run deploy
```

## 🧹 Cleaning Up

Every time you publish, old files are left behind for safety. **However, files with the same content will be re-used across collections and publishing events** - they are only stored once in the KV Store using their content hash as a key. This ensures that unchanged files aren't duplicated, keeping storage efficient and deduplicated. To avoid bloat, use:

```sh
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

kvAssetVariant.kvStoreEntry;      // KV Store entry
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
- `npx @fastly/compute-js-static-publish [options]` - Scaffold a new Compute app

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
npx @fastly/compute-js-static-publish \
  --root-dir=./public \
  --kv-store-name=site-content \
  [--output=./compute-js] \
  [--publish-id=<prefix>] \
  [--public-dir=./public] \
  [--static-dir=./public/static] \
  [--static-publisher-working-dir=./compute-js/static-publisher] \
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
- `--name`: Application name to insert into `fastly.toml`
- `--description`: Application description to insert into `fastly.toml`
- `--author`: Author to insert into `fastly.toml`
- `--service-id`: Optional existing Fastly Compute service ID

**Used in building config files:**
- `--root-dir`: Required. Directory of static site content.
- `--publish-id`: Optional key prefix for KV entries (default: `'default'`).
- `--static-publisher-working-dir`: Directory to hold working files (default: `<output>/static-publisher`).
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
  [--expires-in=7d | --expires-at=2025-05-01T12:00Z] \
  [--local-only | --no-local] \
  [--fastly-api-token=...]
```

Publishes your static files and server config for a given collection.

#### Options:

**Configuration:**

- `--config`: Path to a config file to configure server behavior for this collection (default: `./publish-content.config.js`)

**Content and Collection:**

- `--root-dir`: Source directory to read files from (overrides value in `publish-content.config.js`)
- `--collection-name`: Name of the collection to create/update (default: value in `static-publish.rc.js`)
- `--expires-in`: Time-to-live from now (e.g. `1h`, `2d`, `1w`)
- `--expires-at`: Absolute expiration time (ISO format: `2025-05-01T12:00Z`) *(Only one of **`--expires-in`** or **`--expires-at`** may be specified)*

**Mode:**

- `--local-only`: Do not upload files to Fastly KV Store; only simulate KV Store locally
- `--no-local`: Do not prepare files for local simulated KV Store; upload to real KV Store only

**Auth:**

- `--fastly-api-token`: API token to use when publishing\
  *(Overrides **`FASTLY_API_TOKEN`** environment variable and **`fastly profile token`**)*
- Stores server config per collection
- Supports expiration settings

#### `clean`

```sh
npx @fastly/compute-js-static-publish clean \
  [--delete-expired-collections] \
  [--dry-run]
```

Removes unreferenced content from the KV Store.

#### Options:

- `--delete-expired-collections`: Also delete collection index files that have expired
- `--dry-run`: Show what would be deleted without actually removing anything

#### `collections list`

```sh
npx @fastly/compute-js-static-publish collections list
```
Lists all known collection names and metadata.

#### `collections promote`

```sh
npx @fastly/compute-js-static-publish collections promote \
  --collection-name=preview-42 \
  --to=live \
  [--expires-in=7d | --expires-at=2025-06-01T00:00Z]
```
Copies an existing collection (content + config) to a new collection name.

#### Options:
- `--collection-name`: The name of the source collection to promote (required)
- `--to`: The name of the new (target) collection to create or overwrite (required)
- `--expires-in`: Time-to-live from now (e.g. `1h`, `2d`, `1w`)
- `--expires-at`: Absolute expiration time (ISO format)

*Exactly one of **`--expires-in`** or **`--expires-at`** may be provided.*

#### `collections update-expiration`

```sh
npx @fastly/compute-js-static-publish collections update-expiration \
  --collection-name=preview-42 \
  --expires-in=3d | --expires-at=2025-06-01T00:00Z
```
Sets or updates the expiration time of a collection.

#### Options:
- `--collection-name`: The name of the collection to update (required)
- `--expires-in`: Time-to-live from now (e.g. `1h`, `2d`, `1w`)
- `--expires-at`: Absolute expiration time (ISO format)

*Exactly one of **`--expires-in`** or **`--expires-at`** must be provided.*

#### `collections delete`

```sh
npx @fastly/compute-js-static-publish collections delete \
  --collection-name=preview-42
```
Deletes a specific collection’s index and associated settings.

#### Options:
- `--collection-name`: The name of the collection to delete (required)

---

## 📚 Next Steps

- View CLI command help: `npx @fastly/compute-js-static-publish --help`
- Use in CI to automate branch previews
- Visit [https://developer.fastly.com](https://developer.fastly.com) for Compute platform docs
