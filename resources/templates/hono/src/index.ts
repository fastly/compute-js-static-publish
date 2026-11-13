import { Hono } from 'hono';
import { fire, logFastlyServiceVersion } from '@fastly/hono-fastly-compute';
import { fromStaticPublishRc, type StaticPublisherVariables } from '@fastly/compute-js-static-publish/hono';
import rc from '../static-publish.rc.js';

const { serveStatic, serveFallback, selectCollection } = fromStaticPublishRc(rc);

const app = new Hono<{ Variables: StaticPublisherVariables }>();

app.use('*', logFastlyServiceVersion());

// Select the collection with collectionSelection in static-publish.rc.js, for
// example for previews. Without it, this selects the default collection.
app.use('*', selectCollection());

// Add your own routes here, for example:
// app.get('/api/hello', (c) => c.json({ hello: 'world' }));

// Serve the published files. If no file matches, the request goes to the next handler.
app.use('*', serveStatic());

// When nothing matches, serve the SPA file or the 404 page.
app.notFound(serveFallback());

fire(app);
