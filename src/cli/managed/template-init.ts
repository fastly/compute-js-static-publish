/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// template init: makes or updates the folder of a template, for example
// hono-extensions/ of the hono template. The starter files are in
// resources/template-init/<template>/. The template owns the peer dependencies
// on the packages that it provides; the customer owns everything else.

import fs from 'node:fs';
import path from 'node:path';

import { loadAppTemplate } from '../commands/scaffold/app-template.js';
import { resourcesDir } from '../util/resources.js';
import { pinnedVersion } from './lockfile.js';

const THIS_PACKAGE = '@fastly/compute-js-static-publish';

// The templates that have a folder for template init.
export function templateHasInit(templateName: string): boolean {
  return fs.existsSync(path.resolve(resourcesDir, 'template-init', templateName));
}

// The starter files of a template, keyed by the path relative to its folder.
function starterFiles(templateName: string): Record<string, string> {
  const dir = path.resolve(resourcesDir, 'template-init', templateName);
  const files: Record<string, string> = {};
  const walk = (sub: string) => {
    for (const entry of fs.readdirSync(path.resolve(dir, sub), { withFileTypes: true })) {
      const rel = sub === '' ? entry.name : `${sub}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(rel);
      } else {
        files[rel] = fs.readFileSync(path.resolve(dir, rel), 'utf-8');
      }
    }
  };
  walk('');
  return files;
}

// The packages that the app of a template provides to the code in the
// template's folder, with their versions: the dependencies of the template, and
// this package. A version comes from the app's node_modules if it is installed
// there, else from the template's lockfile.
export function providedVersions(templateName: string, appNodeModulesDir: string | undefined, ownVersion: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of Object.keys(loadAppTemplate(templateName).dependencies).sort()) {
    let version: string | undefined;
    const installed = appNodeModulesDir != null ? path.resolve(appNodeModulesDir, name, 'package.json') : undefined;
    if (installed != null && fs.existsSync(installed)) {
      version = JSON.parse(fs.readFileSync(installed, 'utf-8')).version;
    }
    version ??= pinnedVersion(templateName, name);
    if (version != null) {
      result[name] = version;
    }
  }
  result[THIS_PACKAGE] = ownVersion;
  return result;
}

export type TemplateInitPlan = {
  // The files to write, keyed by the path relative to the folder.
  write: Record<string, string>,
  // Starter files that exist and that the plan replaces (--reset).
  replace: string[],
  // Why the folder is out of date (for --check). Empty if it is up to date.
  outOfDate: string[],
};

// What template init does for a folder. It never changes a module of the
// customer: only package.json (the peer dependencies on the provided packages,
// merged), and the starter files that are missing (or all of them, with reset).
export function planTemplateInit(templateName: string, folderDir: string, provided: Record<string, string>, options: { reset: boolean }): TemplateInitPlan {
  const write: Record<string, string> = {};
  const replace: string[] = [];
  const outOfDate: string[] = [];

  // package.json: the template owns the peer dependencies on the provided packages.
  const packageJsonPath = path.resolve(folderDir, 'package.json');
  const existing = fs.existsSync(packageJsonPath) ? JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) : null;
  const peerDependencies: Record<string, string> = { ...existing?.peerDependencies };
  for (const [ name, version ] of Object.entries(provided)) {
    const range = `^${version}`;
    if (peerDependencies[name] !== range) {
      if (existing != null) {
        outOfDate.push(`package.json: peerDependencies.${name} is ${peerDependencies[name] ?? 'missing'}, but the app provides ${version}.`);
      }
      peerDependencies[name] = range;
    }
  }
  const typescriptRange = loadAppTemplate(templateName).devDependencies.typescript;
  const packageJson = {
    name: `${templateName}-extensions`,
    private: true,
    type: 'module',
    ...existing,
    peerDependencies,
    devDependencies: {
      ...(typescriptRange != null ? { typescript: typescriptRange } : {}),
      ...existing?.devDependencies,
    },
  };
  if (existing == null) {
    outOfDate.push('package.json is missing.');
  }
  const packageJsonText = JSON.stringify(packageJson, undefined, 2) + '\n';
  if (existing == null || fs.readFileSync(packageJsonPath, 'utf-8') !== packageJsonText) {
    write['package.json'] = packageJsonText;
  }

  // The starter files: written if missing, or all of them with reset.
  for (const [ file, content ] of Object.entries(starterFiles(templateName))) {
    const filePath = path.resolve(folderDir, file);
    if (!fs.existsSync(filePath)) {
      write[file] = content;
      // The examples are optional. tsconfig.json is needed by the editor.
      if (file === 'tsconfig.json') {
        outOfDate.push('tsconfig.json is missing.');
      }
    } else if (options.reset && fs.readFileSync(filePath, 'utf-8') !== content) {
      write[file] = content;
      replace.push(file);
    }
  }

  return { write, replace, outOfDate };
}

// Writes the files of a plan into the folder.
export function applyTemplateInit(folderDir: string, plan: TemplateInitPlan) {
  for (const [ file, content ] of Object.entries(plan.write)) {
    const filePath = path.resolve(folderDir, file);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  }
}
