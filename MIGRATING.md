# Migration Guide

New major versions of `@fastly/compute-js-static-publish` can involve changes to the files that
are generated during scaffolding. For this reason, it is recommended that you re-scaffold your application.

This is straightforward if you're using `compute-js-static-publisher` out-of-the-box. Otherwise, read on.

> [!NOTE]
> This document is under construction.
> 

## Upgrade from v7 to v8

v8 can use the files that v7 published. The storage key layout did not change. v8 also accepts the v7 format of
`static-publish.rc.js` (`kvStoreName` at the top level). Thus, an app that uses the KV Store does not need a new
scaffold.

To upgrade an app that uses the KV Store:

1. In the `compute-js/` directory of your app, install v8:

   ```sh
   npm install @fastly/compute-js-static-publish@beta
   ```

2. Make sure that the CLI can get a Fastly API token. Set the `FASTLY_API_TOKEN` environment variable, or use
   `--fastly-api-token`. v8 no longer uses the token logged in by the Fastly API.

3. Build and deploy your app again. The Wasm binary contains a copy of `static-publish.rc.js`, and the server code
   changed.

4. Publish your content again with `npm run publish-content`. This step is optional. v8 serves the content that v7
   published.

### Changes to examine

- **The CLI purges after it publishes.** In v8, `publish-content` purges the surrogate key `<publishId>-<collection>`
  in KV Store mode too. It finds the Service ID from `--fastly-service-id`, then the `FASTLY_SERVICE_ID`
  environment variable, then `service_id` in `fastly.toml`. If it finds a Service ID, the API token must have permission to purge
  that service. If you do not want a purge, make sure that the CLI does not find a Service ID. If the purge fails,
  the CLI shows a warning, and the publish is complete.
- **`kvStoreAssetInclusionTest` has a new name.** In `publish-content.config.js`, use `assetInclusionTest`. The old
  name continues to work, but it is deprecated.
- **Some types have new names.** `KVAssetEntry` is now `AssetEntry`, and `KVAssetEntryMap` is now `AssetEntryMap`.
  The package did not export these types. This change has an effect only if your code imports files from `build/`.
- **The `build/` layout changed.** The package entry is now `build/server/server/index.js`, and the CLI is
  `build/cli/cli/index.js`. Imports of `@fastly/compute-js-static-publish` do not change. If your code imports files
  from `build/`, change the paths.
- **The `@fastly/cli` dependency is removed** from this package. A scaffolded app continues to have `@fastly/cli` as
  its own dependency.

### Move from `@fastly/hono-compute-js-static-publish`

The Hono middleware is now part of this package, at `@fastly/compute-js-static-publish/hono`. The
`@fastly/hono-compute-js-static-publish` package supports only v6 and v7.

1. Uninstall `@fastly/hono-compute-js-static-publish`, and make sure that `hono` is a dependency of your app.

2. Change the import, and get `serveStatic` from the object that `fromStaticPublishRc()` returns:

   ```js
   // v7
   import { fromStaticPublishRc } from '@fastly/hono-compute-js-static-publish';
   const serveStatic = fromStaticPublishRc(rc);

   // v8
   import { fromStaticPublishRc } from '@fastly/compute-js-static-publish/hono';
   const { serveStatic, serveFallback } = fromStaticPublishRc(rc);
   ```

   `fromPublisherServer()` changed in the same way.

3. Examine these changes:
   - `serveStatic()` now serves files as `PublisherServer.serveRequest()` does. It applies `publicDir`, `autoIndex`,
     and `autoExt`, and it serves only `GET` and `HEAD`. Before, it looked up the request path in the published files
     only. Thus, `root` is now relative to `publicDir`. If your `root` included the `publicDir`, remove that part.
   - `serveStatic()` does not serve the SPA file or the 404 page. To serve them, add `app.notFound(serveFallback())`.

See "Using Hono" in `README.md`.

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
