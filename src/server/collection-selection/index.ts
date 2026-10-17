/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Chooses the collection for a request from a collectionSelection config.
// This module does not import fastly:*, so that the unit tests can load it.

import { COLLECTION_NAME_RULE, isValidCollectionName } from '../../models/collections/index.js';
import {
  type CollectionSelection,
  type CollectionSelectionCookieSource,
  type CollectionSelectionSource,
  type CollectionSelectionSourceType,
  COOKIE_SOURCE_DEFAULTS,
  isCollectionNameAllowed,
  splitPattern,
  validateCollectionSelection,
} from '../../models/config/collection-selection.js';
import { getCookieValue } from '../util/cookies.js';

export type ResolveCollectionResult = {
  // The selected collection, or null for the default collection.
  collectionName: string | null,
  // The path to look up, without the prefix of a path source. Decoded, and
  // starts with '/'. Pass it to serveRequest() as the pathname option.
  pathname?: string,
  // A response to return in place of serving a file: a redirect of a sticky
  // source, or of the activate or reset path of the cookie source.
  response?: Response,
  // The source that selected the collection, or that made the response.
  matchedBy?: CollectionSelectionSourceType,
};

type CompiledCookie = Required<Omit<CollectionSelectionCookieSource, 'maxAge'>> & { maxAge?: number };

type Compiled = {
  config: CollectionSelection,
  cookie: CompiledCookie | null,
  matchers: ((url: URL, request: Request) => { collectionName: string, pathname?: string } | null)[],
};

const NAME_GROUP = '([a-z0-9-]{1,63})';

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const compiledConfigs = new WeakMap<CollectionSelection, Compiled>();

function compile(config: CollectionSelection): Compiled {
  let compiled = compiledConfigs.get(config);
  if (compiled != null) {
    return compiled;
  }
  const errors = validateCollectionSelection(config);
  if (errors.length > 0) {
    throw new TypeError(`Invalid collectionSelection:\n${errors.join('\n')}`);
  }

  const cookieSource = config.sources.find(x => x.type === 'cookie') as CollectionSelectionCookieSource | undefined;
  const cookie: CompiledCookie | null = cookieSource != null ? {
    type: 'cookie',
    cookieName: cookieSource.cookieName ?? COOKIE_SOURCE_DEFAULTS.cookieName,
    activatePath: cookieSource.activatePath ?? COOKIE_SOURCE_DEFAULTS.activatePath,
    resetPath: cookieSource.resetPath ?? COOKIE_SOURCE_DEFAULTS.resetPath,
    maxAge: cookieSource.maxAge,
  } : null;

  const allowed = (value: string | null | undefined): value is string =>
    value != null && isCollectionNameAllowed(value, config.allow);

  const matchers = config.sources.map((source: CollectionSelectionSource): Compiled['matchers'][number] => {
    switch (source.type) {
    case 'host': {
      const parts = splitPattern(source.pattern)!;
      const re = new RegExp(`^${escapeRegExp(parts.before.toLowerCase())}${NAME_GROUP}${escapeRegExp(parts.after.toLowerCase())}$`);
      return (url) => {
        const name = re.exec(url.hostname.toLowerCase())?.[1];
        return allowed(name) ? { collectionName: name } : null;
      };
    }
    case 'path': {
      const parts = splitPattern(source.prefix)!;
      const re = new RegExp(`^${escapeRegExp(parts.before)}${NAME_GROUP}${escapeRegExp(parts.after)}(/.*)?$`);
      return (url) => {
        const match = re.exec(url.pathname);
        if (match == null || !allowed(match[1])) {
          return null;
        }
        let pathname;
        try {
          pathname = decodeURI(match[2] ?? '/');
        } catch {
          return null;
        }
        return { collectionName: match[1], pathname };
      };
    }
    case 'query':
      return (url) => {
        const name = url.searchParams.get(source.param);
        return allowed(name) ? { collectionName: name } : null;
      };
    case 'cookie':
      return (_url, request) => {
        const name = getCookieValue(request, cookie!.cookieName);
        return allowed(name) ? { collectionName: name } : null;
      };
    case 'header':
      return (_url, request) => {
        const name = request.headers.get(source.name)?.trim();
        return allowed(name) ? { collectionName: name } : null;
      };
    }
  });

  compiled = { config, cookie, matchers };
  compiledConfigs.set(config, compiled);
  return compiled;
}

