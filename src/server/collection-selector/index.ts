/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

export {
  type CollectionNameSelectorResult,
  type RequestCollectionNameSelector,
} from './request-collection-selector.js';
export {
  RequestCollectionNameFuncSelector,
  fromRequest,
  fromRequestUrl,
  fromHostDomain,
} from './from-request.js';
export {
  CookieCollectionSelector,
  fromCookie,
  type CookieCollectionSelectorOpts,
  type FromCookieResult,
} from './from-cookie.js';
export {
  fromConfigStore,
} from './from-config-store.js';
