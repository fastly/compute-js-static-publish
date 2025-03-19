const path = require("path");

module.exports = {
  entry: "./src/index.js",
  target: false,
  devtool: false,
  optimization: {
    minimize: true
  },
  output: {
    filename: "index.js",
    path: path.resolve(__dirname, "bin"),
    chunkFormat: 'commonjs',
    library: {
      type: 'commonjs',
    },
  },
  module: {
    // Loaders go here.
    // e.g., ts-loader for TypeScript
    // rules: [
    // ],
  },
  resolve: {
    conditionNames: [
      'fastly',
      '...',
    ],
  },
  plugins: [
    // Webpack Plugins and Polyfills go here
    // e.g., cross-platform WHATWG or core Node.js modules needed for your application.
    // new webpack.ProvidePlugin({
    // }),
  ],
  externals: [
    // Allow webpack to handle 'fastly:*' namespaced module imports by treating
    // them as modules rather than trying to process them as URLs
    /^fastly:.*$/,
  ],
};
