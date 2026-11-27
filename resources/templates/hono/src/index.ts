import { Hono } from 'hono';
import { type BindingsDefs, buildFire, logFastlyServiceVersion } from '@fastly/hono-fastly-compute';
import {
  type StaticPublisherVariables,
  fromStaticPublishRc,
  mergeBindings,
} from '@fastly/compute-js-static-publish/hono';
import rc from '../static-publish.rc.js';
// The plugin modules in the folder hono-compose/. The
// build writes this file (see scripts/template_prebuild.js).
import { plugins } from './hono-compose.generated.js';

const honoOptions = rc.templateOptions?.hono;

// The bindings of the app and of the plugins, on c.env. A binding
// with two different resources stops the build.
const fire = buildFire(mergeBindings(honoOptions?.bindings, plugins) as BindingsDefs);

const {
  serveStatic,
  staticResponse,
  serveFallback,
  fallbackResponse,
  isCollectionAvailable,
  selectCollection,
  publisherServer,
} = fromStaticPublishRc(rc);

// The helpers of the app that each phase of the plugins gets.
const helpers = { serveStatic, staticResponse, serveFallback, fallbackResponse, isCollectionAvailable, publisherServer };

const app = new Hono<{ Bindings: typeof fire.Bindings, Variables: StaticPublisherVariables }>();

app.use('*', logFastlyServiceVersion());

// Select the collection with collectionSelection in static-publish.rc.js, for
// example for previews. Without it, this selects the default collection.
app.use('*', selectCollection());

// The plugins, in plugin order (a number prefix by its value, then the files
// without one): first the middleware phase of all of them, then the routes
// phase.
for (const phase of [ 'middleware', 'routes' ] as const) {
  for (const p of plugins) {
    p.plugin.phases[phase]?.(app, honoOptions?.compose?.plugins?.[p.name], helpers);
  }
}

// Add your own routes here, for example:
// app.get('/api/hello', (c) => c.json({ hello: 'world' }));

// Serve the published files. If no file matches, the request goes to the next handler.
app.use('*', serveStatic());

// The afterFilesRoutes phase of the plugins: only for the requests that no
// published file matches.
for (const p of plugins) {
  p.plugin.phases.afterFilesRoutes?.(app, honoOptions?.compose?.plugins?.[p.name], helpers);
}

// When nothing matches, serve the SPA file or the 404 page.
app.notFound(serveFallback());

fire(app);
