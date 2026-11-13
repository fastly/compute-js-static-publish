/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { type FastlyApiContext, FetchError, callFastlyApi } from '../util/api-token.js';
import { type DeployedApp, findDeployedApp, parseVersionComment } from './fingerprint.js';

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

// The versions of a service, with their comments.
export async function getVersions(context: FastlyApiContext, serviceId: string): Promise<{ number: number, comment: string | null }[]> {
  const response = await callFastlyApi(context, `/service/${encodeURIComponent(serviceId)}/version`, 'List versions');
  const versions = await response.json() as { number?: number, comment?: string | null }[];
  return versions.flatMap(x => typeof x.number === 'number' ? [ { number: x.number, comment: x.comment ?? null } ] : []);
}

// The hash of the package of a service version, or null if it has no package.
export async function getPackageHash(context: FastlyApiContext, serviceId: string, version: number): Promise<string | null> {
  let response;
  try {
    response = await callFastlyApi(context, `/service/${encodeURIComponent(serviceId)}/version/${version}/package`, 'Get package');
  } catch (err) {
    if (err instanceof FetchError && err.status === 404) {
      return null;
    }
    throw err;
  }
  const pkg = await response.json() as { metadata?: { hashsum?: string } | null };
  return typeof pkg.metadata?.hashsum === 'string' && pkg.metadata.hashsum !== '' ? pkg.metadata.hashsum : null;
}

// The app that the active version runs (see findDeployedApp()).
export async function getDeployedApp(context: FastlyApiContext, serviceId: string, active: ActiveVersion): Promise<DeployedApp | null> {
  const own = parseVersionComment(active.comment);
  if (own != null) {
    return own;
  }
  return findDeployedApp(active, await getVersions(context, serviceId), (version) => getPackageHash(context, serviceId, version));
}
