/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { plainTemplate } from './plain.js';

// What a template adds to the app that generateApp() makes. A template only
// adds: it never replaces a file or a value that generateApp() writes.
export type AppTemplate = {
  // Files of the app, keyed by the path relative to the app dir, for example
  // 'src/index.js'. Must not be a path that generateApp() writes.
  files: Record<string, string>,
  // Added to "dependencies" in package.json.
  dependencies: Record<string, string>,
  // Added to "devDependencies" in package.json.
  devDependencies?: Record<string, string>,
  // Lines added to .gitignore.
  gitignore?: string[],
  supports?: {
    collectionSelection?: boolean,
  },
};

// Only 'plain' in 8.1. Users cannot select a template yet.
export const appTemplates: Record<string, AppTemplate> = {
  plain: plainTemplate,
};
