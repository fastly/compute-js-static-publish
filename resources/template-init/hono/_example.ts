// An example of a plugin module. A file whose name starts
// with '_' is not a plugin, so this file does nothing. To use it, rename it,
// for example to example.ts. Its options come from
// templateOptions.hono.compose.plugins.example in the project file (or in
// static-publish.rc.js).
//
// definePlugin() gets a function for each phase that the plugin uses. The app
// runs the middleware phase of all plugins, then their routes phase, then the
// published files, then their afterFilesRoutes phase. With only a function in
// place of the object, the function is the middleware phase.
import { definePlugin } from '@fastly/compute-js-static-publish/hono';

export default definePlugin({
  middleware: (app, options?: { header?: string }) => {
    app.use('*', async (c, next) => {
      await next();
      c.header(options?.header ?? 'x-example', 'from a plugin');
    });
  },
  routes: (app) => {
    app.get('/api/example', (c) => c.json({ hello: 'from a plugin' }));
  },
});
