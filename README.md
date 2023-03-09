PRO TIP - If you are viewing this README in GitHub, click the hamburger menu on the row right above this to see a Table
of Contents!

# Static Publisher for JavaScript on Compute@Edge

Using a static site generator to build your website? Do you simply need to serve some static files? With `compute-js-static-publish`, now you can deploy and serve everything from Fastly's blazing-fast [Compute@Edge](https://developer.fastly.com/learning/compute/).

## New! Version 4

Version 4 of this tool has some awesome new features:
  - Support for optionally serving files from Fastly's [Object Store](https://www.fastly.com/blog/introducing-the-compute-edge-object-store-global-persistent-storage-for-compute-functions) instead of bundling them into the Wasm module. See [Object Store](#object-store) below for more information.
  - Your scaffolded application no longer uses a bundler by default, making the use of Webpack optional
  - Brotli and Gzip compression
  - Support for returning `304 Not Modified` status based on `If-None-Match` and `If-Modified-Since` request headers
  - `PublisherServer` class to map incoming requests to asset paths
  - Ability to include files in the publishing that won't necessarily be served by `PublisherServer`. The content of these files are available to your application and may be useful for reading data written by third-party tools, etc.
  - Makes content and metadata available to your application, giving your applications access to their content by their pre-package path/file
  - Even load JavaScript files as code into your Compute@Edge JavaScript application

If you wish to update to this version, you may need to re-scaffold your application, or follow the migrations steps outlined in [MIGRATING.md](./MIGRATING.md).

## Prerequisites

Node 18 or newer is required during the build step, as we now rely on its `experimental-fetch` feature.

## How it works

You have some HTML files, along with some accompanying CSS, JavaScript, image, and font files in a directory. Perhaps you've used a framework or static site generator to build these files.

Assuming the root of your output directory is `./public`,

### 1. Run `compute-js-static-publish`

```shell
npx @fastly/compute-js-static-publish@latest --root-dir=./public
```

This will generate a Compute@Edge application at `./compute-js`. It will add a default `./src/index.js` file that instantiates the `PublisherServer` class and runs it to serve the static files from your project.

> This process creates a `./static-publish.rc.js` to hold your configuration. This, as well as the other files created in your new Compute@Edge program at `./compute-js`, can be committed to source control (except for the ones we specify in `.gitignore`!) 

Now, each time you build this Compute@Edge project, `compute-js-static-publish` will re-scan your `./public` directory and regenerate `/src/statics-metadata.js` and `/src/statics.js`. These files hold references to your project's public files.

### 2. Test your application using [Fastly's local development server](https://developer.fastly.com/learning/compute/testing/#running-a-local-testing-server)

```shell
cd ./compute-js
npm install
fastly compute serve
```

This will serve your application using the default `PublisherServer()`.

However, you can modify `/src/index.js` to add your own processing as you need. This file will not be overwritten after it is created.

### 3. When you're ready to go live, [deploy your Compute@Edge service](https://developer.fastly.com/reference/cli/compute/publish/)

```shell
fastly compute publish
```

## How does it work? Where are the files?

Once your application is scaffolded, `@fastly/compute-js-static-publish` integrates into your development process by
running as part of your build process.

The files you have configured to be included (`--root-dir`) are enumerated and prepared. Their contents are included into
your Wasm binary (or made available via Object Store, if so configured). This process is called "publishing".

