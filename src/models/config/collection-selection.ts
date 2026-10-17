/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { COLLECTION_NAME_RULE, isValidCollectionName } from '../collections/index.js';

// Collection selection: the options that choose which collection serves a
// request, for example for previews. The config is data only (strings, numbers,
// and booleans), so that each field can also be a scaffold flag.
// The resolver is in server/collection-selection/.

export const COLLECTION_PLACEHOLDER = '{collection}';

export type CollectionSelectionHostSource = {
  type: 'host',
  // The hostname, with one {collection} placeholder in one label, for example
  // '{collection}.preview.example.com' or 'branch-{collection}.preview.example.com'.
  pattern: string,
};

export type CollectionSelectionPathSource = {
  type: 'path',
  // A path prefix with one {collection} placeholder, for example '/_preview/{collection}'.
  // The prefix is removed before the file lookup.
  prefix: string,
  // 'cookie': also set the cookie of the cookie source, and redirect to the path without the prefix.
  sticky?: 'cookie',
};

export type CollectionSelectionQuerySource = {
  type: 'query',
  // The name of the query parameter.
  param: string,
  // 'cookie': also set the cookie of the cookie source, and redirect to the URL without the parameter.
  sticky?: 'cookie',
};

export type CollectionSelectionCookieSource = {
  type: 'cookie',
  // Default: 'publisher-collection'.
  cookieName?: string,
  // Sets the cookie from the 'collection' query parameter. Default: '/activate'.
  activatePath?: string,
  // Removes the cookie. Default: '/reset'.
  resetPath?: string,
  // The Max-Age of the cookie, in seconds. Default: none (a session cookie).
  maxAge?: number,
};

export type CollectionSelectionHeaderSource = {
  type: 'header',
  // The name of the request header.
  name: string,
};

export type CollectionSelectionSource =
  | CollectionSelectionHostSource
  | CollectionSelectionPathSource
  | CollectionSelectionQuerySource
  | CollectionSelectionCookieSource
  | CollectionSelectionHeaderSource;

export type CollectionSelectionSourceType = CollectionSelectionSource['type'];

export type CollectionSelection = {
  // Tried in order. The first source that gives a collection wins. If no source
  // gives a collection, the default collection is used.
  sources: CollectionSelectionSource[],
  // The collections that can be selected, as glob patterns ('*' matches any
  // characters of a name). Default: any collection.
  allow?: string[],
  // When the selected collection does not exist or has expired:
  // 'not-found' (default) or 'default' (serve the default collection).
  onMissing?: 'not-found' | 'default',
  // Add 'X-Robots-Tag: noindex' to the responses of a collection that is not
  // the default collection. Default: true.
  noindex?: boolean,
};

export const COOKIE_SOURCE_DEFAULTS = {
  cookieName: 'publisher-collection',
  activatePath: '/activate',
  resetPath: '/reset',
} as const;

const SOURCE_TYPES: readonly string[] = [ 'host', 'path', 'query', 'cookie', 'header' ];

// RFC 7230 token: the characters of a header name or a cookie name.
const TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

// A host label has at most 63 characters.
const MAX_LABEL_LENGTH = 63;

const ALLOW_PATTERN = /^[a-z0-9*-]+$/;

// The parts of a pattern around its one {collection} placeholder.
export type PatternParts = { before: string, after: string };

export function splitPattern(pattern: string): PatternParts | null {
  const index = pattern.indexOf(COLLECTION_PLACEHOLDER);
  if (index === -1 || pattern.indexOf(COLLECTION_PLACEHOLDER, index + 1) !== -1) {
    return null;
  }
  return {
    before: pattern.slice(0, index),
    after: pattern.slice(index + COLLECTION_PLACEHOLDER.length),
  };
}

// The fixed text in the host label that has the placeholder.
export function hostLabelFixedLength(parts: PatternParts): number {
  const before = parts.before.slice(parts.before.lastIndexOf('.') + 1);
  const afterDot = parts.after.indexOf('.');
  const after = afterDot === -1 ? parts.after : parts.after.slice(0, afterDot);
  return before.length + after.length;
}

