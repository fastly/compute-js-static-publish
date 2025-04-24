# @fastly/compute-js-static-publish

Fastly Compute + KV Store for static websites and web apps.

This CLI tool helps you:

- ✅ Deploy static sites to Fastly Compute with zero backend
- 📦 Store files in Fastly KV Store efficiently
- 🗂 Publish to named collections (`live`, `preview-42`, etc.)
- 🔄 Switch between collections at runtime
- 🧹 Clean up old or expired assets

---

## Quick Start

Create a directory for your project, place your static files in `./public`, then type:

```sh
npx @fastly/compute-js-static-publish --root-dir=./public --kv-store-name=site-content
```

### 🔧 Local Preview

```sh
cd compute-js
npm install
npm run dev:publish          # 'publish' your files to the simulated local KV Store
npm run dev:start            # preview locally
```

Serves your app at `http://127.0.0.1:7676`, powered by a simulated KV Store.

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
