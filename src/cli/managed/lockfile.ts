/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import fs from 'node:fs';
import path from 'node:path';

import { generateApp } from '../commands/scaffold/generate-app.js';
import { appTemplates } from '../commands/scaffold/templates/index.js';
import { getOwnPackageDir } from '../util/package.js';

// The lockfile of a template pins the dependencies of the generated app (the
// compiler toolchain and the packages below it). scripts/update-template-lockfiles.js
// makes it at release time, without this package. The generated app gets this
// package as a `file:` link to the copy that runs the CLI, because it must be
// exactly that version, and a lockfile made before the release cannot list it.

export const THIS_PACKAGE = '@fastly/compute-js-static-publish';

export type PackageLock = {
  name?: string,
  version?: string,
  lockfileVersion: number,
  requires?: boolean,
  packages: Record<string, Record<string, unknown>>,
};

type PackageJsonFields = {
  version?: string,
  license?: string,
  dependencies?: Record<string, string>,
  devDependencies?: Record<string, string>,
  peerDependencies?: Record<string, string>,
  bin?: Record<string, string> | string,
  engines?: Record<string, string>,
};

// The package.json of a template's app, without this package. The lockfile of
// the template is made from it. Its dependencies do not depend on the settings.
export function templatePackageJson(templateName: string): Record<string, unknown> {
  const template = appTemplates[templateName];
  if (template == null) {
    throw new Error(`Unknown template: ${templateName}`);
  }
  const files = generateApp({
    appDir: '/app',
    name: `template-${templateName}`,
    author: undefined,
    description: undefined,
    serviceId: undefined,
    storage: { mode: 'kv-store', kvStoreName: 'content' },
    publishId: 'default',
    defaultCollectionName: 'live',
    staticPublisherWorkingDir: '/app/static-publisher',
    rootDir: '/public',
    publicDir: '/public',
    staticDirs: [],
    spaFilename: undefined,
    notFoundPageFilename: undefined,
    autoIndex: [],
    autoExt: [],
    staticPublishVersionSpec: '*',
    template,
    generatedFrom: undefined,
  });
  const packageJson = JSON.parse(files['package.json']);
  delete packageJson.devDependencies[THIS_PACKAGE];
  delete packageJson.description;
  delete packageJson.author;
  return packageJson;
}

export function templateLockfilePath(templateName: string): string {
  return path.resolve(getOwnPackageDir(), 'resources/templates', templateName, 'package-lock.json');
}

export function readTemplateLockfile(templateName: string): PackageLock {
  return JSON.parse(fs.readFileSync(templateLockfilePath(templateName), 'utf-8')) as PackageLock;
}

// The version that a template's lockfile pins for a package, for example
// '@fastly/js-compute'. 8.2 code uses only this helper, so that the way that
// templates pin versions can change in one place.
export function pinnedVersion(templateName: string, packageName: string): string | undefined {
  const entry = readTemplateLockfile(templateName).packages[`node_modules/${packageName}`];
  return typeof entry?.version === 'string' ? entry.version : undefined;
}

export type ManagedLockfileOptions = {
  appName: string | undefined,
  appDir: string,
  // The package dir of the copy of this package that runs the CLI, and its package.json.
  cliPackageDir: string,
  cliPackageJson: PackageJsonFields,
};

// The spec of this package in the package.json of a managed app.
export function managedPackageSpec(cliPackageDir: string): string {
  return `file:${cliPackageDir}`;
}

// The lockfile of a managed app: the template's lockfile, with the `file:` link
// to this package added. `npm ci` accepts it, and does not change it.
export function buildManagedLockfile(templateLock: PackageLock, options: ManagedLockfileOptions): PackageLock {
  const lock: PackageLock = JSON.parse(JSON.stringify(templateLock));
  const linkPath = path.relative(options.appDir, options.cliPackageDir).split(path.sep).join('/');
  const spec = managedPackageSpec(options.cliPackageDir);

  if (options.appName != null) {
    lock.name = options.appName;
  }
  const root = lock.packages[''] ?? {};
  if (options.appName != null) {
    root.name = options.appName;
  }
  root.devDependencies = { ...(root.devDependencies as Record<string, string> | undefined), [THIS_PACKAGE]: spec };
  lock.packages[''] = root;

  lock.packages[`node_modules/${THIS_PACKAGE}`] = {
    resolved: linkPath,
    link: true,
  };

  const pkg = options.cliPackageJson;
  const target: Record<string, unknown> = {};
  for (const field of [ 'version', 'license', 'dependencies', 'bin', 'devDependencies', 'engines', 'peerDependencies' ] as const) {
    if (pkg[field] != null) {
      target[field] = pkg[field];
    }
  }
  target.dev = true;
  lock.packages[linkPath] = target;

  return lock;
}
