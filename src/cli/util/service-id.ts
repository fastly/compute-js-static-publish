/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import fs from 'node:fs';

import { readServiceId } from './fastly-toml.js';

export type LoadServiceIdResult = {
  serviceId: string,
  source: string,
};

export type LoadServiceIdParams = {
  commandLine: unknown,
  fastlyTomlPath: string,
  // managed.serviceId of a managed project. Checked before fastly.toml.
  projectServiceId?: string,
};

// Finds the Fastly Service ID to purge after a change to a collection. Checks, in order:
//   1. The command line (--fastly-service-id)
//   2. The FASTLY_SERVICE_ID environment variable
//   3. managed.serviceId in static-publish.project.js (a managed project)
//   4. service_id in fastly.toml
// This is the same order as the Fastly CLI's --service-id.
export function loadServiceId(params: LoadServiceIdParams): LoadServiceIdResult | null {

  if (typeof params.commandLine === 'string' && params.commandLine.trim() !== '') {
    return { serviceId: params.commandLine.trim(), source: 'commandline' };
  }

  const envServiceId = process.env.FASTLY_SERVICE_ID?.trim();
  if (envServiceId) {
    return { serviceId: envServiceId, source: 'env' };
  }

  if (params.projectServiceId != null && params.projectServiceId.trim() !== '') {
    return { serviceId: params.projectServiceId.trim(), source: 'managed.serviceId' };
  }

  if (fs.existsSync(params.fastlyTomlPath)) {
    const serviceId = readServiceId(params.fastlyTomlPath);
    if (serviceId != null) {
      return { serviceId, source: 'fastly.toml' };
    }
  }

  return null;
}
