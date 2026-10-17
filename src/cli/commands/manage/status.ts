/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import path from 'node:path';

import { type OptionDefinition } from 'command-line-args';

import { managedAppState } from '../../managed/app.js';
import { loadManagedProject } from '../../managed/command-helpers.js';
import { getActiveVersion, getVersionDomains } from '../../managed/fastly-service.js';
import { parseVersionComment } from '../../managed/fingerprint.js';
import { checkProjectVersion } from '../../managed/version-check.js';
import { loadApiToken } from '../../util/api-token.js';
import { parseCommandLine } from '../../util/args.js';
import { recordError, setJsonResult } from '../../util/cli-output.js';
import { detectProjectMode } from '../../util/config.js';
import { getOwnVersion } from '../../util/package.js';
import { loadServiceId } from '../../util/service-id.js';
import { previewUrlTemplates } from '../../../models/config/collection-selection.js';
import { MANAGED_APP_DIR } from '../../../models/config/static-publish-project.js';

function help() {
  console.log(`\

Usage:
  npx @fastly/compute-js-static-publish status [options]

Description:
  Shows the state of the app. In a managed project: the fingerprint of the app
  that the project generates, the fingerprint of the active version of the
  service, and if a deploy is necessary. In an ejected app: the Service ID.

Options:
  --fastly-service-id=<id>         The service. Default: FASTLY_SERVICE_ID, then
                                   managed.serviceId (or service_id in fastly.toml).
  --fastly-api-token=<token>       Reads the active version of the service. Default:
                                   FASTLY_API_TOKEN. Without a token, the deployed
                                   fingerprint is unknown.
  --json                           Write the state as JSON to stdout.

Global Options:
  -h, --help                       Show this help message and exit.
`);
}

export async function action(actionArgs: string[]) {

  const optionDefinitions: OptionDefinition[] = [
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
    ['fastly-service-id']: fastlyServiceId,
    ['fastly-api-token']: fastlyApiToken,
  } = parsed.commandLineOptions;

  if (detectProjectMode() === 'ejected') {
    const serviceIdResult = loadServiceId({ commandLine: fastlyServiceId, fastlyTomlPath: path.resolve('fastly.toml') });
    console.log(`Mode       : ejected`);
    console.log(`Service ID : ${serviceIdResult?.serviceId ?? '(none)'}`);
    setJsonResult({ mode: 'ejected', serviceId: serviceIdResult?.serviceId ?? null });
    return;
  }

  const project = await loadManagedProject('status', '');
  if (project == null) {
    return;
  }

  const running = getOwnVersion();
  const versionCheck = checkProjectVersion(project.managed.staticPublishVersion, running);
  const { fingerprint } = await managedAppState(path.resolve(), project);

  const serviceIdResult = loadServiceId({
    commandLine: fastlyServiceId,
    // After the first deploy, the Fastly CLI writes service_id here.
    fastlyTomlPath: path.resolve(MANAGED_APP_DIR, 'fastly.toml'),
    projectServiceId: project.managed.serviceId,
  });
  const serviceId = serviceIdResult?.serviceId ?? null;
  const apiToken = loadApiToken({ commandLine: fastlyApiToken });

  let deployedFingerprint: string | null = null;
  let deployedStaticPublishVersion: string | null = null;
  let activeVersion: number | null = null;
  let domain: string | null = null;
  let needsDeploy: boolean | null;
  const reasons: string[] = [];

  if (serviceId == null) {
    needsDeploy = true;
    reasons.push('The project has no service yet (no Service ID).');
  } else if (apiToken == null) {
    needsDeploy = null;
    reasons.push('Unknown: no API token, so the active version of the service cannot be read.');
  } else {
    const context = { apiToken: apiToken.apiToken };
    const active = await getActiveVersion(context, serviceId);
    if (active == null) {
      needsDeploy = true;
      reasons.push('The service has no active version.');
    } else {
      activeVersion = active.number;
      domain = (await getVersionDomains(context, serviceId, active.number))[0] ?? null;
      const deployed = parseVersionComment(active.comment);
      if (deployed == null) {
        needsDeploy = true;
        reasons.push(`The active version (${active.number}) was not deployed by 'deploy' (its comment has no fingerprint).`);
      } else {
        deployedFingerprint = deployed.fingerprint;
        deployedStaticPublishVersion = deployed.staticPublishVersion;
        needsDeploy = deployed.fingerprint !== fingerprint;
        if (needsDeploy) {
          reasons.push(deployed.staticPublishVersion !== running ?
            `The version of this package changed: ${deployed.staticPublishVersion} → ${running}.` :
            'The generated app changed.');
        }
      }
    }
  }

  const baseUrl = domain != null ? `https://${domain}` : 'https://<service domain>';
  const previewUrls = project.rc.collectionSelection != null ? previewUrlTemplates(baseUrl, project.rc.collectionSelection) : [];

  console.log(`Mode                   : managed`);
  console.log(`Service ID             : ${serviceId ?? '(none)'}${serviceIdResult != null ? ` (from ${serviceIdResult.source})` : ''}`);
  console.log(`Version of the project : ${versionCheck.recorded ?? '(missing)'}`);
  console.log(`Version that runs      : ${running}${versionCheck.result !== 'same' ? `  ⚠️ ${versionCheck.result}` : ''}`);
  console.log(`Fingerprint            : ${fingerprint}`);
  console.log(`Deployed fingerprint   : ${deployedFingerprint ?? '(unknown)'}${activeVersion != null ? ` (version ${activeVersion})` : ''}`);
  console.log(`Deploy necessary       : ${needsDeploy == null ? 'unknown' : needsDeploy ? 'yes' : 'no'}`);
  for (const reason of reasons) {
    console.log(`  * ${reason}`);
  }
  for (const { type, url } of previewUrls) {
    console.log(`Preview URL (${type})${' '.repeat(Math.max(0, 9 - type.length))}: ${url}`);
  }

  setJsonResult({
    mode: 'managed',
    serviceId,
    staticPublishVersion: {
      recorded: versionCheck.recorded ?? null,
      running,
      check: versionCheck.result,
    },
    fingerprint: {
      current: fingerprint,
      deployed: deployedFingerprint,
      deployedStaticPublishVersion,
    },
    activeVersion,
    domain,
    needsDeploy,
    reasons,
    previewUrls,
  });
}
