# Migration Guide

New major versions of `@fastly/compute-js-static-publish` can involve changes to the files that
are generated during scaffolding. For this reason, it is recommended that you re-scaffold your application.

This is straightforward if you're using `compute-js-static-publisher` out-of-the-box. Otherwise, read on.

> [!NOTE]
> This document is under construction.
> 

## Move an existing app to managed mode (8.1)

You do not have to do this. An ejected app (a `compute-js/` directory with `static-publish.rc.js`) continues to work.
In managed mode, this package generates the app from one file, `static-publish.project.js`, and you upgrade by
changing the version of this package. See "Managed and ejected apps" in `README.md`.

> [!IMPORTANT]
> Managed mode generates the `plain` app. If you changed `src/index.js` (or other files of the app), keep your app
> ejected, or move your changes into options of the project file first.

These steps move a project with this layout. Change the paths to match your project:

```
my-site/
├── public/
└── compute-js/        ← static-publish.rc.js, publish-content.config.js, fastly.toml, ...
```

1. In `my-site/`, add this package as a dev dependency at 8.1.0 or later, so that the version is pinned:

   ```sh
   npm install --save-dev @fastly/compute-js-static-publish
   ```

2. Make `my-site/static-publish.project.js`. Paths in it are relative to `my-site/`:

   ```js
   /** @type {import('@fastly/compute-js-static-publish').StaticPublishProject} */
   const project = {
     // From compute-js/static-publish.rc.js: the storage fields (kvStore or s3), publishId,
     // defaultCollectionName, and collectionSelection, if you have it. Do not copy generatedFrom.
     storageMode: "kv-store",
     kvStore: { kvStoreName: "site-content" },
     publishId: "default",
     defaultCollectionName: "live",
     // A new working directory beside the project file.
     staticPublisherWorkingDir: "./static-publisher",

     // The contents of compute-js/publish-content.config.js, with rootDir relative to my-site/
     // ('../public' becomes './public').
     publishContent: {
       rootDir: "./public",
       server: { /* ... */ },
     },

     managed: {
       // From compute-js/fastly.toml: name, description, authors, and service_id.
       name: "my-site",
       description: "My site",
       authors: [ "me@example.com" ],
       serviceId: "SERVICE_ID",
       // The version of this package that you installed in step 1.
       staticPublishVersion: "8.1.0",
     },
   };

   export default project;
   ```

   If the app has no service yet, write the line `    serviceId: undefined,` (exactly), so that the first `deploy`
   writes the Service ID into it.

3. Add these lines to `my-site/.gitignore`:

   ```
   /.static-publish/
   /static-publisher/
   ```

4. In `my-site/`, check the project, publish to the local KV Store, and run the app:

   ```sh
   npx compute-js-static-publish status
   npx compute-js-static-publish publish-content --local
   npx compute-js-static-publish dev
   ```

   The CLI uses only the files of the directory where it runs, so `compute-js/` has no effect here.

5. Deploy. The first `deploy` deploys the generated app to the service of `managed.serviceId`, because the active
   version has no fingerprint yet:

   ```sh
   FASTLY_API_TOKEN=... npx compute-js-static-publish deploy
   ```

   The collections in storage do not change. Publish again only to change the content.

6. When the steps above work, take `compute-js/` out of the repo, and commit `static-publish.project.js`.

## Upgrade from v7 to v8

v8 can use the files that v7 published. The storage key layout did not change. v8 also accepts the v7 format of
`static-publish.rc.js` (`kvStoreName` at the top level). Thus, an app that uses the KV Store does not need a new
scaffold.

To upgrade an app that uses the KV Store:

1. In the `compute-js/` directory of your app, install v8:

   ```sh
   npm install @fastly/compute-js-static-publish@latest
   ```

2. Make sure that the CLI can get a Fastly API token. Set the `FASTLY_API_TOKEN` environment variable, or use
   `--fastly-api-token`. v8 no longer uses the token logged in by the Fastly CLI.

3. Build and deploy your app again. The Wasm binary contains a copy of `static-publish.rc.js`, and the server code
   changed.

4. Publish your content again with `npm run publish-content`. This step is optional. v8 serves the content that v7
   published.

### Changes to examine

- **The CLI purges after it publishes.** In v8, `publish-content` purges the surrogate key `<publishId>-<collection>`
  in KV Store mode too. It finds the Service ID from `--fastly-service-id`, then the `FASTLY_SERVICE_ID`
  environment variable, then `service_id` in `fastly.toml`. If it finds a Service ID, the API token must have permission to purge
  that service. If you do not want a purge, make sure that the CLI does not find a Service ID. If the purge fails,
  the CLI shows a warning, and the publish is complete. `collections delete` purges the same way after it deletes a
  collection.
