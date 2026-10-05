/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import path from 'node:path';

import { callFastlyApi, type FastlyApiContext, FetchError, loadApiToken } from './api-token.js';
import { loadServiceId } from './service-id.js';

export type PurgeTarget = {
  serviceId: string,
  fastlyApiContext: FastlyApiContext,
};

export type LoadPurgeTargetParams = {
  localMode: boolean,
  computeAppDir: string,
  fastlyServiceId: unknown,
  fastlyApiToken: unknown,
};

// Finds the service to purge after publishing, so that it stops serving cached
// copies of the collection. Returns null, and logs why, if the purge is skipped.
// Throws if a Service ID is found but an API token is not, so that this fails
// before anything is uploaded.
export function loadPurgeTarget(params: LoadPurgeTargetParams): PurgeTarget | null {

  if (params.localMode) {
    console.log(`- Local mode: will skip purge step after publish.`);
    return null;
  }

  const serviceIdResult = loadServiceId({
    commandLine: params.fastlyServiceId,
    fastlyTomlPath: path.resolve(params.computeAppDir, 'fastly.toml'),
  });
  if (serviceIdResult == null) {
    console.log(`- Service ID not found (--fastly-service-id, fastly.toml, or FASTLY_SERVICE_ID). Will skip purge step after publish.`);
    return null;
  }
  console.log(`✔️ Service ID from ${serviceIdResult.source}: ${serviceIdResult.serviceId}`);

  const apiTokenResult = loadApiToken({ commandLine: params.fastlyApiToken });
  if (apiTokenResult == null) {
    throw new Error("❌ Fastly API Token not provided.\nSet the FASTLY_API_TOKEN environment variable to an API token that can purge the service.");
  }

  return {
    serviceId: serviceIdResult.serviceId,
    fastlyApiContext: { apiToken: apiTokenResult.apiToken },
  };
}

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