/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import fs from 'fs';
import toml from 'toml';

export function readServiceId(filePath: string) {
  const text = fs.readFileSync(filePath, 'utf8');
  const parsed = toml.parse(text);
  const serviceId = parsed.service_id;
  if (typeof serviceId === 'string') {
    return serviceId;
  }
  return undefined;
}
