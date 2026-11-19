// Runs before each build (the prebuild template hook). Bundles the modules of
// the Hono extensions folder into src/hono-extensions.generated.js. The
// packages of the app (hono, …) stay imports, so that the app has one copy of
// each. This script passes the app's esbuild to the bundler.
import * as esbuild from 'esbuild';
import { bundleHonoExtensions } from '@fastly/compute-js-static-publish/hono/build';

await bundleHonoExtensions({ appDir: process.cwd(), esbuild });
