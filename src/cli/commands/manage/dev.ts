/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import path from 'node:path';

import { type OptionDefinition } from 'command-line-args';

import { prepareManagedApp } from '../../managed/app.js';
import { parseCommandLine } from '../../util/args.js';
import { fail, recordFailure } from '../../util/output.js';
import { checkVersionForCommand, loadManagedProject, showTemplateFolderHint } from '../../managed/command-helpers.js';
import { PROJECT_FILE_NAME } from '../../../models/config/static-publish-project.js';
import { serveApp } from '../run-dev-watch.js';

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

  Only in a managed project. In an ejected app, run 'npm run dev:start', or
  'npm run dev:watch' (fastly compute serve --watch).

Options:
  --auto-upgrade                   If the CLI is newer than managed.staticPublishVersion,
                                   set it to the version that runs, and continue.
  -- <options>                     Options after -- go to 'fastly compute serve',
                                   for example: dev -- --addr=127.0.0.1:8080
                                   With -- --watch, a change in the app builds and
                                   restarts it. If the template has a watch script,
                                   it runs next to 'fastly compute serve'.

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
      recordFailure('usage', String(parsed.error));
    }
    help();
    return;
  }

  const project = await loadManagedProject('dev', `In an ejected app, run 'npm run dev:start'.`);
  if (project == null) {
    return;
  }
  showTemplateFolderHint(project);
  if (!checkVersionForCommand(project, parsed.commandLineOptions['auto-upgrade'] === true)) {
    return;
  }

  const { appDir } = await prepareManagedApp(path.resolve(), project);

  const result = await serveApp(appDir, serveArgs);
  if (result.error != null) {
    fail('failed', `Could not run 'fastly compute serve': ${String(result.error)}`);
    return;
  }
  if (result.status !== 0 && result.signal == null) {
    fail('failed', `'fastly compute serve' exited with ${result.status}.`);
  }
}
