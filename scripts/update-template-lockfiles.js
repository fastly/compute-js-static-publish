/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Makes the lockfile of each template in resources/templates/<name>/package-lock.json.
// A managed project installs its generated app with `npm ci` from this
// lockfile, so that the same version of this package always makes the same app.
// The lockfile does not have this package: the CLI adds a `file:` link to its
// own copy when it generates the app (src/cli/managed/lockfile.ts).
//
// Run it in the release process, after `npm run build`:
//   npm run update-template-lockfiles
// It needs network access to the npm registry. It uses --ignore-scripts,
// because --package-lock-only still runs the app's own postinstall script.

import child_process from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { templatePackageJson } from '../build/cli/cli/managed/lockfile.js';
import { appTemplates } from '../build/cli/cli/commands/scaffold/templates/index.js';

const REPO_DIR = path.resolve(import.meta.dirname, '..');

for (const name of Object.keys(appTemplates)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cjsp-lockfile-${name}-`));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(templatePackageJson(name), undefined, 2));
    const result = child_process.spawnSync('npm', [ 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund' ], { cwd: dir, stdio: 'inherit' });
    if (result.status !== 0) {
      throw new Error(`npm install failed for the template '${name}'.`);
    }
    const target = path.join(REPO_DIR, 'resources/templates', name, 'package-lock.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(dir, 'package-lock.json'), target);
    console.log(`Wrote ${path.relative(REPO_DIR, target)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
