/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import fs from 'node:fs';
import path from 'node:path';

import { resourcesDir } from '../../util/resources.js';

// What a template adds to the app that generateApp() makes. A template only
// adds: it never replaces a file that generateApp() writes.
export type AppTemplate = {
  name: string,
  // Files of the app, keyed by the path relative to the app dir, for example
  // 'src/index.js'. They are copied as they are.
  files: Record<string, string>,
  // The entry file of the app, relative to the app dir: "main" in the
  // template's package.json, or src/index.js.
  entry: string,
  // From the template's package.json.
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>,
  supports: AppTemplateSupports,
};

// The features that the code of a template uses.
export type AppTemplateSupports = {
  // The entry file selects the collection of each request (resolveCollection()
  // or selectCollection()), so collectionSelection in the rc works.
  collectionSelection?: boolean,
};

// The templates in resources/templates/, and what each one supports.
const APP_TEMPLATES: Record<string, AppTemplateSupports> = {
  plain: { collectionSelection: true },
  hono: { collectionSelection: true },
};

export const APP_TEMPLATE_NAMES = Object.keys(APP_TEMPLATES);

export const DEFAULT_APP_TEMPLATE_NAME = 'plain';

// The files in a template directory that are not files of the app.
const TEMPLATE_PACKAGE_FILES = [ 'package.json', 'package-lock.json' ];

export function isAppTemplateName(name: string) {
  return APP_TEMPLATE_NAMES.includes(name);
}

// Reads resources/templates/<name>/.
export function loadAppTemplate(name: string): AppTemplate {
  if (!isAppTemplateName(name)) {
    throw new Error(`Unknown template '${name}'. Valid templates: ${APP_TEMPLATE_NAMES.join(', ')}.`);
  }
  const templateDir = path.resolve(resourcesDir, 'templates', name);

  const files: Record<string, string> = {};
  const walk = (sub: string) => {
    for (const entry of fs.readdirSync(path.resolve(templateDir, sub), { withFileTypes: true })) {
      const rel = path.posix.join(sub, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') {
          walk(rel);
        }
        continue;
      }
      if (sub === '' && TEMPLATE_PACKAGE_FILES.includes(entry.name)) {
        continue;
      }
      files[rel] = fs.readFileSync(path.resolve(templateDir, rel), 'utf-8');
    }
  };
  walk('');

  const packageJson = JSON.parse(fs.readFileSync(path.resolve(templateDir, 'package.json'), 'utf-8'));

  return {
    name,
    files,
    entry: packageJson.main ?? 'src/index.js',
    dependencies: packageJson.dependencies ?? {},
    devDependencies: packageJson.devDependencies ?? {},
    supports: APP_TEMPLATES[name],
  };
}
