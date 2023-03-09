const path = require("path");

module.exports = {
  entry: "./src/index.js",
  optimization: {
    minimize: true
  },
  target: "webworker",
  output: {
    filename: "index.js",
    path: path.resolve(__dirname, "bin"),
    libraryTarget: "this",
  },
  module: {
    // Loaders go here.
    // e.g., ts-loader for TypeScript
    // rules: [
    // ],
  },
  plugins: [
    // Polyfills go here.
    // Used for, e.g., any cross-platform WHATWG,
    // or core nodejs modules needed for your application.
  ],
  externals: [
    ({request,}, callback) => {
      if (/^fastly:.*$/.test(request)) {
        return callback(null, 'commonjs ' + request);
      }
      callback();
    }
  ],
};
