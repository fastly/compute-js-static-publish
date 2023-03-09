# Migration Guide

When we update `@fastly/compute-js-static-publish` to a new major version, sometimes we make changes to the files that
are generated during scaffolding. For this reason, if possible we recommended that you re-scaffold your application.

This is pretty simple if you've been using your `compute-js-static-publisher` application without modification, but we
know that's not always possible, so the following is provided to help you overcome any breaking changes.

# Migrating to v4

## Webpack

Starting with `v4.0.0` of this tool, Webpack is no longer required, and is disabled by default for new applications
scaffolded using it. This can simplify your development and give you quicker build times. However, you may still wish
to use Webpack if you need some of the features it provides, such as the ability to use loaders, asset modules, module
replacement, dynamic imports, etc.

If you have an application that you wish to migrate away from Webpack, you can do so by making the following changes
in your `./compute-js` directory:

* First, make sure you aren't actually depending on any of the features that Webpack provides. You can refer to your
  `webpack.config.js` file to see if it is doing anything fancy. When you're sure you're ready, continue to the next
  step.
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

If you aren't moving away from Webpack just yet, check that your `webpack.config.js` is up-to-date:

* Starting `v3.0.0`, we depend on `v1.0.0` of the `js-compute` library, which provides namespaced exports for Fastly
  features. To use them, you'll need to add a new `externals` array to the bottom if it doesn't exist already, and add
  the following entry:

  ```javascript
  module.exports = {
    /* ... other config ... */
    externals: [
      ({request,}, callback) => {
         if (/^fastly:.*$/.test(request)) {
             return callback(null, 'commonjs ' + request);
         }
         callback();
      }
    ],
  }
  ```

* Starting `v3.0.0`, we no longer use Webpack static assets to include the contents of static files, and instead [use the
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

If you need Webpack for a new project you are scaffolding with this site, then specify the `--webpack` command-line option
when you scaffold your application, e.g.:

```
npx @fastly/compute-js-static-publish@latest --webpack --root-dir=./public
```

## Removal of Expressly

Previous versions of `@fastly/compute-js-static-publish` used [Expressly](https://expressly.edgecompute.app) to serve
assets. This version no longer depends on that library, an order to implement its own server in the `PublisherServer`
class.

When using v4, you can remove Expressly from the dependencies:

* In your `package.json` file:
  * Under `dependencies` or `devDependencies`, remove the `@fastly/expressly` entry.

This does mean that if your application was depending on Expressly for things like middleware, you will need to make some
changes.

## The entry point `src/index.js`

As of v4, with Expressly no longer being used, the stock `src/index.js` file looks like this:

```js
/// <reference types="@fastly/js-compute" />

import { getServer } from './statics.js';
const server = getServer();

// eslint-disable-next-line no-restricted-globals
addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));
async function handleRequest(event) {

  const response = await server.serveRequest(event.request);

  if (response != null) {
    return response;
  }

  return new Response('Not found', { status: 404 });
}
```

If you had made your own changes to `src/index.js`, you will need to make the equivalent changes in this new format.

## `static-publish.rc.js`

This configuration file has changed a bit in v4, and you may find that some features simply do not continue work after
upgrading from v3.

* In v3, the configuration object was typed `Config`. In v4, it is now typed with a more descriptive name, `StaticPublisherConfig`.

```js
/** @type {import('@fastly/compute-js-static-publish').StaticPublisherConfig} */
export default {
  rootDir: './public',
  // ... and so on
};
```

* A new key, `server`, has been added to group configurations that pertain to Publisher Server.

To migrate this file, you'll need to make the following changes:

* `publicDir` - rename this to `rootDir`. All files under this root directory will be included by default in the publishing,
  except for those that are excluded using some of the following features.
* `excludeDirs`, `includeDirs`, `excludeTest`, `moduleTest` - In v3, these were used in combination to determine whether
  each file would be included in the publishing, and whether files would be included as modules. The interaction between
  these four tests was not clearly defined, often having one option exclude files, only to have other options add them
  back. In addition, in v3 it was not possible to have a module asset that was not also already a content asset.
  In v4, these are more clearly defined. These four options should be rewritten in terms of
  `excludeDirs`, `excludeDotFiles`, `includeWellKnown`, `contentAssetInclusionTest`, and `moduleAssetInclusionTest`.
* `staticDirs` - in v4, this has been renamed to `staticItems` and moved under the new `server` key.
* `spa` - in v4, this has been renamed to `spaFile` and moved under the new `server` key.
* `notFoundPage` - in v4, this has been renamed to `notFoundPageFile` and moved under the new `server` key.
* `autoExt` - in v4, this has been moved under the new `server` key.
* `autoIndex` - in v4, this has been moved under the new `server` key.
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
  * Various versions of `@fastly/compute-js-static-publish` have specified different build scripts. At the current time,
    the following is the recommended setup, regardless of the version of `@fastly/compute-js-static-publish` or Fastly CLI.

    * The build script listed in `fastly.toml` of your `compute-js` directory should look like this:
      ```toml
      [scripts]
      build = "npm run build"
      ```

    * If you're using Webpack, then the `scripts` section of `package.json` of your `compute-js` directory should contain
      the following items (along with any other scripts that may have):
      ```json
      {
          "prebuild": "npx @fastly/compute-js-static-publish --build-static && webpack",
          "build": "js-compute-runtime ./bin/index.js ./bin/main.wasm"
      }
      ```
 
    * If you're not using Webpack, then the `scripts` section of `package.json` of your `compute-js` directory should
      contain the following items (along with any other scripts that may have):
      ```json
      {
          "prebuild": "npx @fastly/compute-js-static-publish --build-static",
          "build": "js-compute-runtime ./src/index.js ./bin/main.wasm"
      }
      ```
