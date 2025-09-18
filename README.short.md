# @fastly/compute-js-static-publish

Fastly Compute + KV Store for static websites and web apps.

This CLI tool helps you:

- ✅ Deploy static sites to Fastly Compute with zero backend
- 📦 Store files in Fastly KV Store efficiently
  - 🎁 New in v8: Support for S3-compatible storage such as Fastly Object Storage (Beta) 
- 🗂 Publish to named collections (`live`, `preview-42`, etc.)
- 🔄 Switch between collections at runtime
- 🧹 Clean up old or expired assets

---

## Quick Start

Create a directory for your project, place your static files in `./public`, then type:

```sh
npx @fastly/compute-js-static-publish@latest --root-dir=./public --storage-mode=kv-store --kv-store-name=site-content
```

**New in v8:** S3-compatible storage (such as Fastly Object Storage) is also supported (Beta). To use this mode, type:

```sh
npx @fastly/compute-js-static-publish@latest --root-dir=./public --storage-mode=s3 --s3-region=<region> --s3-bucket-<bucket-name>
```

For more details, see the [S3-compatible storage](https://github.com/fastly/compute-js-static-publish/blob/main/README.md#s3-compatible-storage) section in the full documentation.

### 🔧 Local Preview

```sh
cd compute-js
npm install
npm run dev:publish  # 'publish' your files to the simulated local KV Store or to the S3 bucket
npm run dev:start    # preview locally
```

Serves your app at `http://127.0.0.1:7676`. If the app is using the KV Store, your content is served from a simulated KV Store managed by the development server.

### 🚀 Deploy to Production

When you're ready to go live, [create a free Fastly account](https://www.fastly.com/signup/?tier=free) if you haven't already, and then:

```sh
cd compute-js
npm run fastly:deploy        # deploy the app
npm run fastly:publish       # upload your static files
```

In the future, unless you have further changes to make to your app itself, you can
upload further updates to your static files:
```sh
cd compute-js
npm run fastly:publish       # upload your static files
```

## Features

- Named collections for previews, staging, production
- SPA + fallback handling
- Precompressed Brotli/gzip support
- CLI tools for publish, promote, and cleanup

## Documentation

📘 Full documentation available on GitHub:  
[https://github.com/fastly/compute-js-static-publish](https://github.com/fastly/compute-js-static-publish)
