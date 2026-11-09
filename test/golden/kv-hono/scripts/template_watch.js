// Runs next to `fastly compute serve --watch` (npm run dev:watch, or
// dev -- --watch, starts it). It watches the Hono extensions folder, and after
// each change bundles the modules into src/hono-extensions.generated.js again.
// The Fastly CLI watches the app directory, so the new file makes it build and
// restart the app.
import * as esbuild from 'esbuild';
import { watchHonoExtensions } from '@fastly/compute-js-static-publish/hono/build';

const watcher = await watchHonoExtensions({ appDir: process.cwd(), esbuild });
for (const signal of [ 'SIGINT', 'SIGTERM' ]) {
  process.on(signal, () => {
    watcher.close();
    process.exit(0);
  });
}
