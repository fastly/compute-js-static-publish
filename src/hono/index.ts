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

export {
  type BindingResource,
  type DefineExtensionOptions,
  EXTENSION_PHASES,
  type Extension,
  type ExtensionBindings,
  type ExtensionEntry,
  type ExtensionEnv,
  type ExtensionHelpers,
  type ExtensionPhase,
  type ExtensionPhaseFunction,
  type ExtensionPhases,
  defineExtension,
  mergeBindings,
} from './extensions.js';

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

// With collectionSelection: when the selected collection does not exist or has
// expired, 'not-found' gives a 404, and 'default' serves the default collection
// (a normal response of the default collection, with its headers). The default
// is collectionSelection.onMissing. It does nothing without collectionSelection.
export type OnMissingOption = 'not-found' | 'default';

export type ServeStaticOptions = ServeStaticPathOptions<Context> & {
  collectionName?: CollectionNameOption,
  onMissing?: OnMissingOption,
};

export type ServeFallbackOptions = {
  collectionName?: CollectionNameOption,
  onMissing?: OnMissingOption,
};

// Defaults for the middleware that fromPublisherServer() and fromStaticPublishRc()
// make. An option in a call replaces the default.
export type PublisherServerMiddlewareDefaults = {
  collectionName?: CollectionNameOption,
  onMissing?: OnMissingOption,
};

export type PublisherServerMiddleware = {
  publisherServer: PublisherServer,
  // Serves the file that matches the request. If no file matches, or the
  // method is not GET or HEAD, it calls the next handler. It does not serve the
  // SPA file or the 404 page (use serveFallback()), and does not answer /healthz.
  serveStatic: (options?: ServeStaticOptions) => MiddlewareHandler,
  // The response of the file that matches the request, or null, for use in a
  // handler. It takes the options of serveStatic(), and gets the same response.
  // It returns null if no file matches, or if the method is not GET or HEAD. It
  // never returns the SPA file or the 404 page.
  staticResponse: (c: Context, options?: ServeStaticOptions) => Promise<Response | null>,
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

  const staticResponse = async (c: Context, callOptions: ServeStaticOptions = {}): Promise<Response | null> => {
    const options = { ...defaults, ...callOptions };
    const selection = getSelection(c, server);
    // For a path source, the path without its prefix. A path option
    // replaces the request path (see resolveServeStaticPathname()).
    const requestPath = selection?.pathname ?? c.req.path;
    const pathname = resolveServeStaticPathname(requestPath, c, options);
    if (pathname == null) {
      return null;
    }
    return server.serveRequest(c.req.raw, {
      collectionName: resolveCollectionName(c, options.collectionName, selection),
      pathname,
      fallback: false,
      healthCheck: false,
      onMissing: options.onMissing,
    });
  };

  const serveStatic = (callOptions: ServeStaticOptions = {}): MiddlewareHandler => {
    return async (c, next) => {
      const response = await staticResponse(c, callOptions);
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
        onMissing: options.onMissing,
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

  return { publisherServer: server, serveStatic, staticResponse, serveFallback, selectCollection };
}

export function fromStaticPublishRc(rc: StaticPublishRc, defaults: PublisherServerMiddlewareDefaults = {}): PublisherServerMiddleware {
  return fromPublisherServer(PublisherServer.fromStaticPublishRc(rc), defaults);
}
