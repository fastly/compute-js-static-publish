// An example of a Hono extension. A file whose name starts with '_' is not a
// module, so this file does nothing. To use it, rename it, for example to
// example.ts. Its options come from templateOptions.hono.extensions.example in
// the project file (or in static-publish.rc.js).
//
// defineExtension() gets a function for each phase that the module uses. The
// app runs the middleware phase of all modules, then their beforeFiles phase,
// then the published files, then their afterFiles phase. With only a function
// in place of the object, the function is the middleware phase.
import { defineExtension } from '@fastly/compute-js-static-publish/hono';

export default defineExtension({
  middleware: (app, options?: { header?: string }) => {
    app.use('*', async (c, next) => {
      await next();
      c.header(options?.header ?? 'x-example', 'from an extension');
    });
  },
  beforeFiles: (app) => {
    app.get('/api/example', (c) => c.json({ hello: 'from an extension' }));
  },
});
