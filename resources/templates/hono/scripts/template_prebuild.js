// Runs before each build (the prebuild template hook). Bundles the plugins of
// hono-compose/ into src/hono-compose.generated.js.
// The packages of the app (hono, …) stay imports, so that the app has one copy
// of each. This script passes the app's esbuild to the bundler.
import * as esbuild from 'esbuild';
import { bundlePlugins } from '@fastly/compute-js-static-publish/hono/build';

await bundlePlugins({ appDir: process.cwd(), esbuild });
