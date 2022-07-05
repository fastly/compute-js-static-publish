# Static Publisher for Compute@Edge JavaScript

Have some static files that you want to serve up on your Compute@Edge service? Have you used a
static site generator to create your next website? Why not deploy and serve it from Fastly's
blazing-fast Edge Computing Platform?

## How it works

You have some HTML files, along with some accompanying CSS, JavaScript, image, and font files in a directory.
Or perhaps you have used a framework or static site generator that places output files in a directory.

1. For this example, assume the output files are at `/path/to/files/public` and its subdirectories.

2. Run `compute-js-static-publish`.

```shell
cd /path/to/files
npx @fastly/compute-js-static-publish --public-dir=./public
```

This will generate a Compute@Edge application at `/path/to/files/compute-js`. It will add a default `./src/index.js` file that serves the static files from your production bundle.

3. Run your application using [Fastly's local development server](https://developer.fastly.com/learning/compute/testing/#running-a-local-testing-server).

The build process will generate a `./src/statics.js` file that holds references to the files in
`/path/to/files/public`.


```shell
cd ./compute-js
npm install
fastly compute serve
```

4. When you're ready to go live, [deploy it to your Compute@Edge service](https://developer.fastly.com/reference/cli/compute/publish/).

```shell
fastly compute publish
```

Each time you build your Compute@Edge project (whether by `fastly compute serve` or `fastly compute publish`),
`compute-js-static-publish` will run a process that scans your `/path/to/files/public` directory and
generates a new `./src/statics.js` file.

You're always free to modify the `./src/index.js` handler to suit your needs, such as to add your own API endpoints.
This framework will not touch that file after creation.

## Arguments

Most arguments are optional, and if provided, override the defaults described below.

```shell
npx @fastly/compute-js-static-publish --public-dir=./build --static-dir=./build/static --output=./compute-js --spa
```

| Option           | Default                                                        | Description                                                                                                                                                                                                                                                                                                                                                                             |
|------------------|----------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `preset`         | (None)                                                         | Use this argument to select a preset to provide default values for a number of frameworks. See "Frameworks and Static Site Generators" below.                                                                                                                                                                                                                                           |
| `output`         | `./compute-js`                                                 | The directory in which to create the Compute@Edge application.                                                                                                                                                                                                                                                                                                                          |
| `public-dir`     | (None)                                                         | Required. The directory that contains the application's public files. All files in this directory and subdirectories will be served by your Compute@Edge handler. If not provided, `./build` will be used as the default, and defaults for `create-react-app` will be used assumed.                                                                                                     |
| `static-dir`     | (None)                                                         | If provided, a subdirectory of `--public-dir` that contains the application's static files. The files in this directory and subdirectories will be cached for 1 year by the browser. Make sure you use a strategy as versioned or cached filenames to avoid stale files.                                                                                                                |
| `auto-index`     | `index.html,index.htm`                                         | For a request for a path that ends in a `/`, the handler will attempt to serve the assets identified by appending these names, in the specified order. For example, with the default value of this setting, if `/path/to/a/` is requested, then the handler attempts to serve `/path/to/a/index.html` and `/path/to/a/index.htm`, in that order.                                        |
| `auto-ext`       | `.html,.htm`                                                   | For a request for a path that does not end in a `/`, if an asset is not found at the path, then handler will attempt to serve the assets identified by appending these extensions, in the specified order. For example, with the default value of this setting, if `/path/to/a` is requested, then the handler attempts to serve `/path/to/a.html` and `/path/to/a.htm`, in that order. |
| `spa`            | (None)                                                         | If specified, then the handler will serve this file when the requested path does not match any of the known paths, with a 200 code. Useful for apps that use [client-side routing](https://create-react-app.dev/docs/deployment#serving-apps-with-client-side-routing).                                                                                                                 |
| `not-found-page` | `<public-dir>/404.html`                                        | If specified, then the handler will serve this file when the requested path does not match any of the known paths, with a 404 code. Used to serve up a custom 404 error page..                                                                                                                                                                                                          |
| `name`           | `name` from package.json, or `compute-js-static-site`          | The name of your application. This will be used to populate the `fastly.toml` and `package.json` files of the generated application.                                                                                                                                                                                                                                                    |
| `description`    | `description` from package.json, or `Compute@Edge static site` | The description of your application. This will be used to populate the `fastly.toml` and `package.json` files of the generated application.                                                                                                                                                                                                                                             |
| `author`         | `author` from package.json, or `you@example.com`               | The author of your application. This will be used to populate the `fastly.toml` and `package.json` files of the generated application.                                                                                                                                                                                                                                                  |
| `service-id`     | (None)                                                         | If specified, then this value is used to populate the `serviceId` field of the `fastly.toml` file of the generated application.                                                                                                                                                                                                                                                         |

The various configurations will be written to a `static-publish.rc.js` file and appropriate sections of `package.json` and `fastly.toml` of the generated application.

Each time you build the generated application, `compute-js-static-publish` will be run with a special flag `build-static`,
causing it to run in a mode that reads `static-publish.rc.js`, scans the public directory, and recreates `./src/statics.js`.

## Usage with Frameworks and Static Site Generators

`compute-js-static-publish` supports a number of frameworks and static site generators by
applying their default directories and settings. When using a preset, the default values of
each argument are as follows, but you may still override these defaults individually.

| Preset                         | `public-dir` | `static-dir`     | Notes                                                                                                                                                                               |
|--------------------------------|--------------|------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `cra`  (or `create-react-app`) | `./build`    | `./build/static` | For apps written using [Create React App](https://create-react-app.dev). Checks that the app depends on `react-scripts` to ensure that the app was generated with Create React App. |
| `cra-eject`                    | `./build`    | `./build/static` | Same as `cra`, but does not check for `react-scripts`. Useful for an app that has had `npm run eject` run.                                                                          |
| `vite`                         | `./dist`     | (None)           | For apps written using [Vite](https://vitejs.dev).                                                                                                                                  |
| `sveltekit`                    | `./dist`     | (None)           | For apps written using [SvelteKit](https://kit.svelte.dev).                                                                                                                         |
| `next`                         | `./out`      | (None)           | For apps written using [Next.js](https://nextjs.org), using `npm run export`.                                                                                                       |
| `gatsby`                       | `./public`   | (None)           | For apps written using [Gatsby](https://www.gatsbyjs.com).                                                                                                                          |
| `docusaurus`                   | `./build`    | (None)           | For apps written using [Docusaurus](https://docusaurus.io)                                                                                                                          |

## Issues

If you encounter any non-security-related bug or unexpected behavior, please [file an issue][bug]
using the bug report template.

[bug]: https://github.com/fastly/compute-js-static-publish/issues/new?labels=bug

### Security issues

Please see our [SECURITY.md](./SECURITY.md) for guidance on reporting security-related issues.

## License

[MIT](./LICENSE).
