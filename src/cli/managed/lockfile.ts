/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import fs from 'node:fs';
import path from 'node:path';

import { getOwnPackageDir } from '../util/package.js';

// The lockfile of a template (resources/templates/<name>/package-lock.json)
// pins the dependencies of the generated app: the compiler toolchain and the
// packages below it. It does not list this package. The generated app gets this
// package as a `file:` link to the copy that runs the CLI, because it must be
// exactly that version, and a lockfile in this package cannot list it.

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

export function templateLockfilePath(templateName: string): string {
  return path.resolve(getOwnPackageDir(), 'resources/templates', templateName, 'package-lock.json');
}

export function readTemplateLockfile(templateName: string): PackageLock {
  return JSON.parse(fs.readFileSync(templateLockfilePath(templateName), 'utf-8')) as PackageLock;
}

// The version that a template's lockfile pins for a package, for example
// '@fastly/js-compute'. Code that needs this version uses only this helper, so
// that the way that templates pin versions can change in one place.
export function pinnedVersion(templateName: string, packageName: string): string | undefined {
  const entry = readTemplateLockfile(templateName).packages[`node_modules/${packageName}`];
  return typeof entry?.version === 'string' ? entry.version : undefined;
}

export type ManagedLockfileOptions = {
  appName: string | undefined,
  // The version in the package.json of the app.
  appVersion: string,
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
  lock.version = options.appVersion;
  const root = lock.packages[''] ?? {};
  if (options.appName != null) {
    root.name = options.appName;
  }
  root.version = options.appVersion;
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
