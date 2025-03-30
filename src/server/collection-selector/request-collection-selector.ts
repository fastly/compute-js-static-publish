/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

export type CollectionNameSelectorResult = string | null;

export interface RequestCollectionNameSelector {
  getCollectionName(request: Request): CollectionNameSelectorResult;
}
