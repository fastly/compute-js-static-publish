# Static Publisher for JavaScript on Fastly Compute

Using a static site generator to build your website? Do you simply need to serve some static files? With `compute-js-static-publish`, now you can deploy and serve everything from Fastly's blazing-fast [Compute](https://developer.fastly.com/learning/compute/).

## Prerequisites

Node 18 or newer is required during the build step, as we now rely on its `experimental-fetch` feature.

## How it works

You have some HTML files, along with some accompanying CSS, JavaScript, image, and font files in a directory. Perhaps you've used a framework or static site generator to build these files.

Assuming the root directory that contains your static files is `./public`,

### 1. Run `compute-js-static-publish`

```shell
npx @fastly/compute-js-static-publish@latest --root-dir=./public
```

This will generate a Compute application at `./compute-js`. It will add a default `./compute-js/src/index.js` file that instantiates the [`PublisherServer`](#publisherserver) class and runs it to serve the static files from your project.

> [!TIP]
> This process creates a `./compute-js/static-publish.rc.js` to hold your configuration. This, as well as the other files created in your new Compute program at `./compute-js`, can be committed to source control (except for the ones we specify in `.gitignore`!) 

> [!IMPORTANT]
> This step generates an application that includes your files and a program that serves them, and needs to be run only once. To make modifications to your application, simply make changes to your static files and rebuild it. Read the rest of this section for more details.

### 2. Test your application locally

The `start` script builds and runs your application using [Fastly's local development server](https://developer.fastly.com/learning/compute/testing/#running-a-local-testing-server).

```shell
cd ./compute-js
npm install
npm run start
```

The build process scans your `./public` directory to generate files in the `./compute-js/static-publisher` directory. These files are packaged into your application's Wasm binary.

Once your application is running, your files will be served under `http://127.0.0.1:7676/` at the corresponding paths relative to the `./public` directory. For example, making a request to `http://127.0.0.1:7676/foo/bar.html` will attempt to serve the file at `./public/foo/bar.html`.

### 3. Make changes to your application

Now, you're free to make changes to your static files. Add, modify, or remove files in the `./public` directory, and then re-build and re-run your application by typing `npm run start` again.

Each time you re-build the project, `compute-js-static-publish` will re-scan your `./public` directory and regenerate the files in the `./compute-js/static-publisher` directory.

> [!TIP]
> You can make further customizations to the behavior of your application, such as specifying directories of your static files, specifying whether to use GZIP compression on your files, specifying custom MIME types of your files, and more. You can also run custom code alongside the default server behavior, or even access the contents of the files directly from custom code. See [Advanced Usages](#advanced-usages) below for details. Rebuilding will not modify the files in your `./compute-js/src` directory, so feel safe making customizations to your code.

### 4. When you're ready to go live, deploy your Compute service

The `deploy` script builds and [publishes your application to a Compute service in your Fastly account](https://developer.fastly.com/reference/cli/compute/publish/).

```shell
npm run deploy
```

## Features

- Simple to set up, with a built-in server module.
- Or, make file contents directly available to your application, so you can write your own server.
- Content and metadata are available to your application, accessible by files' pre-package file paths.
- Brotli and Gzip compression.
- Support for `If-None-Match` and `If-Modified-Since` request headers.
- Optionally use Webpack as a module bundler.
- Selectively serve files from Fastly's [KV Store](#kv-store), or embedded into your Wasm module.
- Supports loading JavaScript files as code into your Compute application.
- Presets for several static site generators.

Some of these features are new! If you wish to update to this version, you may need to re-scaffold your application, or follow the steps outlined in [MIGRATING.md](./MIGRATING.md).

## How does it work? Where are the files?

Once your application is scaffolded, `@fastly/compute-js-static-publish` integrates into your development process by
running as part of your build process.

The files you have configured to be included (`--root-dir`) are enumerated and prepared. Their contents are included into
your Wasm binary (or made available via [KV Store](#kv-store), if so configured). This process is called "publishing".

Once the files are published, they are available to the other source files in the Compute application. For example,
the stock application runs the [PublisherServer](#publisherserver) class to serve these files.

For more advanced uses, such as accessing the contents of these file in your application, see the
[Using the packaged objects in your own application](#using-published-assets-in-your-own-application) section below.

Publishing is meant to run each time before building your Compute application into a Wasm file.
If the files in `--root-dir` have changed, then a new set of files will be published.

### Content Compression

During publishing, this tool supports pre-compression of content. By default, your assets are compressed using the Brotli
and gzip algorithms, and then stored alongside the original files in your Wasm binary (or [KV Store](#kv-store)).

> [!IMPORTANT]
> By default, pre-compressed content assets are not generated when the KV Store is not used.
This is done to prevent the inclusion multiple of copies of each asset from making the Wasm binary too large.
If you want to pre-compress assets when not using KV Store, add a value for 'contentCompression' to your
`static-publish.rc.js` file.

## CLI options

Except for `--root-dir`, most arguments are optional.

```shell
npx @fastly/compute-js-static-publish \
    --root-dir=./build \
    --public-dir=./build/public \
    --static-dir=./build/public/static \
    --output=./compute-js \
    --spa=./build/spa.html
```

If you provide options, they override the defaults described below.

Any configuration options will be written to a `static-publish.rc.js` file, and used each time you build your Compute
application.

On subsequent builds of your Compute application, `compute-js-static-publish` will run with a special flag, `build-static`,
reading from stored configuration, then scanning the `--public-dir` directory to recreate `./compute-js/static-publisher/statics.js`.

Any relative file and directory paths passed at the command line are handled as relative to the current directory.

### Publishing options:

| Option                      | Default                                  | Description                                                                                                                                              |
|-----------------------------|------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| `--preset`                  | (None)                                   | Apply default options from a specified preset. See ["Frameworks and Static Site Generators"](#usage-with-frameworks-and-static-site-generators).         |
| `--output`                  | `./compute-js`                           | The directory in which to create the Compute application.                                                                                                |
| `--static-content-root-dir` | (output directory) + `/static-publisher` | The directory under the Compute application where static asset and metadata are written.                                                                 |
| `--root-dir`                | (None)                                   | **Required**. The root of the directory that contains the files to include in the publishing. All files you wish to include must reside under this root. |

### Server options:

Used to populate the `server` key under `static-publish.rc.js`. 

| Option             | Default                 | Description                                                                                                                                                                                              |
|--------------------|-------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `--public-dir`     | <root-dir>              | The directory that contains your website's public files.                                                                                                                                                 |
| `--static-dir`     | (None)                  | Any directories under `--public-dir` that contain the website's static assets that will be served with a very long TTL. You can specify as many such directories as you wish, by listing multiple items. |
| `--auto-ext`       | `.html,.htm`            | Specify automatic file extensions.                                                                                                                                                                       |
| `--auto-index`     | `index.html,index.htm`  | Specify filenames for automatically serving an index file.                                                                                                                                               |
| `--spa`            | (None)                  | Path to a fallback file for SPA applications.                                                                                                                                                            |
| `--not-found-page` | `<public-dir>/404.html` | Path to a fallback file for 404 Not Found.                                                                                                                                                               |

See [PublisherServer](#publisherserver) for more information about these features.

For backwards compatibility, if you do not specify a `--root-dir` but you have provided a `--public-dir`, then that value is used for `--root-dir`.

Note that the files referenced by `--spa` and `--not-found-page` do not necessarily have to reside inside `--public-dir`.

### Fastly service options

These arguments are used to populate the `fastly.toml` and `package.json` files of your Compute application.

| Option            | Default                                                      | Description                                                                                                                                                                                                                                 |
|-------------------|--------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `--name`          | `name` from `package.json`, or `compute-js-static-site`      | The name of your Compute application.                                                                                                                                                                                                       |
| `--description`   | `description` from `package.json`, or `Compute static site`  | The description of your Compute application.                                                                                                                                                                                                |
| `--author`        | `author` from `package.json`, or `you@example.com`           | The author of your Compute application.                                                                                                                                                                                                     |
| `--service-id`    | (None)                                                       | The ID of an existing Fastly WASM service for your Compute application.                                                                                                                                                                     |
| `--kv-store-name` | (None)                                                       | The name of an existing [Fastly KV Store](https://developer.fastly.com/learning/concepts/data-stores/#kv-stores) to hold the content assets. In addition to already existing, it must be linked to the service specified by `--service-id`. |

## Usage with frameworks and static site generators

`compute-js-static-publish` supports preset defaults for a number of frameworks and static site generators:

| `--preset`                    | `--root-dir` | `--static-dir`   | Notes                                                                                                                               |
|-------------------------------|--------------|------------------|-------------------------------------------------------------------------------------------------------------------------------------|
| `cra` (or `create-react-app`) | `./build`    | `./build/static` | For apps written using [Create React App](https://create-react-app.dev). Checks for a dependency on `react-scripts`.                |
| `cra-eject`                   | `./build`    | `./build/static` | For apps written using Create React App, but which have since been ejected via `npm run eject`. Does not check for `react-scripts`. |
| `vite`                        | `./dist`     | (None)           | For apps written using [Vite](https://vitejs.dev).                                                                                  |
| `sveltekit`                   | `./dist`     | (None)           | For apps written using [SvelteKit](https://kit.svelte.dev).                                                                         |
| `vue`                         | `./dist`     | (None)           | For apps written using [Vue](https://vuejs.org), and that were created using [create-vue](https://github.com/vuejs/create-vue).     |
| `next`                        | `./out`      | (None)           | For apps written using [Next.js](https://nextjs.org), using `npm run export`. *1                                                    |
| `astro`                       | `./dist`     | (None)           | For apps written using [Astro](https://astro.build) (static apps only). *2                                                          |
| `gatsby`                      | `./public`   | (None)           | For apps written using [Gatsby](https://www.gatsbyjs.com).                                                                          |
| `docusaurus`                  | `./build`    | (None)           | For apps written using [Docusaurus](https://docusaurus.io)                                                                          |

You may still override any of these options individually.

*1 - For Next.js, consider using `@fastly/next-compute-js`, a Next.js server implementation that allows you to run
   your Next.js application on Compute.

*2 - Astro support does not support SSR.

## PublisherServer

`PublisherServer` is a simple yet powerful server that can be used out of the box to serve the files prepared by this tool.

This server handles the following automatically:

* Maps the path of your request to a path under `--public-dir` and serves the content of the asset
* Sources the content from the content packaged in the Wasm binary, or from the [KV Store](#kv-store), if configured.
* Applies long-lived cache headers to files served from `--static-dir` directories. Files under these directories will be cached by the browser for 1 year. (Use versioned or hashed filenames to avoid serving stale assets.)
* Performs Brotli and gzip compression as requested by the `Accept-Encoding` headers.
* Provides `Last-Modified` and `ETag` response headers, and uses them with `If-Modified-Since` and `If-None-Match` request headers to produce `304 Not Modified` responses.
* If an exact match is not found for the request path, applies automatic extensions (e.g., `.html`) and automatic index files (e.g., `index.html`).
* Can be configured to serve a fallback file for SPA apps. Useful for apps that use [client-side routing](https://create-react-app.dev/docs/deployment#serving-apps-with-client-side-routing).
* Can be configured to serve a 404 not found file.
* Returns `null` if nothing matches, so that you can add your own handling if necessary.

During initial scaffolding, the configuration based on the command-line parameters and preset are written to your `./static-publisher.rc.js` file under the `server` key.

### Configuring PublisherServer

You can further configure the server by making modifications to the `server` key under `./static-publisher.rc.js`.

| Key                | Default            | Description                                                                                                                                                                                                                          |
|--------------------|--------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `publicDirPrefix`  | `''`               | Prefix to apply to web requests. Effectively, a directory within `rootDir` that is used by the web server to determine the asset to respond with.                                                                                    |
| `staticItems`      | `[]`               | A test to apply to item names to decide whether to serve them as "static" files, in other words, with a long TTL. These are used for files that are not expected to change. They can be provided as a string or array of strings.    |
| `compression`      | `[ 'br', 'gzip' ]` | If the request contains an `Accept-Encoding` header, they are checked for the values listed here. The compression algorithm that produces the smallest transfer size is applied.                                                     |
| `autoExt`          | `[]`               | When a file is not found, and it doesn't end in a slash, then try auto-ext: we try to serve a file with the same name post-fixed with the specified strings, tested in the order listed. These are tested before auto-index, if any. |
| `autoIndex`        | `[]`               | When a file is not found, then try auto-index: we treat it as a directory, then try to serve a file that has the specified strings, tested in the order listed.                                                                      |
| `spaFile`          | `null`             | Asset key of a content item to serve with a status code of `200` when a GET request comes arrives for an unknown asset, and the Accept header includes text/html.                                                                    |
| `notFoundPageFile` | `null`             | Asset key of a content item to serve with a status code of `404` when a GET request comes arrives for an unknown asset, and the Accept header includes text/html.                                                                    |

For `staticItems`:
* Items that contain asterisks are interpreted as glob patterns (for example, `/public/static/**/*.js`)
* Items that end with a trailing slash are interpreted as a directory name.
* Items that don't contain asterisks and that do not end in slash are checked for exact match.

For `compression`, the following values are allowed:
* `'br'` - Brotli
* `'gzip'` - Gzip

## Associating your project with a Fastly Service

The project created by this tool is a Fastly Compute JavaScript application, complete with a `fastly.toml` file that
describes your project to the Fastly CLI.

To deploy your project to production, you deploy it to a [Fastly service](https://developer.fastly.com/reference/glossary#term-service)
in your account. Usually, you create your service automatically as part of your first deployment of the project.

In this case, `fastly.toml` has no value for `service_id` at the time you deploy, so the Fastly CLI will prompt
you to create a Fastly service in your account, after which it will save the new service's ID to your `fastly.toml` file.

Alternatively, you may deploy to a service that already exists. You can create this service using the
[Fastly CLI](https://developer.fastly.com/reference/cli/service/create/) or the [Fastly web app](https://manage.fastly.com/).
Note that since this is a Compute application, the service must be created as a Wasm service.

Before deploying your application, specify the service by setting the `service_id` value in the `fastly.toml` file to the
ID of the service. The Fastly CLI will deploy to the service identified by this value.

To specify the service at the time you are scaffolding the project (for example, if you are running this tool and deploying
as part of a CI process), specify the `--service-id` command line argument to populate `fastly.toml` with this value.

## Using the KV Store (BETA)

<div id="kv-store"></div>

Starting with v4, it's now possible to upload assets to and serve them from a [Fastly KV Store](https://developer.fastly.com/learning/concepts/data-stores/#kv-stores).

When this mode is enabled, you build your application as normal, and as a step during the build, your files
are uploaded to the Fastly KV Store, and metadata in the application is marked to source them from there instead
of from bytes in the Wasm binary.

You can enable the use of KV Store with `@fastly/compute-js-static-publish` as you scaffold your application, or
at any later time.

At the time you enable the use of KV Store:

* Your Fastly service must already exist. See [Associating your project with a Fastly Service](#associating-your-project-with-a-fastly-service) above.

* Your KV Store must already exist under the same Fastly account, and be linked to the service.
   As of this writing, to create the KV Store you will need to use either the Fastly CLI [fastly kv-store create](https://developer.fastly.com/reference/cli/kv-store/create/)
   or the Fastly [KV Store API](https://developer.fastly.com/reference/api/services/resources/kv-store/#create-store).
   Once the KV Store is created, you must link it to your Fastly service using the [Resource API](https://developer.fastly.com/reference/api/services/resource/#create-resource).

   ```shell
   # Create a KV Store
   $ curl -i -X POST "https://api.fastly.com/resources/stores/kv" -H "Fastly-Key: YOUR_FASTLY_TOKEN" -H "Content-Type: application/json" -H "Accept: application/json" -d '{"name":"example-store"}'
   
   # Link the KV Store to a service
   $ curl -i -X POST "https://api.fastly.com/service/YOUR_FASTLY_SERVICE_ID/version/YOUR_FASTLY_SERVICE_VERSION/resource" -H "Fastly-Key: YOUR_FASTLY_TOKEN" -H "Content-Type: application/x-www-form-urlencoded" -H "Accept: application/json" -d "name=example-store-service-a&resource_id=YOUR_KV_STORE_ID"
   ```

   Once the KV Store is created and linked to your service, add its name to your `static-publish.rc.js`
   file under the `kvStoreName` key.

   To specify the KV Store at the time you are scaffolding the project (for example, if you are running this tool and
   deploying as part of a CI process), specify the `--service-id` and `--kv-store-name` command line arguments to populate
   the respective files with these values.

After you have performed the above steps, go ahead and build your application as normal.
As a new step during the build process, the tool will send these files to the KV Store.

> [!IMPORTANT]
> This step writes to your KV Store. When building your application, you must set the environment variable `FASTLY_API_TOKEN` to a Fastly API token that has access to write to this KV Store.
> 
> Alternatively, if this environment variable is not found, the tool will attempt to detect an API token by calling `fastly profile token`. 

> [!TIP]
> By running `npx @fastly/cli compute build --verbose` (or `npm run build` directly), you should see output in your logs saying that files are being sent to the KV Store.

The `statics-metadata.js` file should now show `"type": "kv-store"` for content assets.
Your Wasm binary should also be smaller, as the content of the files are no longer inlined in the build artifact.
You can deploy this and run it from Fastly, and the referenced files will be served from KV Store.

You will also see entries in `fastly.toml` that represent the local KV Store.
These enable the site to also run correctly when served using the local development environment. 

### Cleaning unused items from KV Store

The files that are uploaded to the KV Store are submitted using keys of the following format:

`<publish-id>:<asset-path>_<alg>_<hash>`

For example:
`12345abcde67890ABCDE00:/public/index.html_br_aeed29478691e67f6d5s36b4ded20c17e9eae437614617067a8751882368b965`

Using such a key ensures that whenever the file contents are identical, the same key will be generated.  
This enables to detect whether an unchanged file already exists in the KV Store, avoiding having to re-submit
files that have not changed. If the file contents have changed, then a new hash is generated. This ensures that
even during the brief amount of time between deploys, any request served by a prior version will still serve the same
corresponding previous version of the content.

However, this system never deletes files automatically. After many deployments, extraneous files may be left over.

`@fastly/compute-js-static-publish` includes a feature to delete these old versions of the files that are no longer being
used.  To run it, type the following command:

`npx @fastly/compute-js-static-publish --clean-kv-store`

It works by scanning `statics-metadata.js` for all currently-used keys. Then it enumerates all the existing
keys in the configured KV Store and that belong to this application (can do so by narrowing down all keys to the ones
that begin with the "publish id"). If any of the keys is not in the list of currently-used keys, then a request is made
to delete that KV Store value.

And that's it! It should be possible to run this task to clean up once in a while. 

## Advanced Usages

### The `static-publish.rc.js` config file <a name="static-publish-rc"></a>

* `rootDir` - All files under this root directory will be included by default in the publishing,
  except for those that are excluded using some of the following features. Files outside this root cannot be
  included in the publishing.

* `staticContentRootDir` - Static asset loader and metadata files are created under this directory.
  For legacy compatibility, if not provided, defaults to `'./src'`.

* `kvStoreName` - Set this value to the _name_ of an existing KV Store to enable uploading of content assets
  to Fastly KV Store. See [Using the KV Store](#kv-store) for more information.

* `excludeDirs` - Specifies names of files and directories within `rootDir` to exclude from the publishing. Each entry can
  be a string or a JavaScript `RegExp` object.  Every file and directory under `rootDir` is checked against each entry of
  the array by testing its path relative to `rootDir`. The file or directory (included all children) and excluded if the
  condition matches:
  * If a string is specified, then an exact match is checked.
  * If a `RegExp` is specified, then it is tested with the regular expression.
  * If this setting is not set, then the default value is `['./node_modules']`.
  * If you specifically set this to the empty array, then no files are excluded by this mechanism.

* `excludeDotfiles` - Unless disabled, will exclude all files and directories (and their children)
  whose names begin with a `'.''`. This is `true` by default.

* `includeWellKnown` - Unless disabled, will include a file or directory called `.well-known`
  even if `excludeDotfiles` would normally exclude it. This is `true` by default.

* `contentAssetInclusionTest` - Optionally specify a test function that can be run against each enumerated asset during
  the publishing, to determine whether to include the asset as a content asset. For every file, this function is passed
  the [asset key](#asset-keys), as well as its content type (MIME type string). You may return one of three values from
  this function:
  * Boolean `true` - Include the file as a content asset in this publishing. Upload the file to and serve it from the
    KV Store if KV Store mode is enabled, or include the contents of the file in the Wasm binary if KV Store
    mode is not enabled.
  * String `"inline"` - Include the file as a content asset in this publishing. Include the contents of the file in the
    Wasm binary, regardless of whether KV Store mode is enabled.
  * Boolean `false` - Do not include this file as a content asset in this publishing.

  If you do not provide a function, then every file will be included in this publishing as a content asset, and their
  contents will be uploaded to and served from the KV Store if KV Store mode is enabled, or included in the Wasm
  binary if KV Store mode is not enabled.

* `contentCompression` - During the publishing, the tool will pre-generate compressed versions of content assets in these
  formats and make them available to the Publisher Server or your application. Default value is [ 'br' | 'gzip' ] if
  KV Store is enabled, or [] if KV Store is not enabled.

* `moduleAssetInclusionTest` - Optionally specify a test function that can be run against each enumerated asset during
  the publishing, to determine whether to include the asset as a module asset. For every file, this function is passed
  the [asset key](#asset-keys), as well as its content type (MIME type string). You may return one of three values from this function:
  * `true` (boolean) - Include the file as a module asset in this publishing.
  * `"static-import"` (string) - Include the file as a module asset in this publishing, and statically import it. This causes
    any top-level code in these modules to run at application initialization time.
  * `false` (boolean) - Do not include this file as a module asset in this publishing.

  If you do not provide a function, then no module assets will be included in this publishing.

* `contentTypes` - Provide custom content types and/or override them.

  This tool comes with a [default set of content types](./src/util/content-types.ts) defined for many common
  file extensions. This list can be used to add to and/or override items in the default list.
  Content type definitions are checked in the provided order, and if none of them match, the default content types are
  tested afterward.

  Provide these as an array of content type definition objects, each with the following keys and values:
  * `test` - a RegExp or function to perform on the asset key. If the test succeeds, then the content asset is considered
    to be of this content type definition.
  * `contentType` - The content type header to apply when serving an asset of this content type definition.
  * `text` - If `true`, this content type definition is considered to contain textual data. This makes `.text()` and `.json()`
    available for calling on store entries. If not specified, this is treated as `false`.

  For example, to add a custom content type `application/x-custom` for files that have a `.custom` extension, and not treat
  it as a text file, add the following to your `static-publish.rc.js` file:

    ```javascript
    const config = {
      /* ... other config ... */
      contentTypes: [
        { test: /\.custom$/, contentType: 'application/x-custom', text: false },
      ],
    };
    ```

  > Note that content types are tested at publishing time, not at runtime.

* `server` - [Configuration of `PublisherServer()`](#configuring-publisherserver).  
  above.

### Running custom code alongside Publisher Server

The generated `./src/index.js` program instantiates the server and simply asks it to respond to a request.

You are free to add code to this file.

For example, if the `PublisherServer` is unable to formulate a response to the request, then it returns `null`. You may
add your own code to handle these cases, such as to provide custom responses.

```js
import { getServer } from './statics.js';
const staticContentServer = getServer();

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

### Using published assets in your own application

Publishing, as described earlier, is the process of preparing files for inclusion into your application.
This process also makes metadata available about each of the files that are included, such as its content type, the last
modified date, the file hash, and so on.

The [`PublisherServer` class](#publisherserver) used by the default scaffolded application is a simple application of this content
and metadata. By importing `./statics.js` into your Compute application, you can just as easily access this
information about the assets that were included during publishing.

> IMPORTANT: Use a static `import` statement, rather than using `await import()` to load `./statics.js`, in order to
ensure that its top-level code runs during the initialization phase of your Compute application. 

#### Assets

There are two categories of assets: Content Assets and Module Assets.

* A Content Asset is a type of asset where your application or a user of your application is interested in the text or 
binary contents of an asset.

  The data of each content asset can exist in one of two stores:
  * Inline Store - this is a data store that exists within the Wasm binary.
  * Fastly KV Store - Fastly's distributed edge data store. Data can be placed here without impacting the size of
    your Wasm binary.

  Your application can stream the contents of these assets to a visitor, or read from the stream itself and access its
  contents.

* A Module Asset is a type of asset where your application wants to load the asset as a module, and use it as part of its
running code. Their contents are actually built at publishing time and their built representation is included in the Wasm
binary. They can be imported statically at will, and your application is able to execute the code exported by these modules.

##### Asset Keys

When working with content assets or module assets from your application, they are referenced by their asset key, which
is the relative path of the file from `rootDir`, including the leading slash.

#### Content Assets

You can obtain the content assets included in publishing by importing the `contentAssets` object exported from
`./statics.js`.

```js
import { contentAssets } from './statics';

// Obtain a content asset named '/public/index.html'
const asset = contentAssets.getAsset('/public/index.html');

// 'wasm-inline' if object's data is 'inlined' into Wasm binary
// 'kv-store' if object's data exists in Fastly KV Store
asset.type;

// Get the "store entry"
const storeEntry = await asset.getStoreEntry();

storeEntry.contentEncoding; // null, 'br', 'gzip'
storeEntry.hash; // SHA256 of the contents of the file
storeEntry.size; // Size of file in bytes
```

Regardless of which store these objects come from, they implement the `Body` interface as defined by `@fastly/js-compute`.
As such, you are able to work with them in the same way to obtain their contents:

```js
storeEntry.body; // ReadableStream<Uint8Array>
storeEntry.bodyUsed; // true if consumed or distrubed

// Get the data as ArrayBuffer, parsed JSON, or string
// The latter two are only available if the data is a text type
const arrayBuffer = await storeEntry.arrayBuffer();
const json = await storeEntry.json();
const text = await storeEntry.text();
```

Or, if you don't care about the contents but just want to stream it to the visitor, you can pass the `.body` field directly
to the Response constructor:

```js
const response = new Response(storeEntry.body, { status: 200 });
```

> IMPORTANT: Once a store entry is consumed, its body cannot be read from again. If you need to access the contents of the
same asset more than once, you may obtain another store entry, as in the following example:
```js
import { contentAssets } from './statics';
const asset = contentAssets.getAsset('/public/index.html');
const entry1 = await asset.getStoreEntry(); // Get a new store entry
const json1a = await entry1.json();
const json1b = await entry1.json(); // Can't do this, the body has already been consumed!

const entry2 = await asset.getStoreEntry(); // Get a new store entry for same asset
const json2a = await entry2.json(); // This will work.
```

#### Module Assets

Module assets are useful when an asset includes executable JavaScript code that you may want to execute at runtime.

You can obtain the module assets included in publishing by importing the `moduleAssets` object exported from
`./statics.js`. Keep in mind that by default, no modules are included in `moduleAssets`. If you wish to include module
assets, you must configure your publishing to include them.  See [`moduleAssetInclusionTest` in the `static-publish.rc.js`
config file](#static-publish-rc) for more details.

`/module/hello.js`
```js
export function hello() {
  console.log('Hello, World!');
}
```

```js
import { moduleAssets } from './statics';

// Obtain a module asset named '/module/hello.js'
const asset = contentAssets.getAsset('/module/hello.js');

// Load the module
const helloModule = await asset.getModule();

helloModule.hello(); // Will print "Hello, World!"
```

#### Metadata

In some use cases, you may have a use case where you need to know about the files that were included during publishing,
but not in the context of Compute. (e.g., a tool that runs in Node.js that performs some maintenance task on assets).

You cannot import `./statics.js` from a Node.js application, as it holds dependencies on Compute.

Instead, you can import `./statics-metadata.js`, a companion file that is generated in the same directory. This file
exposes plain JavaScript objects that contain the metadata about your content assets that were included in the final
publishing event.

See the definition of `ContentAssetMetadataMapEntry` in the [`types/content-assets` file](./src/types/content-assets.ts) for more details.

### Using Webpack

As of v4, Webpack is no longer required, and is no longer part of the default scaffolded application.
If you wish to use some features of Webpack, you may include Webpack in your generated application by specifying
`--webpack` at the command line.

## Migrating

See [MIGRATING.md](./MIGRATING.md).

## Issues

If you encounter any non-security-related bug or unexpected behavior, please [file an issue][bug].

[bug]: https://github.com/fastly/compute-js-static-publish/issues/new?labels=bug

### Security issues

Please see our [SECURITY.md](./SECURITY.md) for guidance on reporting security-related issues.

## License

[MIT](./LICENSE).