Once the files are published, they are available to the other source files in the Compute@Edge application. For example,
the stock application simply runs the [PublisherServer](#publisherserver) class to serve up these files.

For more advanced uses, such as accessing the contents of these file in your own application, see the
[Using the packaged objects in your own application](#using-published-assets-in-your-own-application) section below.

Publishing is meant to run each time before building your Compute@Edge application into a Wasm file.
If the files in `--root-dir` have changed, then a new set of files will be published.

## CLI options

Most arguments are optional, and if provided, override the defaults described below.

```shell
npx @fastly/compute-js-static-publish \
    --root-dir=./build \
    --root-dir=./build/public \
    --static-dir=./build/public/static \
    --output=./compute-js \
    --spa=./build/spa.html
```

Any configuration options will be written to a `static-publish.rc.js` file, and used each time you build your Compute@Edge
application.

On subsequent builds of your Compute@Edge application, `compute-js-static-publish` will run with a special flag, `build-static`,
reading from stored configuration, then scanning the `--public-dir` directory to recreate `./src/statics.js`.

Any relative file and directory paths passed at the command line are handled as relative to the current directory.

### Publishing options:

| Option           | Default                 | Description                                                                                                                                                                                                                                                                                              |
|------------------|-------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `preset`         | (None)                  | Apply default options from a specified preset. See ["Frameworks and Static Site Generators"](#usage-with-frameworks-and-static-site-generators).                                                                                                                                                         |
| `output`         | `./compute-js`          | The directory in which to create the Compute@Edge application.                                                                                                                                                                                                                                           |
| `root-dir`       | (None)                  | **Required**. The root of the directory that contains the files to include in the publishing. All files you wish to include must reside under this root.                                                                                                                                                 |

### Server options:

Used to populate the `server` key under `static-publish.rc.js`. 

| Option           | Default                 | Description                                                                                                                                                                                              |
|------------------|-------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `public-dir`     | <root-dir>              | The directory that contains your website's public files.                                                                                                                                                 |
| `static-dir`     | (None)                  | Any directories under `--public-dir` that contain the website's static assets that will be served with a very long TTL. You can specify as many such directories as you wish, by listing multiple items. |
| `auto-ext`       | `.html,.htm`            | Configuration for automatic file extensions.                                                                                                                                                             |
| `auto-index`     | `index.html,index.htm`  | Configuration for automatically serving an index file.                                                                                                                                                   |
| `spa`            | (None)                  | Configuration for serving a fallback file for SPA applications.                                                                                                                                          |
| `not-found-page` | `<public-dir>/404.html` | Configuration for serving a 404 not found file.                                                                                                                                                          |

See [PublisherServer](#publisherserver) for more information about these features.

For backwards compatibility, if you do not specify a `--root-dir` but you have provided a `--public-dir`, then that value is used for `--root-dir`.

Note that the files referenced by `--spa` and `--not-found-page` do not necessarily have to reside inside `--public-dir`.

### Fastly service options

These arguments are used to populate the `fastly.toml` and `package.json` files of your Compute@Edge application.

| Option        | Default                                                          | Description                                                                  |
|---------------|------------------------------------------------------------------|------------------------------------------------------------------------------|
| `name`        | `name` from `package.json`, or `compute-js-static-site`          | The name of your Compute@Edge application.                                   |
| `description` | `description` from `package.json`, or `Compute@Edge static site` | The description of your Compute@Edge application.                            |
| `author`      | `author` from `package.json`, or `you@example.com`               | The author of your Compute@Edge application.                                 |
| `service-id`  | (None)                                                           | The ID of an existing Fastly WASM service for your Compute@Edge application. |

## Usage with frameworks and static site generators

`compute-js-static-publish` supports preset defaults for a number of frameworks and static site generators:

| `--preset`                    | `--root-dir` | `--static-dir`   | Notes                                                                                                                               |
|-------------------------------|--------------|------------------|-------------------------------------------------------------------------------------------------------------------------------------|
| `cra` (or `create-react-app`) | `./build`    | `./build/static` | For apps written using [Create React App](https://create-react-app.dev). Checks for a dependency on `react-scripts`.                |
| `cra-eject`                   | `./build`    | `./build/static` | For apps written using Create React App, but which have since been ejected via `npm run eject`. Does not check for `react-scripts`. |
| `vite`                        | `./dist`     | (None)           | For apps written using [Vite](https://vitejs.dev).                                                                                  |
| `sveltekit`                   | `./dist`     | (None)           | For apps written using [SvelteKit](https://kit.svelte.dev).                                                                         |
| `next`                        | `./out`      | (None)           | For apps written using [Next.js](https://nextjs.org), using `npm run export`. *1                                                    |
| `gatsby`                      | `./public`   | (None)           | For apps written using [Gatsby](https://www.gatsbyjs.com).                                                                          |
| `docusaurus`                  | `./build`    | (None)           | For apps written using [Docusaurus](https://docusaurus.io)                                                                          |

You may still override any of these options individually.

*1 - For Next.js, consider using `@fastly/next-compute-js`, a Next.js server implementation that allows you to run
   your Next.js application on Compute@Edge.

## PublisherServer

Publisher Server is a simple yet powerful server that can be used out of the box to serve the files prepared by this tool.

This server handles the following automatically:

* Maps the path of your request to a path under `--public-dir` and serves the content of the asset
* Sources the content from the content packaged in the Wasm, or from the Object Store if so configured (see [Object Store](#object-store), below.)
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
| `compression`      | `[ 'br', 'gzip' ]` | If the request contains an `Accept-Encoding` header, they are checked in the order listed in the header for the values listed here. The compression algorithm represented by the first match is applied.                             |
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

## Using the Object Store (BETA) <a name="object-store"></a>

Starting v4, it's now possible to upload assets to and serve them from the Fastly Object Store.

Fastly Object Store is currently part of a [beta release](https://docs.fastly.com/products/fastly-product-lifecycle#beta),
and to use it you will need to have the feature enabled for your account.

To enable the use of Object Store with `@fastly/compute-js-static-publish`, you will need to perform the following steps:

* Create a service on Fastly to host your Compute@Edge application. One way to do this would be to simply run `fastly
compute publish` your application.

* Create an Object Store under your Fastly account. At the moment you need to use the Fastly CLI. Once the Object Store
is created, it must be linked to your Fastly service using the Resources API.

```shell
# Create an object store
$ curl -i -X POST "https://api.fastly.com/resources/stores/object" -H "Fastly-Key: YOUR_FASTLY_TOKEN" -H "Content-Type: application/json" -H "Accept: application/json" -d '{"name":"example-store"}'

# Link the object store to a service
$ curl -i -X POST "https://api.fastly.com/service/YOUR_FASTLY_SERVICE_ID/version/YOUR_FASTLY_SERVICE_VERSION/resource" -H "Fastly-Key: YOUR_FASTLY_TOKEN" -H "Content-Type: application/x-www-form-urlencoded" -H "Accept: application/json" -d "name=example-store-service-a&resource_id=YOUR_OBJECT_STORE_ID"
```

Object Store API: https://developer.fastly.com/reference/cli/object-store/create/

Resources API: https://developer.fastly.com/reference/api/services/resource/

* Once the object store is created and linked to your service, add the Object Store's name to your `static-publish.rc.js`
file under the `objectStore` key.

After you have done the above steps, go ahead and build your application as normal. If you use `fastly compute build --verbose`
(or run `npm run build` directly), you should see output in your logs saying that files are being sent to the Object Store.

The `statics-metadata.js` file should now show `"isInline":false` for content assets.
Your Wasm binary should also be smaller, as the content of the files are no longer inlined in the build artifact.
You can deploy this and run it from Fastly, and the referenced files will be served from Object Store.

You will also see entries in `fastly.toml` that represent the local object store.
These enable the site to also run correctly when served using the local development environment. 

### Cleaning unused items from Object Store

The files that are uploaded to the Object Store are submitted using keys of the following format:

`<publish-id>:<asset-path>_<alg>_<hash>`

For example:
`12345abcde67890ABCDE00:/public/index.html_br_aeed29478691e67f6d5s36b4ded20c17e9eae437614617067a8751882368b965`

Using such an object key ensures that whenever the file contents are identical, the same key will be generated.  
This enables to detect whether an unchanged file already exists in the Object Store, avoiding having to re-submit
files that have not changed. If the file contents have changed, then a new hash is generated. This ensures that
even during the brief amount of time between deploys, any request served by a prior version will still serve the same
corresponding previous version of the content.

However, this system never deletes files automatically. After many deployments, extraneous files may be left over.

`@fastly/compute-js-static-publish` includes a feature to delete these old versions of the files that are no longer being
used.  To run it, type the following command:

`npx @fastly/compute-js-static-publish --clean-object-store`

It works by scanning `statics-metadata.js` for all currently-used object store keys. Then it enumerates all the existing
keys in the configured object store and that belong to this application (can do so by narrowing down all keys to the ones
that begin with the "publish id"). If any of the keys is not in the list of currently-used keys, then a request is made
to delete that object store entry.

And that's it! It should be possible to run this task to clean up once in a while. 

## Advanced Usages

### The `static-publish.rc.js` config file <a name="static-publish-rc"></a>

* `rootDir` - All files under this root directory will be included by default in the publishing,
  except for those that are excluded using some of the following features. Files outside this root cannot be
  included in the publishing.

* `objectStore` - Set this value to the _name_ of an existing object store to enable uploading of content assets
  to Fastly Object Store. See [Using the Object Store](#using-the-object-store) for more information.

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
    Object Store if Object Store mode is enabled, or include the contents of the file in the Wasm binary if Object Store
    mode is not enabled.
  * String `"inline"` - Include the file as a content asset in this publishing. Include the contents of the file in the
    Wasm binary, regardless of whether Object Store mode is enabled.
  * Boolean `false` - Do not include this file as a content asset in this publishing.

  If you do not provide a function, then every file will be included in this publishing as a content asset, and their
  contents will be uploaded to and served from the Object Store if Object Store mode is enabled, or included in the Wasm
  binary if Object Store mode is not enabled.

* `contentCompression` - During the publishing, the tool will pre-generate compressed versions of content assets in these
  formats and make them available to the Publisher Server or your application. Default value is [ 'br' | 'gzip' ].

* `moduleAssetInclusionTest` - Optionally specify a test function that can be run against each enumerated asset during
  the publishing, to determine whether to include the asset as a module asset. For every file, this function is passed
  the [asset key](#asset-keys), as well as its content type (MIME type string). You may return one of three values from this function:
  * `true` (boolean) - Include the file as a module asset in this publishing.
  * `"static-import"` (string) - Include the file as a module asset in this publishing, and statically import it. This causes
    any top-level code in these modules to run at application initialization time.
  * `false` (boolean) - Do not include this file as a module asset in this publishing.

  If you do not provide a function, then no module assets will be included in this publishing.

* `contentTypes` - Provide custom content types and/or override them.

  This tool comes with a set of default content types defined for many common file extensions. This list can be used to
  add to and/or override items in the default list.

  Content type definitions are checked in the provided order, and if none of them match, the default content types are
  tested afterwards.

  Provide these as an array of content type definition objects, each with the following keys and values:
  * `test` - a RegExp or function to perform on the asset key. If the test succeeds, then the content asset is considered
    to be of this content type definition.
  * `contentType` - The content type header to apply when serving an asset of this content type definition.
  * `text` - If `true`, this content type definition is considered to contain textual data. This makes `.text()` and `.json()`
    available for calling on store entries. If not specified, this is treated as `false`.

  > Note that content types are tested at publishing time, not at runtime.

* `server` - Configuration of `PublisherServer()`.  See the [Configuring PublisherServer](#configuring-publisherserver) section
  above.

### Running custom code alongside Publisher Server

The generated `./src/index.js` program instantiates the server and simply asks it to respond to a request.

You are free to add code to this file.

For example, if the server is unable to formulate a response to the request, then it returns `null`. You may add your
own code to handle these cases, such as to provide custom responses.

```js
import { getServer } from './statics.js';
const server = getServer();

addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));
async function handleRequest(event) {

  const response = await server.serveRequest(event.request);
  if (response != null) {
    return response;
  }
  
  // Do custom things here!

  return new Response('Not found', { status: 404 });
}
```

### Using published assets in your own application

Publishing, as described earlier, is the process of preparing files for inclusion into your application.
This process also makes metadata available about each of the files that are included, such as its content type, the last
modified date, the file hash, and so on.

The `PublisherServer` class that is used by the default scaffolded application is one simple application of this content
and metadata. By importing `./statics.js` into your Compute@Edge application, you can just as easily access this
information about the assets that were included during publishing.

> IMPORTANT: Use a static `import` statement, rather than using `await import()` to load `./statics.js`, in order to
ensure that its top-level code runs during the initialization phase of your Compute@Edge application. 

#### Assets

There are two categories of assets: Content Assets and Module Assets.

* A Content Asset is a type of asset where your application or a user of your application is interested in the text or 
binary contents of an asset.

  The data of each content asset can exist in one of two stores:
  * Inline Store - this is a data store that exists within the Wasm binary.
  * Fastly Object Store - Fastly's distributed edge data store. Data can be placed here without impacting the size of
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

// true if object's data is 'inlined' into Wasm binary
// false if object's data exists in Fastly Object Store
const isInline = asset.isInline;

// Get the "store entry"
const storeEntry = await asset.getStoreEntry();

storeEntry.contentEncoding; // null, 'br', 'gzip'
storeEntry.hash; // SHA256 of the contents of the file
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
but not in the context of Compute@Edge. (e.g., a tool that runs in Node.js that performs some maintenance task on assets).

You cannot import `./statics.js` from a Node.js application, as it holds dependencies on Compute@Edge.

Instead, you can import `./statics-metadata.js`, a companion file that is generated in the same directory. This file
exposes plain JavaScript objects that contain the metadata about your content assets that were included in the final
publishing event.

See the definition of `ContentAssetMetadataMapEntry` in the [`types/content-assets` file](./src/types/content-assets.ts) for more details.

### Using Webpack

As of v4, Webpack is no longer required, and by default is no longer part of the default scaffolded application.
If you wish to use some features of Webpack, you can elect to include Webpack in your generated application by specifying
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
