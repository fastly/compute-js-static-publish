/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

/// <reference types="@fastly/js-compute" />

// Serve the files of a PublisherServer from a Hono app. This module imports
// only types from hono, so it does not add hono to the bundle.

import type { Context, MiddlewareHandler, NotFoundHandler } from 'hono';

// Import from the package entry point, which registers the storage providers.
import { PublisherServer, type StaticPublishRc } from '../server/index.js';
import { type ServeStaticPathOptions, resolveServeStaticPathname } from './path.js';

// The values that selectCollection() sets on c.var. Use this type in the
// Variables of the Hono app: new Hono<{ Variables: StaticPublisherVariables }>().
export type StaticPublisherVariables = {
  staticPublisher: {
    publisherServer: PublisherServer,
    // The collection that collection selection chose. null selects the
    // default collection.
    collectionName: string | null,
    // For a path source: the request path without the prefix of the source.
    pathname?: string,
  },
};

// The collection for a request. null selects the default collection. If the
// option is not given, or a function returns undefined, the collection is the
// one that selectCollection() chose, or else the active collection of the
// PublisherServer.
export type CollectionNameOption = string | null | ((c: Context) => string | null | undefined);

export type ServeStaticOptions = ServeStaticPathOptions<Context> & {
  collectionName?: CollectionNameOption,
};

export type ServeFallbackOptions = {
  collectionName?: CollectionNameOption,
};

// Defaults for the middleware that fromPublisherServer() and fromStaticPublishRc()
// make. An option in a call replaces the default.
export type PublisherServerMiddlewareDefaults = {
  collectionName?: CollectionNameOption,
};

export type PublisherServerMiddleware = {
  publisherServer: PublisherServer,
  // Serves the file that matches the request. If no file matches, or the
  // method is not GET or HEAD, it calls the next handler. It does not serve the
  // SPA file or the 404 page (use serveFallback()), and does not answer /healthz.
  serveStatic: (options?: ServeStaticOptions) => MiddlewareHandler,
  // For app.notFound(): serves the SPA file or the 404 page of the collection.
  // If the collection has neither, or the client does not accept HTML, the
  // response is Hono's default 404 response.
  serveFallback: (options?: ServeFallbackOptions) => NotFoundHandler,
  // Selects the collection of each request with the collectionSelection of the
  // PublisherServer, and sets c.var.staticPublisher. A redirect of a sticky
  // source, or of the activate or reset path of the cookie source, is returned
  // in place of calling the next handler.
  selectCollection: () => MiddlewareHandler,
};

// The selection that selectCollection() of this server made for the request.
function getSelection(c: Context, server: PublisherServer): StaticPublisherVariables['staticPublisher'] | undefined {
  const selection = (c.var as Partial<StaticPublisherVariables>).staticPublisher;
  return selection?.publisherServer === server ? selection : undefined;
}

function resolveCollectionName(
  c: Context,
  option: CollectionNameOption | undefined,
  selection: StaticPublisherVariables['staticPublisher'] | undefined,
): string | null | undefined {
  const value = typeof option === 'function' ? option(c) : option;
  if (value !== undefined) {
    return value;
  }
  // The collection that selectCollection() chose. Without a selection,
  // undefined selects the active collection of the PublisherServer.
  return selection != null ? selection.collectionName : undefined;
}

export function fromPublisherServer(server: PublisherServer, defaults: PublisherServerMiddlewareDefaults = {}): PublisherServerMiddleware {

  const serveStatic = (callOptions: ServeStaticOptions = {}): MiddlewareHandler => {
    const options = { ...defaults, ...callOptions };
    return async (c, next) => {
      const selection = getSelection(c, server);
      // For a path source, the path without its prefix. A path option
      // replaces the request path (see resolveServeStaticPathname()).
      const requestPath = selection?.pathname ?? c.req.path;
      const pathname = resolveServeStaticPathname(requestPath, c, options);
      const response = pathname != null ? await server.serveRequest(c.req.raw, {
        collectionName: resolveCollectionName(c, options.collectionName, selection),
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
  };

  const serveFallback = (callOptions: ServeFallbackOptions = {}): NotFoundHandler => {
    const options = { ...defaults, ...callOptions };
    return async (c) => {
      const response = await server.serveFallback(c.req.raw, {
        collectionName: resolveCollectionName(c, options.collectionName, getSelection(c, server)),
      });
      return response ?? c.text('404 Not Found', 404);
    };
  };

  const selectCollection = (): MiddlewareHandler => {
    return async (c, next) => {
      const selection = server.resolveCollection(c.req.raw);
      if (selection.response != null) {
        return selection.response;
      }
      c.set('staticPublisher', {
        publisherServer: server,
        collectionName: selection.collectionName,
        pathname: selection.pathname,
      });
      await next();
    };
  };

  return { publisherServer: server, serveStatic, serveFallback, selectCollection };
}

export function fromStaticPublishRc(rc: StaticPublishRc, defaults: PublisherServerMiddlewareDefaults = {}): PublisherServerMiddleware {
  return fromPublisherServer(PublisherServer.fromStaticPublishRc(rc), defaults);
}
