/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { type FastlyApiContext, callFastlyApi } from '../util/api-token.js';

export type ActiveVersion = {
  number: number,
  comment: string | null,
};

// The active version of a service, or null if no version is active.
export async function getActiveVersion(context: FastlyApiContext, serviceId: string): Promise<ActiveVersion | null> {
  const response = await callFastlyApi(context, `/service/${encodeURIComponent(serviceId)}/details`, 'Get service details');
  const details = await response.json() as { active_version?: { number?: number, comment?: string | null } | null };
  const active = details.active_version;
  if (active == null || typeof active.number !== 'number') {
    return null;
  }
  return { number: active.number, comment: active.comment ?? null };
}

// The domains of a service version.
export async function getVersionDomains(context: FastlyApiContext, serviceId: string, version: number): Promise<string[]> {
  const response = await callFastlyApi(context, `/service/${encodeURIComponent(serviceId)}/version/${version}/domain`, 'List domains');
  const domains = await response.json() as { name?: string }[];
  return domains.flatMap(x => typeof x.name === 'string' ? [ x.name ] : []);
}
