# Static Publisher for JavaScript on Compute@Edge

Using a static site generator to build your website? Do you simply need to serve some static files? With `compute-js-static-publish`, now you can deploy and serve everything from Fastly's blazing-fast [Compute@Edge](https://developer.fastly.com/learning/compute/).

## Breaking Changes

v3.0 makes some updates that require changes to some files. If you've been using your `compute-js-static-publisher` application without modification, you may simply re-scaffold your application.
Otherwise, you can make some updates to your files. See [MIGRATING](#migrating) below for details.

## How it works

You have some HTML files, along with some accompanying CSS, JavaScript, image, and font files in a directory. Perhaps you've used a framework or static site generator to build these files.

Assuming the root of your output directory is `./public`,

### 1. Run `compute-js-static-publish`

```shell
npx @fastly/compute-js-static-publish@latest --public-dir=./public
```

>This will generate a Compute@Edge application at `./compute-js`. It will add a default `./src/index.js` file that serves the static files from your project.

### 2. Test your application using [Fastly's local development server](https://developer.fastly.com/learning/compute/testing/#running-a-local-testing-server)

```shell
cd ./compute-js
npm install
fastly compute serve
```

The build process will generate a `/src/statics.js` and accompanying `/src/statics.d.ts` file (in `./compute-js`) that holds references to your project's public files.

### 3. When you're ready to go live, [deploy your Compute@Edge service](https://developer.fastly.com/reference/cli/compute/publish/)

```shell
fastly compute publish
```

Each time you build your Compute@Edge project (by running `fastly compute serve` or `fastly compute publish`), `compute-js-static-publish` will scan your `./public` directory and regenerate `/src/statics.js`.

You can modify `/src/index.js` to suit your needs, such as adding your own API endpoints. This file will not be overwritten after it is created.

## CLI options

Most arguments are optional, and if provided, override the defaults described below.

```shell
npx @fastly/compute-js-static-publish \
    --public-dir=./build \
    --static-dir=./build/static \
    --output=./compute-js \
    --spa=./build/index.html
```

Any configuration options will be written to a `static-publish.rc.js` file.

| Option           | Default                 | Description                                                                                                                                                                                                                                                                              |
|------------------|-------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `preset`         | (None)                  | Apply default options from a specified preset. See ["Frameworks and Static Site Generators"](#usage-with-frameworks-and-static-site-generators).                                                                                                                                         |
| `output`         | `./compute-js`          | The directory in which to create the Compute@Edge application.                                                                                                                                                                                                                           |
| `public-dir`     | (None)                  | **Required**. The root of the directory that contains your website's public files. Files at this path will be served by the generated Compute@Edge application.                                                                                                                          |
| `static-dir`     | (None)                  | A subdirectory of `--public-dir` that contains the website's static assets. Files at this path will be cached by the browser for 1 year. Use versioned or hashed filenames to avoid serving stale assets.                                                                                |
| `auto-index`     | `index.html,index.htm`  | Attempt to handle request paths by appending these names (comma-separated), in the specified order. If a path does not end in a slash, a slash is added automatically. By default, if `/path/to/a/` is requested, attempt to serve `/path/to/a/index.html`, then `/path/to/a/index.htm`. |
| `auto-ext`       | `.html,.htm`            | Handle request paths that do not end in `/` by appending these extensions (comma-separated), in the specified order. By default, if `/path/to/a` is requested, attempt to serve `/path/to/a`, `/path/to/a.html`, then `/path/to/a.htm`.                                                  |
| `spa`            | (None)                  | Serve this file when the request path does not match known paths – with a `200` status code. Useful for apps that use [client-side routing](https://create-react-app.dev/docs/deployment#serving-apps-with-client-side-routing).                                                         |
| `not-found-page` | `<public-dir>/404.html` | Serve this file when the request path does not match known paths – with a `404` status code. Useful for a custom 404 error page.                                                                                                                                                         |

On subsequent builds of your Compute@Edge application, `compute-js-static-publish` will run with a special flag, `build-static`, reading from stored configuration, then scanning the `--public-dir` directory to recreate `./src/statics.js`.

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

| `--preset`                    | `--public-dir` | `--static-dir`   | Notes                                                                                                                               |
|-------------------------------|----------------|------------------|-------------------------------------------------------------------------------------------------------------------------------------|
| `cra` (or `create-react-app`) | `./build`      | `./build/static` | For apps written using [Create React App](https://create-react-app.dev). Checks for a dependency on `react-scripts`.                |
| `cra-eject`                   | `./build`      | `./build/static` | For apps written using Create React App, but which have since been ejected via `npm run eject`. Does not check for `react-scripts`. |
| `vite`                        | `./dist`       | (None)           | For apps written using [Vite](https://vitejs.dev).                                                                                  |
| `sveltekit`                   | `./dist`       | (None)           | For apps written using [SvelteKit](https://kit.svelte.dev).                                                                         |
| `next`                        | `./out`        | (None)           | For apps written using [Next.js](https://nextjs.org), using `npm run export`. *1                                                    |
| `gatsby`                      | `./public`     | (None)           | For apps written using [Gatsby](https://www.gatsbyjs.com).                                                                          |
| `docusaurus`                  | `./build`      | (None)           | For apps written using [Docusaurus](https://docusaurus.io)                                                                          |

You may still override any of these options individually.

*1 - For Next.js, consider using `@fastly/next-compute-js`, a Next.js server implementation that allows you to run
   your Next.js application on Compute@Edge.

## Migrating

To update `@fastly/compute-js-static-publish` to a new major version, we recommend that you re-scaffold your application. However, we know that's not always possible, so the following is provided to help you overcome any breaking changes.

* `webpack.config.js`

  * Starting `v3.0.0`, we depend on `v1.0.0` of the `js-compute` library. You'll need to add a new `externals` array to the bottom if it doesn't exist already, and add the following entry:

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

  * Starting `v3.0.0`, we are able to produce more size-efficient Wasm files by using the [`includeBytes` function](https://js-compute-reference-docs.edgecompute.app/docs/fastly:experimental/includeBytes) to include the contents of static files instead of Webpack static assets. The following code can safely be removed from the `module.rules` array.

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

* `.gitignore`

  * Add any of the following entries that may be missing from your `.gitignore` file:
  
    ```gitignore
    /src/statics.js
    /src/statics.d.ts
    /src/static-content
    ```
    
* Various versions of `@fastly/compute-js-static-publish` have specified different build scripts. At the current time, the following is the recommended setup, regardless of the version of `@fastly/compute-js-static-publish` or Fastly CLI.  

  * The build script listed in `compute-js/fastly.toml` should look like this:
    ```toml
    [scripts]
    build = "npm run build"
    ```

  * The `scripts` section of `compute-js/package.json` should contain the following lines:
    ```json
    {
        "prebuild": "npx @fastly/compute-js-static-publish --build-static && webpack",
        "build": "js-compute-runtime ./bin/index.js ./bin/main.wasm"
    }
    ```

## Issues

If you encounter any non-security-related bug or unexpected behavior, please [file an issue][bug].

[bug]: https://github.com/fastly/compute-js-static-publish/issues/new?labels=bug

### Security issues

Please see our [SECURITY.md](./SECURITY.md) for guidance on reporting security-related issues.

## License

[MIT](./LICENSE).
