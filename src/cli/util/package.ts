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
