/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import fs from 'fs';
import toml from 'toml';

// The service_id of a fastly.toml file, or undefined if it has none. An empty
// service_id is the same as none: the Fastly CLI writes service_id = "" when
// it removes a service after the first deploy fails or is cancelled.
export function readServiceId(filePath: string) {
  const text = fs.readFileSync(filePath, 'utf8');
  const parsed = toml.parse(text);
  const serviceId = parsed.service_id;
  if (typeof serviceId === 'string' && serviceId.trim() !== '') {
    return serviceId.trim();
  }
  return undefined;
}
