# compute-js-static-publish
Static Publisher for Compute@Edge JavaScript

Have some static files that you want to serve up on your Compute@Edge service?

Or, easily run your React application generated with [`create-react-app`](https://create-react-app.dev/) on
a [Compute@Edge service](https://developer.fastly.com/learning/compute/javascript/).

## How it works

You have some HTML files, along with some accompanying CSS, JavaScript, image, and font files in a directory.
Or perhaps you have a framework that can generate static output files in a directory.

1. For this example, assume the output files are at `/path/to/files/public` and its subdirectories.

2. When you're ready to deploy the files to Fastly, run `compute-js-static-publish`.

```shell
cd /path/to/files
npx @fastly/compute-js-static-publish --public-dir=./public
```

This will generate a Compute@Edge application at `/path/to/files/compute-js`.
It will add a default `./src/index.js` file that serves the static files from your production bundle,
as well as a `./src/statics.js` file that holds references to the files in `/path/to/files/public`.

3. Run your application using [Fastly's local development server](https://developer.fastly.com/learning/compute/testing/#running-a-local-testing-server).

```shell
cd ./compute-js
npm install
fastly compute serve
```

4. When you're ready to go live, [deploy it to your Compute@Edge service](https://developer.fastly.com/reference/cli/compute/publish/).

```shell
fastly compute publish
```

5. Each time you build your Compute@Edge project, `compute-js-static-publish` will run a process that scans your `/path/to/files/public`
   directory for changes and generates a new `./src/statics.js` file.

You're free to modify the `./src/index.js` handler to suit your needs, such as to add your own API endpoints.
This framework will not touch that file after creation.

## Usage with Create React App

`create-react-app` provides a simple-to-use platform for getting started developing React
applications. When you need to deploy your app to the internet, why not deploy it to Fastly's
blazing-fast Edge Computing Platform?

1. Use Create React App to create your application.

```shell
npx create-react-app my-app
```

2. Work on your app as normal.

```shell
cd my-app
npm start
```

3. When you're ready to deploy to Fastly, build your production bundle, then run `compute-js-static-publish`.

```shell
npm run build # create-react-app's build command
npx @fastly/compute-js-static-publish
```

This will make a `compute-js` subfolder and initialize it as a Compute@Edge JavaScript application.
It will add a default `./src/index.js` file that serves the static files from your production bundle.

4. Run your application using [Fastly's local development server](https://developer.fastly.com/learning/compute/testing/#running-a-local-testing-server).

```shell
cd ./compute-js
npm install
fastly compute serve
```

5. When you're ready to go live, [deploy it to your Compute@Edge service](https://developer.fastly.com/reference/cli/compute/publish/).

```shell
fastly compute publish
```

6. Each time you build your Compute@Edge project, `compute-js-static-publish` will run a process that scans your `./build`
    directory for changes and generates a new `./src/statics.js` file.

You're free to modify the `./src/index.js` handler to suit your needs, such as to add your own API endpoints.
This framework will not touch that file after creation.

## Options

```shell
npx @fastly/compute-js-static-publish --public-dir=./build --static-dir=./build/static --output=./compute-js --spa
```

| Option        | Default                                                         | Description                                                                                                                                                                                                                                                                                |
|---------------|-----------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `output`      | `./compute-js`                                                  | The directory in which to create the Compute@Edge application.                                                                                                                                                                                                                             |
| `public-dir`  | `./build`                                                       | The directory that contains the application's public files. All files in this directory and subdirectories will be served by your Compute@Edge handler. If not provided, `./build` will be used as the default, and defaults for `create-react-app` will be used assumed.                  |
| `static-dir`  | (None) `./build/static` if `create-react-app` defaults are used | If provided, a subdirectory of `--public-dir` that contains the application's static files. The files in this directory and subdirectories will be cached for 1 year by the browser. Make sure you use a strategy as versioned or cached filenames to avoid stale files.                   |
| `spa`         | `false`                                                         | If true, then the Compute@Edge handler will serve `<public-dir>/index.html` when the requested file does not match any of the files in `<public-dir>`. Useful for apps that use [client-side routing](https://create-react-app.dev/docs/deployment#serving-apps-with-client-side-routing). |
| `cra-eject`   | `false`                                                         | If true, enables running against the output of a `create-react-app` project that has been [ejected](https://create-react-app.dev/docs/available-scripts/#npm-run-eject).                                                                                                                   |
| `name`        | `name` from package.json, or `compute-js-static-site`           | The name of your application. This will be used to fill in the `fastly.toml` and `package.json` files of the generated application.                                                                                                                                                        |
| `description` | `description` from package.json, or`Compute@Edge static site`   | The description of your application. This will be used to fill in the `fastly.toml` and `package.json` files of the generated application.                                                                                                                                                 |
| `author`      | `author` from package.json, or `you@example.com`                | The author of your application. This will be used to fill in the `fastly.toml` and `package.json` files of the generated application.                                                                                                                                                      |

The various configurations will be written to a `static-publish.rc.js` file, and is referenced by the `compute-js-build-static-loader`
command that is run on each `build` of the Compute@Edge project (this runs as a part of the `prebuild` script in `package.json`).