// A Location value that stays on this site: a path that starts with exactly one
// '/'. A value such as '//example.com' or '/\example.com' is a URL of another
// site for a browser, so it becomes '/'. So does a value with control characters.
export function sameSiteLocation(value: string): string {
  if (!value.startsWith('/') || value[1] === '/' || value[1] === '\\' || /[\u0000-\u001f\u007f]/.test(value)) {
    return '/';
  }
  return value;
}

function cookieAttributes(url: URL, maxAge: number | undefined) {
  const segments = [ 'Path=/' ];
  if (maxAge != null) {
    segments.push(`Max-Age=${maxAge}`);
  }
  segments.push('HttpOnly');
  if (url.protocol === 'https:') {
    segments.push('Secure');
  }
  segments.push('SameSite=Lax');
  return segments;
}

function redirect(location: string, setCookie: string): Response {
  const headers = new Headers();
  headers.append('Set-Cookie', setCookie);
  headers.set('Location', sameSiteLocation(location));
  // A redirect that sets a cookie must not be stored by a shared cache.
  headers.set('Cache-Control', 'no-store');
  return new Response(null, { status: 302, headers });
}

function setCookieValue(cookie: CompiledCookie, url: URL, collectionName: string) {
  return [ `${cookie.cookieName}=${collectionName}`, ...cookieAttributes(url, cookie.maxAge) ].join('; ');
}

function clearCookieValue(cookie: CompiledCookie, url: URL) {
  return [ `${cookie.cookieName}=`, ...cookieAttributes(url, 0) ].join('; ');
}

// Choose the collection for a request. With no sources, every request gets the
// default collection (collectionName: null). Throws a TypeError if the config is
// not valid.
export function resolveCollection(request: Request, config: CollectionSelection | null | undefined): ResolveCollectionResult {
  if (config == null) {
    return { collectionName: null };
  }
  const compiled = compile(config);
  const url = new URL(request.url);

  // The activate and reset paths of the cookie source.
  const cookie = compiled.cookie;
  if (cookie != null && (request.method === 'GET' || request.method === 'HEAD')) {
    if (url.pathname === cookie.activatePath) {
      const collectionName = url.searchParams.get('collection');
      if (collectionName == null) {
        return { collectionName: null, matchedBy: 'cookie', response: new Response(`Missing required 'collection' query parameter.`, { status: 400 }) };
      }
      if (!isValidCollectionName(collectionName)) {
        return { collectionName: null, matchedBy: 'cookie', response: new Response(`The 'collection' query parameter is not a valid collection name. ${COLLECTION_NAME_RULE}`, { status: 400 }) };
      }
      if (!isCollectionNameAllowed(collectionName, config.allow)) {
        return { collectionName: null, matchedBy: 'cookie', response: new Response(`The collection '${collectionName}' cannot be selected.`, { status: 403 }) };
      }
      return {
        collectionName,
        matchedBy: 'cookie',
        response: redirect(url.searchParams.get('redirectTo') ?? '/', setCookieValue(cookie, url, collectionName)),
      };
    }
    if (url.pathname === cookie.resetPath) {
      return {
        collectionName: null,
        matchedBy: 'cookie',
        response: redirect(url.searchParams.get('redirectTo') ?? '/', clearCookieValue(cookie, url)),
      };
    }
  }

  for (const [ index, matcher ] of compiled.matchers.entries()) {
    const match = matcher(url, request);
    if (match == null) {
      continue;
    }
    const source = config.sources[index];
    const result: ResolveCollectionResult = { collectionName: match.collectionName, matchedBy: source.type };
    if (match.pathname != null) {
      result.pathname = match.pathname;
    }

    // Sticky: set the cookie, and redirect to the URL without the selector.
    if ((source.type === 'path' || source.type === 'query') && source.sticky === 'cookie' && cookie != null &&
      (request.method === 'GET' || request.method === 'HEAD')) {
      let location;
      if (source.type === 'path') {
        // The path without the prefix, not decoded.
        const parts = splitPattern(source.prefix)!;
        const prefix = parts.before + match.collectionName + parts.after;
        location = (url.pathname.slice(prefix.length) || '/') + url.search;
      } else {
        const params = new URLSearchParams(url.search);
        params.delete(source.param);
        const search = params.toString();
        location = url.pathname + (search !== '' ? `?${search}` : '');
      }
      result.response = redirect(location, setCookieValue(cookie, url, match.collectionName));
    }
    return result;
  }

  return { collectionName: null };
}
