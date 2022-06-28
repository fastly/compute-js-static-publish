# compute-js-static-publish
Static Publisher for Compute@Edge JavaScript

Easily run your React application generated with [`create-react-app`](https://create-react-app.dev/) on
a [Compute@Edge service](https://developer.fastly.com/learning/compute/javascript/).

`create-react-app` provides a simple-to-use platform for getting started developing React
applications. When you need to deploy your app to the internet, why not deploy it to Fastly's
blazing-fast Edge Computing Platform?

## How it works

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
npx @fastly/compute-js-static-publish --public-path=./build --static-path=./build/static --output=./compute-js --spa
```

| Option          | Default          | Description                                                                                                                                                                                                                                                                                  |
|-----------------|------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `--public-path` | `./build`        | The directory that contains the application's public files. All files in this directory and subdirectories will be served by your Compute@Edge handler.                                                                                                                                      |
| `--static-path` | `./build/static` | A subdirectory of `--public-path` that contains the application's static files. The files in this directory and subdirectories will be served with a 1 year cache.                                                                                                                           |
| `--output`      | `./compute-js`   | The directory in which to create the Compute@Edge application.                                                                                                                                                                                                                               |
| `--spa`         | `false`          | If true, then the Compute@Edge handler will serve `<public-path>/index.html` when the requested file does not match any of the files in `<public-path>`. Useful for apps that use [client-side routing](https://create-react-app.dev/docs/deployment#serving-apps-with-client-side-routing). |

The path and spa flag will be written to a `static-publish.json` file, and is referenced by the `compute-js-build-static-loader`
command that is run on each `build` of the Compute@Edge project (this runs as a part of the `prebuild` script in `package.json`).
