/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import fs from 'node:fs';
import path from 'node:path';

export type PackageJson = {
  author?: string,
  name?: string,
  description?: string,
  dependencies?: Record<string, string>,
  devDependencies?: Record<string, string>,
};

// The package dir of the copy of this package that runs.
export function getOwnPackageDir(): string {
  return path.resolve(import.meta.dirname, '../../../..');
}

// The package.json of the copy of this package that runs.
export function readOwnPackageJson(): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.resolve(getOwnPackageDir(), 'package.json'), 'utf-8'));
}

// The version of this package, from the package.json of the copy that runs.
export function getOwnVersion(): string {
  return readOwnPackageJson().version;
}

// True if this copy of the package is the one that a plain `npx
// @fastly/compute-js-static-publish` runs in the directory: the nearest
// node_modules/@fastly/compute-js-static-publish, from the directory upwards.
export function isLocalCopy(dir: string = process.cwd()): boolean {
  let ownDir: string;
  try {
    ownDir = fs.realpathSync(getOwnPackageDir());
  } catch {
    return false;
  }
  for (let current = path.resolve(dir); ; current = path.dirname(current)) {
    const candidate = path.join(current, 'node_modules', '@fastly', 'compute-js-static-publish');
    if (fs.existsSync(candidate)) {
      try {
        return fs.realpathSync(candidate) === ownDir;
      } catch {
        return false;
      }
    }
    if (path.dirname(current) === current) {
      return false;
    }
  }
}

// The npx command of this package, for the messages of the CLI.
// - If a plain npx runs this copy (it is installed in the project or the app),
//   the command has no dist-tag. A dist-tag makes npx get the version of that
//   tag from npm, which can be a different version from the installed one.
// - Else, the version of a prerelease (for example 8.1.0-beta.1) gives the
//   dist-tag of the prerelease (@beta), because npx without a dist-tag runs
//   the latest stable version, which does not have the features of the
//   prerelease. A stable version gives no dist-tag, or @latest with
//   { latest: true } (the command that makes a new app).
export function cliCommand(
  options: { latest?: boolean } = {},
  version: string = getOwnVersion(),
  localCopy: boolean = isLocalCopy(),
): string {
  const command = 'npx @fastly/compute-js-static-publish';
  if (localCopy) {
    return command;
  }
  const prerelease = /^\d+\.\d+\.\d+-([a-z][a-z0-9-]*)/.exec(version)?.[1];
  if (prerelease != null) {
    return `${command}@${prerelease}`;
  }
  if (options.latest) {
    return `${command}@latest`;
  }
  return command;
}

export function findComputeJsStaticPublisherVersion(packageJson: PackageJson | null) {

  // Get the current compute js static publisher version.
  let computeJsStaticPublisherVersion: string | null = null;
  if (packageJson != null) {
    // First try current project's package.json
    computeJsStaticPublisherVersion =
      packageJson.dependencies?.["@fastly/compute-js-static-publish"] ??
      packageJson.devDependencies?.["@fastly/compute-js-static-publish"] ??
      null;

    // This may be a file url if during development
    if (computeJsStaticPublisherVersion != null) {

      if (computeJsStaticPublisherVersion.startsWith('file:')) {
        // this is a relative path from the current directory.
        // we replace it with an absolute path
        const relPath = computeJsStaticPublisherVersion.slice('file:'.length);
        const absPath = path.resolve(relPath);
        computeJsStaticPublisherVersion = 'file:' + absPath;
      }

    }
  }

  if (computeJsStaticPublisherVersion == null) {
    // Also try package.json of the package that contains the currently running program
    // This is used when the program doesn't actually install the package (running via npx).
    const computeJsStaticPublishPackageJsonPath = path.resolve(import.meta.dirname, '../../../../package.json');
    const computeJsStaticPublishPackageJsonText = fs.readFileSync(computeJsStaticPublishPackageJsonPath, 'utf-8');
    const computeJsStaticPublishPackageJson = JSON.parse(computeJsStaticPublishPackageJsonText);
    computeJsStaticPublisherVersion = computeJsStaticPublishPackageJson?.version;
  }

  if (computeJsStaticPublisherVersion == null) {
    // Unexpected, but if it's still null then we go to a literal
    computeJsStaticPublisherVersion = '7.0.0';
  }

  if (!computeJsStaticPublisherVersion.startsWith('^') &&
    !computeJsStaticPublisherVersion.startsWith('file:')
  ) {
    computeJsStaticPublisherVersion = '^' + computeJsStaticPublisherVersion;
  }

  return computeJsStaticPublisherVersion;
}
