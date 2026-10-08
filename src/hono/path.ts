/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// The path options of serveStatic(), as in the serveStatic() of Hono.
export type ServeStaticPathOptions<C> = {
  // The path to serve, in place of the request path. For example, './favicon.ico'.
  path?: string,
  // The directory that request paths are relative to, in the published files
  // (after publicDir). The default is './'.
  root?: string,
  // Changes the request path before it is resolved against root. For example,
  // to remove the prefix of the route: (path) => path.replace(/^\/assets/, '').
  rewriteRequestPath?: (path: string, c: C) => string,
};

// The pathname to give to PublisherServer, or null if the path is outside the
// root. requestPath is decoded, as Hono's c.req.path is.
export function resolveServeStaticPathname<C>(requestPath: string, c: C, options: ServeStaticPathOptions<C>): string | null {
  let root = options.root ?? './';
  if (!root.endsWith('/')) {
    root += '/';
  }
  const base = new URL(encodePath(root), 'https://www.example.com/');

  let reqPath = options.path ??
    (options.rewriteRequestPath != null ? options.rewriteRequestPath(requestPath, c) : requestPath);
  if (reqPath.startsWith('/')) {
    reqPath = '.' + reqPath;
  }

  // A decoded path can have '..'. Do not serve a path outside the root.
  const pathname = new URL(encodePath(reqPath), base).pathname;
  if (!pathname.startsWith(base.pathname)) {
    return null;
  }
  return decodePath(pathname);
}

// Encode each segment, so that URL resolves only the slashes and the '.' and
// '..' segments of a decoded path. A '%', '?', or '#' in a segment stays in it.
function encodePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function decodePath(path: string) {
  return path.split('/').map(decodeURIComponent).join('/');
}
