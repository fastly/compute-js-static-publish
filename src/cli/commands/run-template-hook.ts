/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { TEMPLATE_HOOKS } from './scaffold/generate-app.js';

// Runs scripts/template_<name>.js of the app in the current directory, if it
// exists. The npm scripts prebuild, postbuild, and postinstall of every
// generated app call this, so a template (or the user, in an ejected app) can
// add a hook by adding the file. Returns the exit code.
export function runTemplateHook(name: string | undefined): number {
  if (name == null || !(TEMPLATE_HOOKS as readonly string[]).includes(name)) {
    console.error(`❌ run-template-hook: the hook must be one of: ${TEMPLATE_HOOKS.join(', ')}.`);
    return 1;
  }

  const hookFile = path.resolve(`scripts/template_${name}.js`);
  if (!fs.existsSync(hookFile)) {
    return 0;
  }

  const result = child_process.spawnSync(process.execPath, [ hookFile ], { stdio: 'inherit' });
  if (result.error != null) {
    console.error(`❌ run-template-hook: could not run ${hookFile}: ${String(result.error)}`);
    return 1;
  }
  return result.status ?? 1;
}
