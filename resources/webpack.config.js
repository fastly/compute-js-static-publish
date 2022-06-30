const path = require("path");
const webpack = require("webpack");
const { ProvidePlugin } = webpack;

let config;
try {
  config = require("./static-publish.json");
} catch {
  console.error('Error loading static-publish.json');
  process.exit(1);
}

const srcDir = path.resolve('./src');
const srcNodeModulesDir = path.resolve('./node_modules');
const publicDir = path.resolve(config.buildDir);

if (publicDir.startsWith(path.resolve())) {
  // If public dir is INSIDE the compute-js app dir, results may be weird
  console.warn('⚠️ public files directory is inside of the Compute@Edge app directory.');
  console.warn('This is an unsupported scenario and you may experience trouble.');
  console.warn('');
}

module.exports = {
  entry: "./src/index.js",
  optimization: {
    minimize: false
  },
  target: "webworker",
  output: {
    filename: "index.js",
    path: path.resolve(__dirname, "bin"),
    libraryTarget: "this",
  },
  module: {
    // Asset modules are modules that allow the use asset files (fonts, icons, etc)
    // without additional configuration or dependencies.
    rules: [
      // asset/source exports the source code of the asset.
      // Usage: e.g., import notFoundPage from "./page_404.html"
      {
        test: (file) => {
          if(file.startsWith(srcDir + '/')) {
            return false;
          }
          if(file.startsWith(srcNodeModulesDir + '/')) {
            return false;
          }
          if(!file.startsWith(publicDir + '/')) {
            return false;
          }
          return /\.(txt|htm(l)?|xml|json|map|js|css|svg)/.test(file);
        },
        type: "asset/source",
      },
      // asset/inline exports the raw bytes of the asset.
      // We base64 encode them here
      {
        test: (file) => {
          if(file.startsWith(srcDir + '/')) {
            return false;
          }
          if(file.startsWith(srcNodeModulesDir + '/')) {
            return false;
          }
          if(!file.startsWith(publicDir + '/')) {
            return false;
          }
          return /\.(bmp|png|gif|jp(e)?g|ico|tif(f)?|aac|mp3|mp4|mpeg|webm|pdf|tar|zip|eot|otf|ttf)/.test(file);
        },
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
    ],
  },
  plugins: [
    // Polyfills go here.
    // Used for, e.g., any cross-platform WHATWG,
    // or core nodejs modules needed for your application.
    new ProvidePlugin({
      Buffer: [ "buffer", "Buffer" ],
    }),
  ],
  resolve: {
    fallback: {
      "buffer": require.resolve("buffer/"),
    },
  },
};
