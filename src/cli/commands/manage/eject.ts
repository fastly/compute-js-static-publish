/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import child_process from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { type OptionDefinition } from 'command-line-args';

import { generateApp } from '../scaffold/generate-app.js';
import { MANAGED_TEMPLATE, managedAppConfig, writeManagedAppFiles } from '../../managed/app.js';
import { loadManagedProject } from '../../managed/command-helpers.js';
import { findNonDataPaths, isScaffoldedPublishContent, renderPublishContentConfig } from '../../managed/eject.js';
import { THIS_PACKAGE, readTemplateLockfile } from '../../managed/lockfile.js';
import { parseCommandLine } from '../../util/args.js';
import { EXIT_FAILED, recordError, reportError } from '../../util/cli-output.js';
import { detectProjectMode } from '../../util/config.js';
import { rootRelative } from '../../util/files.js';
import { getOwnVersion } from '../../util/package.js';
import { MANAGED_APP_DIR, PROJECT_FILE_NAME, RC_FILE_NAME } from '../../../models/config/static-publish-project.js';

// Only for the tests of this package, which never run a published version: the
// spec of this package in the ejected app, in place of the published version.
const PACKAGE_SPEC_ENV = 'CJSP_TEST_EJECT_PACKAGE_SPEC';

function help() {
  console.log(`\

Usage:
  npx @fastly/compute-js-static-publish eject [options]

Description:
  Converts a managed project into an ejected app, which you own and change:
  - Writes the app that deploy would deploy into ./compute-js (or --dir).
  - Splits ${PROJECT_FILE_NAME} into ${RC_FILE_NAME} and
    publish-content.config.js in that directory, with the paths written again
    so that they point at the same directories. Then deletes ${PROJECT_FILE_NAME}.
  - Pins this package to the version that runs: "^<version>" in package.json,
    exactly <version> in package-lock.json (one 'npm install', which needs the
    npm registry). The version must be published on npm.

  Eject can copy publishContent only if it is data. If it has functions or
  regular expressions (for example assetInclusionTest), eject stops.

Options:
  --dir=<dir>                      The directory of the ejected app. Default: ./compute-js
  --force                          Write into the directory also if it exists.
  --fastly-service-id=<id>         Written as service_id into fastly.toml. Default:
                                   FASTLY_SERVICE_ID, then managed.serviceId.

Global Options:
  -h, --help                       Show this help message and exit.
`);
}

function isPublished(version: string): boolean {
  const result = child_process.spawnSync('npm', [ 'view', `${THIS_PACKAGE}@${version}`, 'version' ], { encoding: 'utf-8' });
  return result.status === 0 && result.stdout.trim() === version;
}

export async function action(actionArgs: string[]) {

  const optionDefinitions: OptionDefinition[] = [
    { name: 'dir', type: String },
    { name: 'force', type: Boolean },
    { name: 'fastly-service-id', type: String },
  ];
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
  const {
    dir: dirValue,
    force,
    ['fastly-service-id']: fastlyServiceId,
  } = parsed.commandLineOptions;

  if (detectProjectMode() === 'ejected') {
    reportError('usage', 'This app is already ejected.');
    return;
  }
  const project = await loadManagedProject('eject', '');
  if (project == null) {
    return;
  }

  const projectDir = path.resolve();
  const appDir = path.resolve(dirValue ?? './compute-js');
  if (appDir === projectDir || !appDir.startsWith(projectDir + path.sep) || appDir.startsWith(path.resolve(MANAGED_APP_DIR))) {
    reportError('usage', `--dir must be a directory in the project dir, and not in ${MANAGED_APP_DIR}.`);
    return;
  }
  if (fs.existsSync(appDir) && !force) {
    reportError('usage', `${rootRelative(appDir)} exists. Use --force to write into it.`);
    return;
  }

  const nonData = findNonDataPaths(project.publishContent);
  if (nonData.length > 0) {
    reportError('usage', `Eject cannot copy functions or regular expressions from publishContent: ${nonData.join(', ')}. ` +
      `Remove them from ${PROJECT_FILE_NAME}, eject, and then add them to publish-content.config.js of the ejected app by hand.`);
    return;
  }

  const version = getOwnVersion();
  const testSpec = process.env[PACKAGE_SPEC_ENV];
  if (testSpec == null && !isPublished(version)) {
    reportError('version-not-published', `Eject needs a version of ${THIS_PACKAGE} that is published on npm. ${version} is not.`);
    return;
  }
  const packageSpec = testSpec ?? `^${version}`;

  const serviceId = (typeof fastlyServiceId === 'string' && fastlyServiceId !== '' ? fastlyServiceId : undefined) ??
    (process.env.FASTLY_SERVICE_ID || undefined) ??
    project.managed.serviceId;

  const managedConfig = await managedAppConfig(projectDir, project, appDir);
  const appConfig = {
    ...managedConfig,
    serviceId,
    staticPublishVersionSpec: packageSpec,
    packageLock: undefined,
    generatedFrom: {
      template: MANAGED_TEMPLATE,
      staticPublishVersion: version,
      generatedAt: new Date().toISOString().slice(0, 10),
    },
  };
  const files = generateApp(appConfig);

  // The publish settings: the same file as an ejected scaffold, if the section
  // is what scaffold --managed wrote; else the data of the section.
  if (!isScaffoldedPublishContent(project.publishContent, appConfig, projectDir)) {
    files['publish-content.config.js'] = renderPublishContentConfig(project.publishContent as Record<string, unknown>, projectDir, appDir);
  }

  // The template's lockfile, without this package. npm install adds it.
  const lock = readTemplateLockfile(MANAGED_TEMPLATE);
  if (appConfig.name != null) {
    lock.name = appConfig.name;
    lock.packages[''] = { ...lock.packages[''], name: appConfig.name };
  }
  files['package-lock.json'] = JSON.stringify(lock, undefined, 2) + '\n';

  console.log(`📦 Writing the app into ${rootRelative(appDir)}...`);
  writeManagedAppFiles(appDir, files);

  // Pin this package: "^<version>" stays in package.json, and the lockfile gets exactly <version>.
  const installArgs = testSpec != null ?
    [ 'install', '--no-audit', '--no-fund' ] :
    [ 'install', '--save-dev', `${THIS_PACKAGE}@${version}`, '--no-audit', '--no-fund' ];
  console.log(`npm ${installArgs.join(' ')}`);
  const install = child_process.spawnSync('npm', installArgs, { cwd: appDir, stdio: [ 'ignore', process.stderr, 'inherit' ] });
  if (install.error != null || install.status !== 0) {
    reportError('failed', `npm install failed in ${rootRelative(appDir)}. ${PROJECT_FILE_NAME} was not changed. Fix the problem, and run eject again with --force.`, EXIT_FAILED);
    return;
  }

  fs.rmSync(path.resolve(projectDir, PROJECT_FILE_NAME));

  console.log(`
🎉 Ejected into ${rootRelative(appDir)}. You now own the app and its upgrades (see MIGRATING.md).

- ${PROJECT_FILE_NAME} is deleted. ${rootRelative(appDir)}/${RC_FILE_NAME} and publish-content.config.js have its settings.
  Commit ${rootRelative(appDir)}.
- Run the commands of this CLI in ${rootRelative(appDir)} now.
- You can delete ${MANAGED_APP_DIR}/. The line '/.static-publish/' in .gitignore is not needed any more.
- The working directory stays where it was. Run 'publish-content --local' again before 'npm run dev:start',
  because the local KV Store has paths relative to the app.
`);
}
