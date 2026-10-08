/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { plainTemplate } from './plain.js';
import { honoTemplate } from './hono.js';

// The parts of a scaffolded Compute app that change with --template.
export type AppTemplate = {
  // Added to "dependencies" in package.json.
  dependencies: Record<string, string>,
  // The content of src/index.js.
  indexJs: string,
};

export const appTemplates: Record<string, AppTemplate> = {
  plain: plainTemplate,
  hono: honoTemplate,
};
