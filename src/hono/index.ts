/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

/// <reference types="@fastly/js-compute" />

// Serve the files of a PublisherServer from a Hono app. This module imports
// only types from hono, so it does not add hono to the bundle.

import type { Context, MiddlewareHandler, NotFoundHandler } from 'hono';

// Import from the package entry point, which registers the storage providers.
import {
  PublisherServer,
  type StaticPublishRc,
  type PublishContentConfig,
} from '../server/index.js';
import { type ServeStaticPathOptions, resolveServeStaticPathname } from './path.js';

// The collection for a request. null selects the default collection. A function
// that returns undefined selects the active collection of the PublisherServer.
export type CollectionNameOption = string | null | ((c: Context) => string | null | undefined);

export type ServeStaticMiddlewareOptions = ServeStaticPathOptions<Context> & {
  collectionName?: CollectionNameOption,
};

export type ServeStaticOptions = ServeStaticMiddlewareOptions & {
  staticPublisherServer: PublisherServer,
};

export type ServeFallbackMiddlewareOptions = {
  collectionName?: CollectionNameOption,
};

export type ServeFallbackOptions = ServeFallbackMiddlewareOptions & {
  staticPublisherServer: PublisherServer,
};

// Defaults for the middleware that fromPublisherServer() and fromStaticPublishRc() make.
export type PublisherServerMiddlewareDefaults = {
  collectionName?: CollectionNameOption,
};

export type PublisherServerMiddleware = {
  publisherServer: PublisherServer,
  serveStatic: (options?: ServeStaticMiddlewareOptions) => MiddlewareHandler,
  serveFallback: (options?: ServeFallbackMiddlewareOptions) => NotFoundHandler,
};

function resolveCollectionName(c: Context, option: CollectionNameOption | undefined): string | null | undefined {
  return typeof option === 'function' ? option(c) : option;
}

// Serve the file that matches the request. If no file matches, call the next
// handler. This does not serve the SPA file or the 404 page: use serveFallback().
export function serveStatic(options: ServeStaticOptions): MiddlewareHandler {
  const server = options.staticPublisherServer;

  return async (c, next) => {
    const pathname = resolveServeStaticPathname(c.req.path, c, options);
    const response = pathname != null ? await server.serveRequest(c.req.raw, {
      collectionName: resolveCollectionName(c, options.collectionName),
      pathname,
      fallback: false,
      healthCheck: false,
    }) : null;
    if (response == null) {
      await next();
      return;
    }
    return response;
  };
}

// Serve the SPA file or the 404 page of the collection, for app.notFound().
// If the collection has neither, or the client does not accept HTML, the
// response is Hono's default 404 response.
export function serveFallback(options: ServeFallbackOptions): NotFoundHandler {
  const server = options.staticPublisherServer;

  return async (c) => {
    const response = await server.serveFallback(c.req.raw, {
      collectionName: resolveCollectionName(c, options.collectionName),
    });
    return response ?? c.text('404 Not Found', 404);
  };
}

export function fromPublisherServer(server: PublisherServer, defaults: PublisherServerMiddlewareDefaults = {}): PublisherServerMiddleware {
  return {
    publisherServer: server,
    serveStatic: (options = {}) =>
      serveStatic({ ...defaults, ...options, staticPublisherServer: server }),
    serveFallback: (options = {}) =>
      serveFallback({ ...defaults, ...options, staticPublisherServer: server }),
  };
}

export function fromStaticPublishRc(rc: StaticPublishRc, defaults: PublisherServerMiddlewareDefaults = {}): PublisherServerMiddleware {
  return fromPublisherServer(PublisherServer.fromStaticPublishRc(rc), defaults);
}

export { PublisherServer, type StaticPublishRc, type PublishContentConfig };
