# Migration Guide

New major versions of `@fastly/compute-js-static-publish` can involve changes to the files that
are generated during scaffolding. For this reason, it is recommended that you re-scaffold your application.

This is straightforward if you're using `compute-js-static-publisher` out-of-the-box. Otherwise, read on.

## KV Store

KV Store is no longer optional as of v7

Starting with `v5.0.0`, this tool refers to the KV Store using its finalized product name, "KV Store". References in
code and in configuration that used the previous "Object Store" name have been changed to the new name. If you have
been using the feature, you can take the following steps:

* In your `static-publish.rc.js` file:
  * Rename the `objectStore` key to `kvStoreName`. For example, if your KV Store is named `'my-store'`, then change:
    ```
    objectStore: 'my-store'
    ```
    to
    ```
    kvStoreName: 'my-store'
    ```

* In your `fastly.toml` file, find all lines that pertain to object store entries.
  * Such lines may look like this and there may be many:
    ```toml
    [[local_server.object_store.my-store]]
    key = "4QEM5nIpyLiNF3wwsbnda5:/404.html_aeed29478691e636b4ded20c17e9eae437614617067a8751882368b965a21bcb"
    path = "output/404.html"
    ```
  * Change the `object_store` of these lines to `kv_stores`. For example:
    ```toml
    [[local_server.kv_stores.my-store]]
    key = "4QEM5nIpyLiNF3wwsbnda5:/404.html_aeed29478691e636b4ded20c17e9eae437614617067a8751882368b965a21bcb"
    path = "output/404.html"
    ```

## Webpack

Webpack is no longer enabled for new projects

Starting with `v4.0.0` of this tool, webpack is no longer required and is disabled by default for new applications. This can simplify development and result in shorter build times. 

You may still wish to use webpack if you need some of the features it provides, e.g., the ability to use loaders, asset modules, module replacement, dynamic imports, etc.

To migrate away from using webpack, make the following changes in your `./compute-js` directory:

* First, check your `webpack.config.js` file to make sure you aren't actually depending on any custom webpack features. When you're ready, continue to the next step.
* Delete `webpack.config.js`.
* Modify `static-publish.rc.js`:
  * Change the line `module.exports = {` to `const config = {`
  * At the end of the file, add `export default config;`
* In your `package.json` file:
  * At the top level, add a `"type"` key if one doesn't already exist, with the value `"module"`.
  * Under `devDependencies`, remove the `webpack` and `webpack-cli` entries.
  * Under `scripts`, modify the `prebuild` script by removing the `&& webpack` at the end
    of it. 
  * Under `scripts`, modify the `build` script by replacing the parameter `./bin/index.js`
    with `./src/index.js`.
  * In the end, the two scripts should look like this (along with any other scripts you may have):
    ```json
    {
        "prebuild": "npx @fastly/compute-js-static-publish --build-static",
        "build": "js-compute-runtime ./src/index.js ./bin/main.wasm"
    }
    ```

If you aren't moving away from webpack just yet, check that your `webpack.config.js` is up-to-date. Refer
to the [default `webpack.config.js` in this package](./resources/webpack.config.js) and add your changes,
or modify your configuration file using the following steps:

* To make the resulting bundle easier to debug, it is recommended to set the `devtool` value to `false`.

* The JavaScript SDK automatically adds the named condition `fastly` when resolving dependency packages.
  To match the behavior when bundling with webpack, set `resolve.conditionsNames` to the following:
    ```
    resolve: {
      conditionNames: [
        'fastly',
        '...',
      ],
    ],
    ``` 

* Starting `v3.0.0`, we depend on `v1.0.0` of the `js-compute` library, which provides namespaced exports for Fastly
  features. To use them, you'll need to make the following changes to `webpack.config.js`:

  * Set the `target` value to `false`.

  * The `output` section should look like this:
    ```
    output: {
      filename: "index.js",
      path: path.resolve(__dirname, "bin"),
      chunkFormat: 'commonjs',
      library: {
        type: 'commonjs',
      },
    },
    ``` 

  * Add a new `externals` array to the bottom if it doesn't exist already. Add the following entry:

    ```javascript
    module.exports = {
      /* ... other config ... */
      externals: [
        /^fastly:.*$/,
      ],
    }
    ```