// The longest collection name that fits in the host label of a host pattern.
export function maxCollectionNameLengthForHost(pattern: string): number {
  const parts = splitPattern(pattern);
  if (parts == null) {
    return 0;
  }
  return MAX_LABEL_LENGTH - hostLabelFixedLength(parts);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function allowPatternToRegExp(pattern: string): RegExp {
  return new RegExp('^' + pattern.split('*').map(escapeRegExp).join('[a-z0-9-]*') + '$');
}

// Returns true if the name is valid, and allow (if set) has a pattern that matches it.
export function isCollectionNameAllowed(collectionName: string, allow: readonly string[] | undefined): boolean {
  if (!isValidCollectionName(collectionName)) {
    return false;
  }
  if (allow == null) {
    return true;
  }
  return allow.some(pattern => allowPatternToRegExp(pattern).test(collectionName));
}

// Returns the errors in a collectionSelection config. An empty list means that it is valid.
export function validateCollectionSelection(config: unknown): string[] {
  const errors: string[] = [];
  if (config == null || typeof config !== 'object' || Array.isArray(config)) {
    return [ 'collectionSelection must be an object.' ];
  }
  const { sources, allow, onMissing, noindex } = config as Record<string, unknown>;

  if (!Array.isArray(sources)) {
    errors.push('collectionSelection.sources must be an array.');
  } else {
    let cookieSources = 0;
    let stickySources = 0;
    sources.forEach((source: unknown, index) => {
      const name = `collectionSelection.sources[${index}]`;
      if (source == null || typeof source !== 'object') {
        errors.push(`${name} must be an object.`);
        return;
      }
      const s = source as Record<string, unknown>;
      if (typeof s.type !== 'string' || !SOURCE_TYPES.includes(s.type)) {
        errors.push(`${name}.type must be one of ${SOURCE_TYPES.map(x => `'${x}'`).join(', ')}.`);
        return;
      }
      switch (s.type) {
      case 'host': {
        const parts = typeof s.pattern === 'string' ? splitPattern(s.pattern) : null;
        if (parts == null) {
          errors.push(`${name}.pattern must be a string with exactly one ${COLLECTION_PLACEHOLDER}.`);
        } else if (!/^[a-z0-9.-]*$/i.test(parts.before + parts.after)) {
          errors.push(`${name}.pattern must be a hostname: use only a-z, 0-9, '-', and '.' around ${COLLECTION_PLACEHOLDER}.`);
        } else if (MAX_LABEL_LENGTH - hostLabelFixedLength(parts) < 1) {
          errors.push(`${name}.pattern: the host label with ${COLLECTION_PLACEHOLDER} has no room for a name (at most ${MAX_LABEL_LENGTH} characters).`);
        }
        break;
      }
      case 'path': {
        const parts = typeof s.prefix === 'string' ? splitPattern(s.prefix) : null;
        if (parts == null) {
          errors.push(`${name}.prefix must be a string with exactly one ${COLLECTION_PLACEHOLDER}.`);
        } else if (!parts.before.startsWith('/')) {
          errors.push(`${name}.prefix must start with '/'.`);
        } else if (parts.after.endsWith('/')) {
          errors.push(`${name}.prefix must not end with '/'.`);
        } else if (/[?#]/.test(parts.before + parts.after)) {
          errors.push(`${name}.prefix must not contain '?' or '#'.`);
        }
        break;
      }
      case 'query':
        if (typeof s.param !== 'string' || s.param === '') {
          errors.push(`${name}.param must be a non-empty string.`);
        }
        break;
      case 'cookie':
        cookieSources++;
        if (s.cookieName !== undefined && (typeof s.cookieName !== 'string' || !TOKEN_PATTERN.test(s.cookieName))) {
          errors.push(`${name}.cookieName must be a valid cookie name.`);
        }
        for (const field of [ 'activatePath', 'resetPath' ]) {
          if (s[field] !== undefined && (typeof s[field] !== 'string' || !(s[field] as string).startsWith('/'))) {
            errors.push(`${name}.${field} must be a string that starts with '/'.`);
          }
        }
        if (s.maxAge !== undefined && (!Number.isInteger(s.maxAge) || (s.maxAge as number) < 0)) {
          errors.push(`${name}.maxAge must be an integer that is 0 or more.`);
        }
        break;
      case 'header':
        if (typeof s.name !== 'string' || !TOKEN_PATTERN.test(s.name)) {
          errors.push(`${name}.name must be a valid header name.`);
        }
        break;
      }
      if (s.sticky !== undefined) {
        if (s.type !== 'path' && s.type !== 'query') {
          errors.push(`${name}.sticky is only for the 'path' and 'query' sources.`);
        } else if (s.sticky !== 'cookie') {
          errors.push(`${name}.sticky must be 'cookie'.`);
        } else {
          stickySources++;
        }
      }
    });
    if (cookieSources > 1) {
      errors.push(`collectionSelection.sources must have at most one 'cookie' source.`);
    }
    if (stickySources > 0 && cookieSources === 0) {
      errors.push(`sticky: 'cookie' needs a 'cookie' source in collectionSelection.sources, for the settings of the cookie.`);
    }
  }

  if (allow !== undefined) {
    if (!Array.isArray(allow) || !allow.every(x => typeof x === 'string' && ALLOW_PATTERN.test(x))) {
      errors.push(`collectionSelection.allow must be an array of patterns. Use a-z, 0-9, '-', and '*'.`);
    }
  }

  if (onMissing !== undefined && onMissing !== 'not-found' && onMissing !== 'default') {
    errors.push(`collectionSelection.onMissing must be 'not-found' or 'default'.`);
  }

  if (noindex !== undefined && typeof noindex !== 'boolean') {
    errors.push(`collectionSelection.noindex must be a boolean.`);
  }

  return errors;
}

// The URL that shows a collection, from the first source that can make one.
// baseUrl is the URL of the service, for example 'https://example.edgecompute.app'.
// The host source uses only its protocol. Returns null if no source can make a
// URL (for example, only a header source). Throws for a name that cannot be
// selected, or that does not fit in the host label.
export function previewUrl(collectionName: string, baseUrl: string, config: CollectionSelection): string | null {
  if (!isValidCollectionName(collectionName)) {
    throw new Error(`'${collectionName}' is not a valid collection name. ${COLLECTION_NAME_RULE}`);
  }
  if (!isCollectionNameAllowed(collectionName, config.allow)) {
    throw new Error(`'${collectionName}' is not in collectionSelection.allow.`);
  }
  const base = new URL(baseUrl);
  for (const source of config.sources) {
    switch (source.type) {
    case 'host': {
      const maxLength = maxCollectionNameLengthForHost(source.pattern);
      if (collectionName.length > maxLength) {
        throw new Error(`'${collectionName}' is too long for the host pattern '${source.pattern}': a host label has at most ${MAX_LABEL_LENGTH} characters, so the name can have at most ${maxLength}.`);
      }
      return `${base.protocol}//${source.pattern.replace(COLLECTION_PLACEHOLDER, collectionName).toLowerCase()}/`;
    }
    case 'path':
      return `${base.origin}${source.prefix.replace(COLLECTION_PLACEHOLDER, collectionName)}/`;
    case 'query': {
      const url = new URL('/', base);
      url.searchParams.set(source.param, collectionName);
      return url.href;
    }
    case 'cookie': {
      const url = new URL(source.activatePath ?? COOKIE_SOURCE_DEFAULTS.activatePath, base);
      url.searchParams.set('collection', collectionName);
      url.searchParams.set('redirectTo', '/');
      return url.href;
    }
    }
  }
  return null;
}
