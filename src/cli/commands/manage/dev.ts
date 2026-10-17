/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import child_process from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { type OptionDefinition } from 'command-line-args';

import { prepareManagedApp } from '../../managed/app.js';
import { parseCommandLine } from '../../util/args.js';
import { EXIT_FAILED, recordError, reportError } from '../../util/cli-output.js';
import { checkVersionForCommand, loadManagedProject } from '../../managed/command-helpers.js';
import { PROJECT_FILE_NAME } from '../../../models/config/static-publish-project.js';

function help() {
  console.log(`\

Usage:
  npx @fastly/compute-js-static-publish dev [-- <options of fastly compute serve>]

Description:
  Runs the app of a managed project on your computer. Generates the app in
  .static-publish/app from ${PROJECT_FILE_NAME}, installs its dependencies
  if they changed, and runs 'fastly compute serve' in it.

  The app serves the content of the local KV Store. To publish content to it,
  run 'publish-content --local' first.

  Only in a managed project. In an ejected app, run 'npm run dev:start'.

Options:
  --auto-upgrade                   If the CLI is newer than managed.staticPublishVersion,
                                   set it to the version that runs, and continue.
  -- <options>                     Options after -- go to 'fastly compute serve',
                                   for example: dev -- --addr=127.0.0.1:8080

Global Options:
  -h, --help                       Show this help message and exit.
`);
}

export async function action(actionArgs: string[]) {

  // Options after -- go to fastly compute serve.
  const separator = actionArgs.indexOf('--');
  const serveArgs = separator === -1 ? [] : actionArgs.slice(separator + 1);
  const ownArgs = separator === -1 ? actionArgs : actionArgs.slice(0, separator);

  const optionDefinitions: OptionDefinition[] = [
    { name: 'auto-upgrade', type: Boolean },
  ];
  const parsed = parseCommandLine(ownArgs, optionDefinitions);
  if (parsed.needHelp) {
    if (parsed.error != null) {
      console.error(String(parsed.error));
      console.error();
      recordError('usage', String(parsed.error));
    }
    help();
    return;
  }

  const project = await loadManagedProject('dev', `In an ejected app, run 'npm run dev:start'.`);
  if (project == null) {
    return;
  }
  if (!checkVersionForCommand(project, parsed.commandLineOptions['auto-upgrade'] === true)) {
    return;
  }

  const { appDir } = await prepareManagedApp(path.resolve(), project);

  // The Fastly CLI of the app, if it has one.
  const appFastly = path.resolve(appDir, 'node_modules/.bin/fastly');
  const fastly = fs.existsSync(appFastly) ? appFastly : 'fastly';
  console.log(`▶️ fastly compute serve ${serveArgs.join(' ')}`);
  const result = child_process.spawnSync(fastly, [ 'compute', 'serve', ...serveArgs ], { cwd: appDir, stdio: 'inherit' });
  if (result.error != null) {
    reportError('failed', `Could not run 'fastly compute serve': ${String(result.error)}`, EXIT_FAILED);
    return;
  }
  if (result.status !== 0 && result.signal == null) {
    recordError('failed', `'fastly compute serve' exited with ${result.status}.`, EXIT_FAILED);
  }
}
