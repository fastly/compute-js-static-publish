/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import path from 'node:path';

import nunjucks from 'nunjucks';

import { resourcesDir } from '../../util/resources.js';

// The templates in resources/app/ write each value through one of these
// filters, so that a value can never break the syntax of the file. Autoescape
// is off, because its escaping is for HTML.

// A string, a number, a boolean, or an array of them, as a JS literal.
export function jsFilter(value: unknown): string {
  if (value === undefined || (typeof value === 'object' && value !== null && !Array.isArray(value))) {
    throw new Error(`The js filter cannot write this value: ${String(value)}`);
  }
  return JSON.stringify(value);
}

// A string as a TOML basic string. JSON escapes the same characters as TOML,
// except DEL, which TOML does not allow in a basic string.
export function tomlFilter(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error(`The toml filter needs a string: ${String(value)}`);
  }
  return JSON.stringify(value).replace(/\x7f/g, '\\u007F');
}

// A string as a TOML key: bare if TOML allows that, else quoted.
export function tomlKeyFilter(value: unknown): string {
  if (typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value)) {
    return value;
  }
  return tomlFilter(value);
}

// A string as one line of text, for files such as .gitignore that have no
// escaping.
export function lineFilter(value: unknown): string {
  if (typeof value !== 'string' || /[\r\n]/.test(value)) {
    throw new Error(`The line filter needs a string with no line break: ${String(value)}`);
  }
  return value;
}

export const RENDER_FILTERS = [ 'js', 'toml', 'tomlKey', 'line' ];

let env: nunjucks.Environment | undefined;

// Renders resources/app/<name>.njk.
export function renderAppResource(name: string, context: object): string {
  if (env == null) {
    env = new nunjucks.Environment(
      new nunjucks.FileSystemLoader(path.resolve(resourcesDir, 'app')),
      { autoescape: false, throwOnUndefined: true, trimBlocks: true, lstripBlocks: true },
    );
    env.addFilter('js', jsFilter);
    env.addFilter('toml', tomlFilter);
    env.addFilter('tomlKey', tomlKeyFilter);
    env.addFilter('line', lineFilter);
  }
  return env.render(`${name}.njk`, context);
}