- **`kvStoreAssetInclusionTest` has a new name.** In `publish-content.config.js`, use `assetInclusionTest`. The old
  name continues to work, but it is deprecated.
- **Imports of files in `build/` are not supported.** Import the named exports of
  `@fastly/compute-js-static-publish`.
- **`--public-dir` and `server.publicDirPrefix` are deprecated.** `publish-content` shows a warning if
  `publicDirPrefix` is not empty. See [Stop using `publicDirPrefix`](#stop-using-publicdirprefix-deprecated).
- **The `@fastly/cli` dependency is removed** from this package. A scaffolded app continues to have `@fastly/cli` as
  its own dependency.

### Stop using `publicDirPrefix` (deprecated)

`--public-dir` and `server.publicDirPrefix` are deprecated. A future version will remove them. If `publish-content`
shows a warning about `server.publicDirPrefix`, do the steps in this section. If it does not show the warning, you do
not use this feature, and you do not have to do anything.

`publicDirPrefix` lets you publish files that requests cannot get. For example, with this layout, `rootDir` is
`'../site'` and `publicDirPrefix` is `'/public'`:

```
site/
  404.html          published as /404.html, but /404.html is not a URL
  templates/
    email.html      published as /templates/email.html, but it is not a URL
  public/
    index.html      published as /public/index.html, served at /index.html
```

To stop using `publicDirPrefix`:

1. Find the files that are under `rootDir` but not under the public directory (`site/public/` in the example). For
   each file, do one of these steps:
   - If your app does not use the file, do nothing. After step 2, the CLI does not publish it.
   - If the file is your `spaFile` or your `notFoundPageFile`, or if your code reads the file with
     `getMatchingAsset()`, move it into the public directory, and add it to `hiddenItems` in
     `publish-content.config.js` (from 8.1.0). A hidden file is published, but requests cannot get it at its own URL,
     for example `/404.html`. The server still serves a hidden `spaFile` or `notFoundPageFile` as the fallback page,
     and your code gets a hidden file with `getMatchingAsset(key, { includeHidden: true })`. See "Hidden files" in
     `README.md`. Your app must be built with 8.1.0 or later to serve a collection that has hidden files:

     ```js
     hiddenItems: [ '/404.html', '/templates/' ],
     ```

     Before 8.1.0, there are no hidden files. Move the file into the public directory. Then requests can also get it
     at its own URL. To prevent this for a file that your code reads, return a response in `src/index.js` before you
     call `serveRequest()`:

     ```js
     const url = new URL(request.url);
     if (url.pathname.startsWith('/templates/')) {
       return new Response('Not found', { status: 404 });
     }
     const response = await publisherServer.serveRequest(request);
     ```

2. In `publish-content.config.js`:
   - Set `rootDir` to the public directory, for example `'../site/public'`.
   - Remove `publicDirPrefix` from the `server` section.
   - In `spaFile` and `notFoundPageFile`, remove the prefix, for example change `'/public/404.html'` to
     `'/404.html'`. These values are asset keys, and asset keys are relative to `rootDir`.
   - Do not change `staticItems`. These values are already relative to the public directory.

3. If your code calls `getMatchingAsset()` with a key that starts with the prefix, remove the prefix from the key, for
   example change `'/public/index.html'` to `'/index.html'`. Then build and deploy your app. Between the deploy and
   step 4, your code does not find these files.

4. Publish each collection that you serve again. Each collection keeps its old settings and its old index until you
   publish it again. The keys of the files are the hashes of the content, so the CLI does not upload the same files
   again.

### Move from the KV Store to S3-compatible storage (BETA)

You do not have to move to S3-compatible storage. The KV Store continues to be the default storage mode.

There is no tool that moves your content from the KV Store to a bucket. The CLI publishes from your source files.
Thus, to move, you publish your content again into the bucket:

1. Scaffold a new app with `--storage-mode=s3`, `--s3-region`, `--s3-bucket`, and, if necessary, `--s3-endpoint`.
   Scaffold it into a different directory, so that you can compare the new files with your current app.

2. Copy your changes from your current app into the new app, for example the changes to `src/index.js` and to
   `publish-content.config.js`. Keep the same `publishId` and `defaultCollectionName`.

3. Set up the S3 credentials for publishing and for the server. See "Using S3 Compatible Storage (Beta)" in
   `README.md`.

4. Publish each collection that you need again, from its source files. The collections that are in the KV Store
   are not copied.

5. Build and deploy the new app. Then examine your site.

6. When you do not need the KV Store content, delete it. Before you do this, make sure that no service version
   that is active or staged uses that KV Store.

> [!NOTE]
> S3-compatible storage is in beta. The configuration and these steps can change before this feature is stable.
