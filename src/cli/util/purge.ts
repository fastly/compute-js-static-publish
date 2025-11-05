/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { callFastlyApi, type FastlyApiContext, FetchError } from './api-token.js';

export async function purgeSurrogateKey(
  fastlyApiContext: FastlyApiContext,
  fastlyServiceId: string,
  surrogateKey: string,
  softPurge: boolean = false,
) {

  const endpoint = `/service/${encodeURIComponent(fastlyServiceId)}/purge`;

  try {

    const headers = new Headers();
    headers.set('surrogate-key', surrogateKey);
    if (softPurge) {
      headers.set('fastly-soft-purge', '1');
    }
    await callFastlyApi(fastlyApiContext, endpoint, `Purging surrogate key [${surrogateKey}] on service [${fastlyServiceId}]`, null, { method: 'POST', headers });

  } catch(err) {
    if (err instanceof FetchError) {
      return false;
    }
    throw err;
  }

  return true;

}