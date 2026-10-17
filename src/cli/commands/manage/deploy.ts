/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import child_process from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { type OptionDefinition } from 'command-line-args';

import { managedAppState, prepareManagedApp } from '../../managed/app.js';
import { checkVersionForCommand, loadManagedProject } from '../../managed/command-helpers.js';
import { getActiveVersion, getVersionDomains } from '../../managed/fastly-service.js';
import { formatVersionComment, parseVersionComment } from '../../managed/fingerprint.js';
import { writeBackServiceId } from '../../managed/project-edit.js';
import { loadApiToken } from '../../util/api-token.js';
import { parseCommandLine } from '../../util/args.js';
import { EXIT_FAILED, isJsonMode, isNonInteractive, recordError, reportError, setJsonResult } from '../../util/cli-output.js';
import { detectProjectMode } from '../../util/config.js';
import { readServiceId } from '../../util/fastly-toml.js';
import { getOwnPackageDir, getOwnVersion } from '../../util/package.js';
import { loadServiceId } from '../../util/service-id.js';
import { isS3StorageConfigRc } from '../../../models/config/static-publish-rc.js';
import { PROJECT_FILE_NAME } from '../../../models/config/static-publish-project.js';

function help() {
  console.log(`\

Usage:
  npx @fastly/compute-js-static-publish deploy [options]

Description:
  Deploys the app of a managed project, only if it changed: generates the app,
  installs its dependencies if necessary, and runs 'fastly compute build' and
  'fastly compute deploy'. The comment of the new service version has the
  fingerprint of the app, so that 'status' and the next deploy can compare it.

  After the first deploy, the Service ID is written into managed.serviceId in
  ${PROJECT_FILE_NAME}.

  In an ejected app, this runs 'fastly compute publish'.

Options:
  --force                          Deploy also when the fingerprint did not change.
  --auto-upgrade                   If the CLI is newer than managed.staticPublishVersion,
                                   set it to the version that runs, and continue.
  --comment=<text>                 Added to the comment of the service version,
                                   for example a commit SHA.
  --fastly-service-id=<id>         The service. Default: FASTLY_SERVICE_ID, then
                                   managed.serviceId. Without one, the Fastly CLI
                                   makes a new service.
  --fastly-api-token=<token>       Default: FASTLY_API_TOKEN.
  --json                           Write the result as JSON to stdout.

Global Options:
  -h, --help                       Show this help message and exit.
`);
}

function runFastly(appDir: string, args: string[], apiToken: string) {
  const appFastly = path.resolve(appDir, 'node_modules/.bin/fastly');
  const fastly = fs.existsSync(appFastly) ? appFastly : 'fastly';
  console.log(`▶️ fastly ${args.join(' ')}`);
  return child_process.spawnSync(fastly, args, {
    cwd: appDir,
    env: { ...process.env, FASTLY_API_TOKEN: apiToken },
    // With --json, stdout is for the JSON object only.
    stdio: [ isNonInteractive() ? 'ignore' : 'inherit', isJsonMode() ? process.stderr : 'inherit', 'inherit' ],
  });
}

