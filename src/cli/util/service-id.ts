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
};

// Finds the Fastly Service ID to purge after publishing. Checks, in order:
//   1. The command line (--fastly-service-id)
//   2. service_id in fastly.toml
//   3. The FASTLY_SERVICE_ID environment variable
export function loadServiceId(params: LoadServiceIdParams): LoadServiceIdResult | null {

  if (typeof params.commandLine === 'string' && params.commandLine.trim() !== '') {
    return { serviceId: params.commandLine.trim(), source: 'commandline' };
  }

  if (fs.existsSync(params.fastlyTomlPath)) {
    const serviceId = readServiceId(params.fastlyTomlPath);
    if (serviceId != null) {
      return { serviceId, source: 'fastly.toml' };
    }
  }

  const envServiceId = process.env.FASTLY_SERVICE_ID?.trim();
  if (envServiceId) {
    return { serviceId: envServiceId, source: 'env' };
  }

  return null;
}
