/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { getCookieValue } from '../util/cookies.js';
import {
  type CollectionNameSelectorResult,
  type RequestCollectionNameSelector,
} from './request-collection-selector.js';

export type CookieCollectionSelectorOpts = {
  cookieName: string,
  activatePath: string,
  resetPath: string,
  cookieHttpOnly: boolean,
  cookieMaxAge: number | undefined,
  cookiePath: string,
};

export class CookieCollectionSelector implements RequestCollectionNameSelector {
  public constructor();
  public constructor(cookieName: string);
  public constructor(opts: Partial<CookieCollectionSelectorOpts>);
  public constructor(optsOrCookieName?: string | Partial<CookieCollectionSelectorOpts>) {
    let opts = optsOrCookieName;
    if (opts === undefined) {
      opts = {};
    } else if (typeof opts === 'string') {
      opts = {
        cookieName: opts,
      };
    }

    this.opts = {
      cookieName: opts.cookieName ?? 'publisher-collection',
      activatePath: opts.activatePath ?? '/activate',
      resetPath: opts.resetPath ?? '/reset',
      cookieHttpOnly: opts.cookieHttpOnly ?? true,
      cookieMaxAge: opts.cookieMaxAge,
      cookiePath: opts.cookiePath ?? '/',
    };
  }

  public opts: CookieCollectionSelectorOpts;

  public getCollectionName(request: Request): CollectionNameSelectorResult {
    return getCookieValue(request, this.opts.cookieName);
  }

  public applySelector(request: Request) {

    const url = new URL(request.url);

    if (url.pathname === this.opts.activatePath) {
      const collectionName = url.searchParams.get('collection');
      if (collectionName == null) {
        return new Response(`Missing required 'collection' query parameter.`, { status: 400 });
      }
      const redirectTo = url.searchParams.get('redirectTo') ?? '/';

      const cookieSegments = [
        `${this.opts.cookieName}=${collectionName}`,
      ];
      cookieSegments.push(`Path=${this.opts.cookiePath}`);
      if (this.opts.cookieMaxAge != null) {
        cookieSegments.push(`Max-Age=${this.opts.cookieMaxAge}`);
      }
      if (this.opts.cookieHttpOnly) {
        cookieSegments.push('HttpOnly');
      }
      if (url.protocol === 'https:') {
        cookieSegments.push('Secure');
      }
      cookieSegments.push(`SameSite=Lax`);

      const headers = new Headers();
      headers.append("Set-Cookie", cookieSegments.join(';'));
      headers.set("Location", redirectTo);

      return new Response(null, {
        status: 302,
        headers,
      });
    }

    if (url.pathname === this.opts.resetPath) {
      const redirectTo = url.searchParams.get('redirectTo') ?? '/';

      const cookieSegments = [
        `${this.opts.cookieName}=`,
      ];
      cookieSegments.push(`Path=${this.opts.cookiePath}`);
      cookieSegments.push(`Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
      if (this.opts.cookieHttpOnly) {
        cookieSegments.push('HttpOnly');
      }
      if (url.protocol === 'https:') {
        cookieSegments.push('Secure');
      }

      const headers = new Headers();
      headers.append("Set-Cookie", cookieSegments.join(';'));
      headers.set("Location", redirectTo);

      return new Response(null, {
        status: 302,
        headers,
      });
    }

    return null;
  }
}

export interface FromCookieResult {
  collectionName: CollectionNameSelectorResult,
  redirectResponse: Response | null,
}

export function fromCookie(request: Request, optsOrCookieName?: string | CookieCollectionSelectorOpts): FromCookieResult {

  let selector;
  if (optsOrCookieName === undefined) {
    selector = new CookieCollectionSelector();
  } else if (typeof optsOrCookieName === 'string') {
    selector = new CookieCollectionSelector(optsOrCookieName);
  } else {
    selector = new CookieCollectionSelector(optsOrCookieName);
  }

  return {
    collectionName: selector.getCollectionName(request),
    redirectResponse: selector.applySelector(request),
  };
}
