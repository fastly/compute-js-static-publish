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

// A value as a JS literal: a string, a number, a boolean, null, an array, or a
// plain object of these. A string is written with JSON.stringify(), so an
// array of strings is the same as in JSON. An object is written with one key
// on each line, and indent is the indentation of the line that has the value.
// A key is not quoted if it is a valid identifier.
export function jsFilter(value: unknown, indent: string = ''): string {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new Error(`The js filter cannot write this value: ${String(value)}`);
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  const inner = indent + '  ';
  if (Array.isArray(value)) {
    if (value.every(item => item === null || typeof item !== 'object')) {
      return JSON.stringify(value);
    }
    return `[\n${value.map(item => `${inner}${jsFilter(item, inner)},\n`).join('')}${indent}]`;
  }
  const entries = Object.entries(value).filter(([ , item ]) => item !== undefined);
  if (entries.length === 0) {
    return '{}';
  }
  const key = (name: string) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
  return `{\n${entries.map(([ name, item ]) => `${inner}${key(name)}: ${jsFilter(item, inner)},\n`).join('')}${indent}}`;
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