export async function action(actionArgs: string[]) {

  const optionDefinitions: OptionDefinition[] = [
    { name: 'force', type: Boolean },
    { name: 'auto-upgrade', type: Boolean },
    { name: 'comment', type: String },
    { name: 'fastly-service-id', type: String },
    { name: 'fastly-api-token', type: String },
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
    force,
    ['auto-upgrade']: autoUpgrade,
    comment,
    ['fastly-service-id']: fastlyServiceId,
    ['fastly-api-token']: fastlyApiToken,
  } = parsed.commandLineOptions;

  if (detectProjectMode() === 'ejected') {
    if (isJsonMode()) {
      reportError('json-not-supported', `--json is not supported for 'deploy' in an ejected app.`);
      return;
    }
    const result = child_process.spawnSync('fastly', [ 'compute', 'publish' ], { stdio: 'inherit' });
    if (result.error != null || result.status !== 0) {
      reportError('deploy-failed', `'fastly compute publish' failed.`, EXIT_FAILED);
    }
    return;
  }

  const project = await loadManagedProject('deploy', '');
  if (project == null) {
    return;
  }
  if (!checkVersionForCommand(project, autoUpgrade === true)) {
    return;
  }

  const apiToken = loadApiToken({ commandLine: fastlyApiToken });
  if (apiToken == null) {
    reportError('credentials-missing', 'Fastly API Token not provided. Set the FASTLY_API_TOKEN environment variable to an API token that can deploy the service.');
    return;
  }
  const context = { apiToken: apiToken.apiToken };

  const serviceIdResult = loadServiceId({
    commandLine: fastlyServiceId,
    fastlyTomlPath: path.resolve('.static-publish/app/fastly.toml'),
    projectServiceId: project.managed.serviceId,
  });
  let serviceId = serviceIdResult?.serviceId ?? null;
  if (serviceId != null) {
    console.log(`✔️ Service ID from ${serviceIdResult!.source}: ${serviceId}`);
  }

  // The Fastly CLI cannot make the Secret Store of an S3 app without prompts.
  if (serviceId == null && isS3StorageConfigRc(project.rc) && isNonInteractive()) {
    reportError('first-deploy-manual',
      'The first deploy of an app with S3 storage must be done by hand: run deploy on your computer (the Fastly CLI asks for the S3 credentials), ' +
      'or give the ID of a service that is already set up (--fastly-service-id, FASTLY_SERVICE_ID, or managed.serviceId).');
    return;
  }

  // A CLI run from the npx cache puts paths of the home directory into the Wasm binary.
  if (getOwnPackageDir().includes(`${path.sep}_npx${path.sep}`)) {
    console.warn(`⚠️ This CLI runs from the npx cache. The paths of the cache (in your home directory) go into the deployed Wasm binary.`);
    console.warn(`  * Add @fastly/compute-js-static-publish as a dev dependency of the project, and run it from there.`);
  }

  const { fingerprint } = await managedAppState(path.resolve(), project);
  const staticPublishVersion = getOwnVersion();

  if (serviceId != null && !force) {
    const active = await getActiveVersion(context, serviceId);
    const deployed = parseVersionComment(active?.comment);
    if (active != null && deployed?.fingerprint === fingerprint) {
      console.log(`✅ The active version ${active.number} already has this app (fingerprint ${fingerprint}). Nothing to deploy. Use --force to deploy anyway.`);
      setJsonResult({
        deployed: false,
        reason: 'up-to-date',
        serviceId,
        version: active.number,
        domain: (await getVersionDomains(context, serviceId, active.number))[0] ?? null,
        fingerprint,
        staticPublishVersion,
      });
      return;
    }
  }

  const { appDir } = await prepareManagedApp(path.resolve(), project);

  const build = runFastly(appDir, [ 'compute', 'build' ], apiToken.apiToken);
  if (build.error != null || build.status !== 0) {
    reportError('deploy-failed', `'fastly compute build' failed.`, EXIT_FAILED);
    return;
  }
  const deployArgs = [ 'compute', 'deploy', '--comment', formatVersionComment(staticPublishVersion, fingerprint, comment) ];
  if (serviceId != null) {
    deployArgs.push('--service-id', serviceId);
  }
  if (isNonInteractive()) {
    deployArgs.push('--non-interactive');
  }
  const deploy = runFastly(appDir, deployArgs, apiToken.apiToken);
  if (deploy.error != null || deploy.status !== 0) {
    reportError('deploy-failed', `'fastly compute deploy' failed.`, EXIT_FAILED);
    return;
  }

  // After the first deploy, the Fastly CLI has written service_id into fastly.toml.
  serviceId ??= readServiceId(path.resolve(appDir, 'fastly.toml')) ?? null;
  if (serviceId == null) {
    reportError('deploy-failed', 'The deploy finished, but the Service ID is not known.', EXIT_FAILED);
    return;
  }

  if (project.managed.serviceId == null) {
    const projectFilePath = path.resolve(PROJECT_FILE_NAME);
    const updated = writeBackServiceId(fs.readFileSync(projectFilePath, 'utf-8'), serviceId);
    if (updated != null) {
      fs.writeFileSync(projectFilePath, updated, 'utf-8');
      console.log(`✔️ Wrote managed.serviceId "${serviceId}" into ${PROJECT_FILE_NAME}. Commit it.`);
    } else {
      console.log(`⚠️ Set managed.serviceId to "${serviceId}" in ${PROJECT_FILE_NAME}. (The line 'serviceId: undefined,' was not found, so the CLI did not change the file.)`);
    }
  }

  const active = await getActiveVersion(context, serviceId);
  const domain = active != null ? (await getVersionDomains(context, serviceId, active.number))[0] ?? null : null;
  console.log(`🎉 Deployed ${serviceId}${active != null ? ` version ${active.number}` : ''}${domain != null ? ` (https://${domain}/)` : ''}.`);

  setJsonResult({
    deployed: true,
    serviceId,
    version: active?.number ?? null,
    domain,
    fingerprint,
    staticPublishVersion,
  });
}