* Starting `v3.0.0`, we no longer use webpack static assets to include the contents of static files, and instead [use the
  `includeBytes` function](https://js-compute-reference-docs.edgecompute.app/docs/fastly:experimental/includeBytes)
  to enable more performant loading, as well as a more size-efficient Wasm binary. As a result, the following code can
  safely be removed from the `module.rules` array.

  ```javascript
    {
      // asset/source exports the source code of the asset.
      resourceQuery: /staticText/,
      type: "asset/source",
    },
    {
      // asset/inline exports the raw bytes of the asset.
      // We base64 encode them here
      resourceQuery: /staticBinary/,
      type: "asset/inline",
      generator: {
        /**
         * @param {Buffer} content
         * @returns {string}
         */
        dataUrl: content => {
          return content.toString('base64');
        },
      }
    },
  ```

If you need webpack for a new project you are scaffolding with this site, specify the `--webpack` command-line option
when you scaffold your application, e.g.:

```
npx @fastly/compute-js-static-publish@latest --webpack --root-dir=./public
```

## Removal of Expressly

Previous versions of `@fastly/compute-js-static-publish` used [Expressly](https://expressly.edgecompute.app) to serve
assets. `v4` does away with this dependency and implements its own server in the `PublisherServer`
class.

When using `v4`, you can remove the dependency on Expressly by deleting the `@fastly/expressly` entry from
`dependencies` or `devDependencies`, in your `package.json` file.

If your application depended on Expressly for things like middleware, you will need to make further
changes.

### The entry point `src/index.js`

As of `v4`, the `src/index.js` entry point no longer uses Expressly, and looks like this:

```js
/// <reference types="@fastly/js-compute" />
import { getServer } from './statics.js';
const staticContentServer = getServer();

// eslint-disable-next-line no-restricted-globals
addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));
async function handleRequest(event) {

  const response = await staticContentServer.serveRequest(event.request);
  if (response != null) {
    return response;
  }

  // Do custom things here!
  // Handle API requests, serve non-static responses, etc.

  return new Response('Not found', { status: 404 });
}
```

If you've previously made changes to `src/index.js`, you will need to make the equivalent changes in this new format.

## `static-publish.rc.js`

This configuration file has changed in v4, and you may find that some features have stopped working after
upgrading from v3.

* In v3, the configuration object was typed `Config`. In v4, it is now typed with a more descriptive name, `StaticPublisherConfig`.

```js
/** @type {import('@fastly/compute-js-static-publish').StaticPublisherConfig} */
const config = {
  rootDir: './public',
  // ... and so on
};
```

* A new key, `server`, was added to group configurations that pertain to Publisher Server.

To migrate this file, you'll need to make the following changes:

* `publicDir` - rename this to `rootDir`. All files under this root directory will be included by default in the publishing,
  except for those that are excluded using some of the following features.
* `excludeDirs`, `includeDirs`, `excludeTest`, `moduleTest` - In v3, these were used in combination to determine whether
  each file would be included in the publishing, and whether files would be included as modules. The interaction between
  these four tests was not clearly defined, often having one option exclude files, only to have other options add them
  back. In addition, in v3 it was not possible to have a module asset that was not also already a content asset.
  In v4, these are more clearly defined. These four options should be rewritten in terms of
  `excludeDirs`, `excludeDotFiles`, `includeWellKnown`, `contentAssetInclusionTest`, and `moduleAssetInclusionTest`.
* `staticDirs` - in v4, this was renamed to `staticItems` and moved under the new `server` key.
* `spa` - in v4, this was renamed to `spaFile` and moved under the new `server` key.
* `notFoundPage` - in v4, this was renamed to `notFoundPageFile` and moved under the new `server` key.
* `autoExt` - in v4, this was moved under the new `server` key.
* `autoIndex` - in v4, this was moved under the new `server` key.
* `contentTypes` - This is unchanged.

See [static-publish.rc.js config file](./README.md#static-publish-rc) for a detailed explanation of each of these new values. 

* `.gitignore`

  Depending on the version of `compute-js-static-publisher` used to scaffold your application, your `.gitignore` file
  may have been generated with different entries. Add any of the following entries that may be missing from your
  `.gitignore` file:

  ```gitignore
  /src/statics.js
  /src/statics.d.ts
  /src/statics-metadata.js
  /src/statics-metadata.d.ts
  /src/static-content
  ```

* Build scripts
  * Various versions of `@fastly/compute-js-static-publish` have specified different build scripts. We recommend the following setup, regardless of the version of `@fastly/compute-js-static-publish` or Fastly CLI.

    * The build script listed in `fastly.toml` of your `compute-js` directory should look like this:
      ```toml
      [scripts]
      build = "npm run build"
      ```

    * If you're using webpack, then the `scripts` section of `package.json` of your `compute-js` directory should contain
      the following items (along with any other scripts):
      ```json
      {
          "prebuild": "npx @fastly/compute-js-static-publish --build-static && webpack",
          "build": "js-compute-runtime ./bin/index.js ./bin/main.wasm"
      }
      ```
 
    * If you're not using webpack, then the `scripts` section of `package.json` of your `compute-js` directory should
      contain the following items (along with any other scripts):
      ```json
      {
          "prebuild": "npx @fastly/compute-js-static-publish --build-static",
          "build": "js-compute-runtime ./src/index.js ./bin/main.wasm"
      }
      ```
