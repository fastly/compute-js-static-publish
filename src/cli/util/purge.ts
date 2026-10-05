/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import path from 'node:path';

import { callFastlyApi, type FastlyApiContext, FetchError, loadApiToken } from './api-token.js';
import { loadServiceId } from './service-id.js';

export const purgeEnvironments = [ 'production', 'staging' ] as const;
export type PurgeEnvironment = typeof purgeEnvironments[number];

// Parses the values of --purge-environment. The option can be repeated, and
// each value can be a comma-separated list. The default is production.
export function parsePurgeEnvironments(values: unknown): PurgeEnvironment[] {
  const list = Array.isArray(values) ? values : values == null ? [] : [ values ];
  const result: PurgeEnvironment[] = [];
  for (const value of list) {
    for (const item of String(value).split(',')) {
      const name = item.trim();
      if (name === '') {
        continue;
      }
      if (!(purgeEnvironments as Readonly<string[]>).includes(name)) {
        throw new Error(`❌ Unknown --purge-environment '${name}'. Use ${purgeEnvironments.join(', ')}, or a comma-separated list of them.`);
      }
      if (!result.includes(name as PurgeEnvironment)) {
        result.push(name as PurgeEnvironment);
      }
    }
  }
  return result.length > 0 ? result : [ 'production' ];
}

export type PurgeTarget = {
  serviceId: string,
  fastlyApiContext: FastlyApiContext,
  environments: PurgeEnvironment[],
};

export type LoadPurgeTargetParams = {
  localMode: boolean,
  computeAppDir: string,
  fastlyServiceId: unknown,
  fastlyApiToken: unknown,
  purgeEnvironments: unknown,
};

// Finds the service to purge after publishing, so that it stops serving cached
// copies of the collection. Returns null, and logs why, if the purge is skipped.
// Throws if a Service ID is found but an API token is not, so that this fails
// before anything is uploaded.
export function loadPurgeTarget(params: LoadPurgeTargetParams): PurgeTarget | null {

  // Check the option even when the purge is skipped, so that a typo is reported.
  const environments = parsePurgeEnvironments(params.purgeEnvironments);

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

  console.log(`✔️ Purge environments: ${environments.join(', ')}`);

  return {
    serviceId: serviceIdResult.serviceId,
    fastlyApiContext: { apiToken: apiTokenResult.apiToken },
    environments,
  };
}

export async function purgeSurrogateKey(
  fastlyApiContext: FastlyApiContext,
  fastlyServiceId: string,
  surrogateKey: string,
  softPurge: boolean = false,
  environment: PurgeEnvironment = 'production',
) {

  const endpoint = `/service/${encodeURIComponent(fastlyServiceId)}/purge`;

  try {

    const headers = new Headers();
    headers.set('surrogate-key', surrogateKey);
    if (softPurge) {
      headers.set('fastly-soft-purge', '1');
    }
    // A purge without this header applies to production. Staging needs it.
    // See https://www.fastly.com/documentation/guides/getting-started/services/working-with-staging/
    if (environment === 'staging') {
      headers.set('fastly-purge-environment', 'staging');
    }
    await callFastlyApi(fastlyApiContext, endpoint, `Purging surrogate key [${surrogateKey}] on service [${fastlyServiceId}] (${environment})`, null, { method: 'POST', headers });

  } catch(err) {
    if (err instanceof FetchError) {
      return false;
    }
    throw err;
  }

  return true;

}