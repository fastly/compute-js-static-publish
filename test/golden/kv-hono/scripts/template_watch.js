// Runs next to `fastly compute serve --watch` (npm run dev:watch, or
// dev -- --watch, starts it). It watches the folder of the plugins
// (hono-compose/), and after each change bundles the plugins into
// src/hono-compose.generated.js again.
// The Fastly CLI watches the app directory, so the new file makes it build and
// restart the app.
import * as esbuild from 'esbuild';
import { watchPlugins } from '@fastly/compute-js-static-publish/hono/build';

const watcher = await watchPlugins({ appDir: process.cwd(), esbuild });
for (const signal of [ 'SIGINT', 'SIGTERM' ]) {
  process.on(signal, () => {
    watcher.close();
    process.exit(0);
  });
}
