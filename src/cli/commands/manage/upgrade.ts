/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { type OptionDefinition } from 'command-line-args';

import { loadManagedProject, writeProjectVersion } from '../../managed/command-helpers.js';
import { checkProjectVersion } from '../../managed/version-check.js';
import { parseCommandLine } from '../../util/args.js';
import { recordError, reportError } from '../../util/cli-output.js';
import { getOwnVersion } from '../../util/package.js';
import { PROJECT_FILE_NAME } from '../../../models/config/static-publish-project.js';

function help() {
  console.log(`\

Usage:
  npx @fastly/compute-js-static-publish upgrade

Description:
  Moves a managed project to the version of @fastly/compute-js-static-publish
  that runs: sets managed.staticPublishVersion in ${PROJECT_FILE_NAME}.
  dev and deploy stop when this version is not the version that runs.
  The next deploy then deploys the app of the new version.

  Commit the change of ${PROJECT_FILE_NAME}.

Global Options:
  -h, --help                       Show this help message and exit.
`);
}

export async function action(actionArgs: string[]) {

  const optionDefinitions: OptionDefinition[] = [];
  const parsed = parseCommandLine(actionArgs, optionDefinitions);
  if (parsed.needHelp) {
    if (parsed.error != null) {
      console.error(String(parsed.error));
      console.error();
      recordError('usage', String(parsed.error));
    }
    help();
    return;
  }

  const project = await loadManagedProject('upgrade', 'An ejected app has no recorded version.');
  if (project == null) {
    return;
  }

  const running = getOwnVersion();
  const check = checkProjectVersion(project.managed.staticPublishVersion, running);
  if (check.result === 'same') {
    console.log(`✅ The project already uses ${running}.`);
    return;
  }
  if (check.result === 'older-cli') {
    reportError('version-mismatch', `The project uses ${check.recorded}, which is newer than the version that runs (${running}). 'upgrade' does not move a project to an older version.`);
    return;
  }
  if (!writeProjectVersion(running)) {
    return;
  }
  console.log(`✅ The project now uses ${running}${check.recorded != null ? ` (was ${check.recorded})` : ''}. Commit ${PROJECT_FILE_NAME}.`);
}
