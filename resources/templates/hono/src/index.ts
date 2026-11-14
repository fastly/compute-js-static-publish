import { Hono } from 'hono';
import { type BindingsDefs, buildFire, logFastlyServiceVersion } from '@fastly/hono-fastly-compute';
import {
  type StaticPublisherVariables,
  fromStaticPublishRc,
  mergeBindings,
} from '@fastly/compute-js-static-publish/hono';
import rc from '../static-publish.rc.js';
// The modules of the Hono extensions folder. The build writes this file (see
// scripts/template_prebuild.js).
import { extensions } from './hono-extensions.generated.js';

const honoOptions = rc.templateOptions?.hono;

// The bindings of the app and of the extension modules, on c.env. A binding
// with two different resources stops the build.
const fire = buildFire(mergeBindings(honoOptions?.bindings, extensions) as BindingsDefs);

const { serveStatic, staticResponse, serveFallback, selectCollection, publisherServer } = fromStaticPublishRc(rc);

// The helpers of the app that each phase of the extensions gets.
const helpers = { serveStatic, staticResponse, serveFallback, publisherServer };

const app = new Hono<{ Bindings: typeof fire.Bindings, Variables: StaticPublisherVariables }>();

app.use('*', logFastlyServiceVersion());

// Select the collection with collectionSelection in static-publish.rc.js, for
// example for previews. Without it, this selects the default collection.
app.use('*', selectCollection());

// The extensions, in file-name order: first the middleware phase of all of
// them, then the beforeFiles phase.
for (const phase of [ 'middleware', 'beforeFiles' ] as const) {
  for (const e of extensions) {
    e.module.phases[phase]?.(app, honoOptions?.extensions?.[e.name], helpers);
  }
}

// Add your own routes here, for example:
// app.get('/api/hello', (c) => c.json({ hello: 'world' }));

// Serve the published files. If no file matches, the request goes to the next handler.
app.use('*', serveStatic());

// The afterFiles phase of the extensions: only for the requests that no
// published file matches.
for (const e of extensions) {
  e.module.phases.afterFiles?.(app, honoOptions?.extensions?.[e.name], helpers);
}

// When nothing matches, serve the SPA file or the 404 page.
app.notFound(serveFallback());

fire(app);
