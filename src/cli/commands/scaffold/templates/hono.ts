/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import type { AppTemplate } from './index.js';

// A Hono app that uses the middleware in @fastly/compute-js-static-publish/hono.
// fire() from @fastly/hono-fastly-compute adds the fetch event listener, as in
// https://hono.dev/docs/getting-started/fastly. Do not use hono/service-worker:
// by default, its handler sends each 404 response to fetch(), and Compute has
// no default backend.
export const honoTemplate: AppTemplate = {
  dependencies: {
    '@fastly/hono-fastly-compute': '^0.4.0',
    'hono': '^4.13.0',
  },
  indexJs: /* language=text */ `\
/// <reference types="@fastly/js-compute" />
import { env } from 'fastly:env';
import { Hono } from 'hono';
import { buildFire } from '@fastly/hono-fastly-compute';
import { fromStaticPublishRc } from '@fastly/compute-js-static-publish/hono';
import rc from '../static-publish.rc.js';

// Add bindings here to use them from c.env. For example,
// { siteData: 'KVStore:site-data' } for a KV Store named "site-data".
const fire = buildFire({});

const { serveStatic, serveFallback } = fromStaticPublishRc(rc);

const app = new Hono();

app.use('*', async (c, next) => {
  console.log('FASTLY_SERVICE_VERSION', env('FASTLY_SERVICE_VERSION'));
  await next();
});

// Add your routes here. For example:
// app.get('/api/hello', (c) => c.json({ message: 'Hello' }));

// Serve the published files. If no file matches, the request goes to the next handler.
app.use('*', serveStatic());

// When nothing matches, serve the SPA file or the 404 page (see publish-content.config.js).
app.notFound(serveFallback());

fire(app);
`,
};
