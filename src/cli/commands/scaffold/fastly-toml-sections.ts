/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// managed.fastlyToml of a managed project: the local_server and setup sections
// that the customer adds to the fastly.toml of the app, for example a local
// Secret Store for fastly compute serve.

import toml from 'toml';

import { type FastlyTomlSections } from '../../../models/config/static-publish-project.js';
import { tomlFilter, tomlKeyFilter } from './render.js';

export const FASTLY_TOML_SECTIONS = [ 'local_server', 'setup' ] as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const isTableArray = (value: unknown): value is Record<string, unknown>[] =>
  Array.isArray(value) && value.length > 0 && value.every(isPlainObject);

// Checks managed.fastlyToml. Each section is an object of resource types (for
// example secret_stores), and each value can be written as TOML: a string, a
// finite number, a boolean, an array, or a plain object.
export function checkFastlyTomlSections(value: unknown, errors: string[]): value is FastlyTomlSections {
  const start = errors.length;
  if (!isPlainObject(value)) {
    errors.push('managed.fastlyToml, if specified, must be an object.');
    return false;
  }
  const checkValue = (item: unknown, at: string) => {
    if (typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) {
      return;
    }
    if (Array.isArray(item)) {
      if (item.length > 0 && item.some(isPlainObject) && !item.every(isPlainObject)) {
        errors.push(`${at}: an array must have only objects, or no objects.`);
        return;
      }
      item.forEach((x, i) => checkValue(x, `${at}[${i}]`));
      return;
    }
    if (isPlainObject(item)) {
      for (const [ key, x ] of Object.entries(item)) {
        if (x !== undefined) {
          checkValue(x, `${at}.${key}`);
        }
      }
      return;
    }
    errors.push(`${at}: the value cannot be written to fastly.toml. Use a string, a number, a boolean, an array, or an object.`);
  };
  for (const [ section, content ] of Object.entries(value)) {
    const at = `managed.fastlyToml.${section}`;
    if (!(FASTLY_TOML_SECTIONS as readonly string[]).includes(section)) {
      errors.push(`${at}: only ${FASTLY_TOML_SECTIONS.join(' and ')} can be added to fastly.toml.`);
      continue;
    }
    if (content === undefined) {
      continue;
    }
    if (!isPlainObject(content)) {
      errors.push(`${at} must be an object, for example { secret_stores: { … } }.`);
      continue;
    }
    for (const [ type, tables ] of Object.entries(content)) {
      if (tables !== undefined && !isPlainObject(tables)) {
        errors.push(`${at}.${type} must be an object.`);
        continue;
      }
      checkValue(tables, `${at}.${type}`);
    }
  }
  return errors.length === start;
}

function tomlValue(value: unknown): string {
  if (typeof value === 'string') {
    return tomlFilter(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[ ${value.map(tomlValue).join(', ')} ]`;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value).filter(([ , x ]) => x !== undefined);
    return `{ ${entries.map(([ key, x ]) => `${tomlKeyFilter(key)} = ${tomlValue(x)}`).join(', ')} }`;
  }
  throw new Error(`This value cannot be written to fastly.toml: ${String(value)}`);
}

// Writes the tables of an object with the full path in each header, so that the
// text can come after the sections that the CLI writes. A table gets a header
// only if it has values, or if it is a resource (for example
// [setup.kv_stores.name]) and has nothing else; the tables above it are made
// implicitly, and are never declared a second time.
function writeTables(lines: string[], keys: string[], table: Record<string, unknown>, header: '[' | '[[') {
  const entries = Object.entries(table).filter(([ , x ]) => x !== undefined);
  const values = entries.filter(([ , x ]) => !isPlainObject(x) && !isTableArray(x));
  const tables = entries.filter(([ , x ]) => isPlainObject(x)) as [ string, Record<string, unknown> ][];
  const tableArrays = entries.filter(([ , x ]) => isTableArray(x)) as [ string, Record<string, unknown>[] ][];
  const name = keys.map(tomlKeyFilter).join('.');
  const isResource = keys.length >= 3;
  if (header === '[[' || values.length > 0 || (isResource && tables.length === 0 && tableArrays.length === 0)) {
    lines.push(header === '[[' ? `[[${name}]]` : `[${name}]`);
    for (const [ key, x ] of values) {
      lines.push(`${tomlKeyFilter(key)} = ${tomlValue(x)}`);
    }
  }
  for (const [ key, x ] of tables) {
    writeTables(lines, [ ...keys, key ], x, '[');
  }
  for (const [ key, items ] of tableArrays) {
    for (const item of items) {
      writeTables(lines, [ ...keys, key ], item, '[[');
    }
  }
}

// Adds managed.fastlyToml to the text of a fastly.toml that the CLI made.
// Throws if a resource has the name of one that the CLI writes (for example
// the KV Store of the content), or if the result is not valid TOML.
export function addFastlyTomlSections(fastlyToml: string, sections: FastlyTomlSections | undefined): string {
  if (sections == null) {
    return fastlyToml;
  }
  const base = toml.parse(fastlyToml);
  const lines: string[] = [];
  for (const section of FASTLY_TOML_SECTIONS) {
    const content = sections[section];
    if (content == null) {
      continue;
    }
    for (const [ type, tables ] of Object.entries(content)) {
      if (!isPlainObject(tables)) {
        continue;
      }
      const baseType = base[section]?.[type];
      for (const name of Object.keys(tables)) {
        if (baseType?.[name] !== undefined) {
          throw new Error(`managed.fastlyToml.${section}.${type}.${name}: the CLI writes this entry. Use another name.`);
        }
      }
      const hasValues = Object.values(tables).some(x => x !== undefined && !isPlainObject(x) && !isTableArray(x));
      if (baseType != null && hasValues) {
        throw new Error(`managed.fastlyToml.${section}.${type}: the CLI writes this table. Add only new entries to it.`);
      }
      writeTables(lines, [ section, type ], tables, '[');
    }
  }
  if (lines.length === 0) {
    return fastlyToml;
  }
  const result = `${fastlyToml.trimEnd()}\n\n# From managed.fastlyToml in the project file.\n${lines.join('\n')}\n`;
  try {
    toml.parse(result);
  } catch (err) {
    throw new Error(`managed.fastlyToml does not give a valid fastly.toml: ${String(err instanceof Error ? err.message : err)}`);
  }
  return result;
}
