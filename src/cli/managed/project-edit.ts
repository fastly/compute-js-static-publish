/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { SERVICE_ID_PLACEHOLDER_LINE } from './project-file.js';

// The CLI writes values back into static-publish.project.js only by replacing
// one known line. It never changes other JavaScript. Each function returns the
// new text, or null if the line is not there (exactly one time).

function countMatches(text: string, re: RegExp) {
  return [ ...text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) ].length;
}

// Replace the marked line `    serviceId: undefined,` that scaffold --managed wrote.
export function writeBackServiceId(text: string, serviceId: string): string | null {
  const lines = text.split('\n');
  const indexes = lines.flatMap((line, i) => line === SERVICE_ID_PLACEHOLDER_LINE ? [ i ] : []);
  if (indexes.length !== 1) {
    return null;
  }
  lines[indexes[0]] = `    serviceId: ${JSON.stringify(serviceId)},`;
  return lines.join('\n');
}

const VERSION_LINE = /^([ \t]*)staticPublishVersion:[ \t]*(["'])[^"'\n]*\2,[ \t]*$/m;
const ANY_VERSION_LINE = /^[ \t]*staticPublishVersion[ \t]*:/m;
const MANAGED_LINE = /^([ \t]*)managed:[ \t]*\{[ \t]*$/m;

// Set managed.staticPublishVersion. If the line is missing, add it as the first
// line of the managed section.
export function writeBackStaticPublishVersion(text: string, version: string): string | null {
  if (countMatches(text, VERSION_LINE) === 1) {
    return text.replace(VERSION_LINE, (_line, indent) => `${indent}staticPublishVersion: ${JSON.stringify(version)},`);
  }
  if (countMatches(text, ANY_VERSION_LINE) === 0 && countMatches(text, MANAGED_LINE) === 1) {
    return text.replace(MANAGED_LINE, (line, indent) => `${line}\n${indent}  staticPublishVersion: ${JSON.stringify(version)},`);
  }
  return null;
}
