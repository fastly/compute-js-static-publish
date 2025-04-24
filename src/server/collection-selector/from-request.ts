/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import {
  type CollectionNameSelectorResult,
  type RequestCollectionNameSelector,
} from './request-collection-selector.js';

export type RequestToCollectionNameFunc = (request: Request) => CollectionNameSelectorResult;
type UrlToCollectionNameFunc = (url: URL) => string | null;


export class RequestCollectionNameFuncSelector implements RequestCollectionNameSelector {
  public constructor(
    func: RequestToCollectionNameFunc
  ) {
    this.func = func;
  }

  public func: RequestToCollectionNameFunc;

  public getCollectionName(request: Request) {
    return this.func(request);
  }
}

export function fromRequest(request: Request, func: RequestToCollectionNameFunc): CollectionNameSelectorResult {

  const selector = new RequestCollectionNameFuncSelector(func);
  return selector.getCollectionName(request);

}

export function fromRequestUrl(request: Request, func: UrlToCollectionNameFunc): CollectionNameSelectorResult {

  return fromRequest(request, (req) => func(new URL(req.url)));

}

export function fromHostDomain(request: Request, hostRegex: RegExp): CollectionNameSelectorResult {
  return fromRequestUrl(
    request,
    (url) => url.host.match(hostRegex)?.[1] ?? null,
  );
}
