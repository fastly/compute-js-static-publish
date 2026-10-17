/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import child_process from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { normalizePublishContentConfig, type StaticPublishProjectNormalized } from '../util/config.js';
import { MANAGED_APP_DIR } from '../../models/config/static-publish-project.js';
import { isS3StorageConfigRc } from '../../models/config/static-publish-rc.js';
import { type AppConfig, generateApp } from '../commands/scaffold/generate-app.js';
import { appTemplates } from '../commands/scaffold/templates/index.js';
import { getOwnPackageDir, getOwnVersion, readOwnPackageJson } from '../util/package.js';
import { computeFingerprint, managedAppFiles } from './fingerprint.js';
import { findHostnameForAwsS3RegionAndBucket } from '../util/s3.js';
import { isJsonMode } from '../util/cli-output.js';
import { appConfigFromProject } from './project-file.js';
import { buildManagedLockfile, managedPackageSpec, readTemplateLockfile } from './lockfile.js';

// In 8.1, every managed project uses the plain template.
export const MANAGED_TEMPLATE = 'plain';

// The app config of a managed project, with the lockfile and the `file:` link
// to the copy of this package that runs the CLI.
export async function managedAppConfig(projectDir: string, project: StaticPublishProjectNormalized): Promise<AppConfig> {
  const errors: string[] = [];
  const publishContent = normalizePublishContentConfig(project.publishContent, errors);
  if (publishContent == null || errors.length > 0) {
    throw new Error(`publishContent is not valid:\n${errors.join('\n')}`);
  }

  let s3EndpointUrl: string | undefined;
  if (isS3StorageConfigRc(project.rc) && project.rc.s3.endpoint == null) {
    const hostname = await findHostnameForAwsS3RegionAndBucket(project.rc.s3.region, project.rc.s3.bucket);
    s3EndpointUrl = String(new URL(`https://${hostname}/`));
  }

  const appDir = path.resolve(projectDir, MANAGED_APP_DIR);
  const cliPackageDir = getOwnPackageDir();
  const appConfig = appConfigFromProject(project.rc, publishContent, project.managed, {
    projectDir,
    appDir,
    staticPublishVersionSpec: managedPackageSpec(cliPackageDir),
    template: appTemplates[MANAGED_TEMPLATE],
    s3EndpointUrl,
  });
  const lock = buildManagedLockfile(readTemplateLockfile(MANAGED_TEMPLATE), {
    appName: appConfig.name,
    appDir,
    cliPackageDir,
    cliPackageJson: readOwnPackageJson(),
  });
  return { ...appConfig, packageLock: JSON.stringify(lock, undefined, 2) + '\n' };
}

// Write the files of the app. A file in the app dir is written again if it
// changed. A file outside the app dir (the local KV Store file in the working
// dir) is written only if it does not exist, so that the local data stays.
export function writeManagedAppFiles(appDir: string, files: Record<string, string>): string[] {
  const written: string[] = [];
  for (const [ file, content ] of Object.entries(files)) {
    const filePath = path.resolve(appDir, file);
    const inApp = !path.relative(appDir, filePath).startsWith('..');
    if (fs.existsSync(filePath)) {
      if (!inApp || fs.readFileSync(filePath, 'utf-8') === content) {
        continue;
      }
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    written.push(file);
  }
  return written;
}

// The install stamp is in node_modules, so that it goes away with it.
const INSTALL_STAMP = 'node_modules/.compute-js-static-publish-install';

function installHash(appDir: string) {
  const hash = crypto.createHash('sha256');
  for (const file of [ 'package.json', 'package-lock.json' ]) {
    hash.update(fs.readFileSync(path.resolve(appDir, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function needsInstall(appDir: string): boolean {
  const stampPath = path.resolve(appDir, INSTALL_STAMP);
  return !fs.existsSync(stampPath) || fs.readFileSync(stampPath, 'utf-8') !== installHash(appDir);
}

// Run `npm ci` in the app dir, only if package.json or package-lock.json
// changed since the last install. Returns true if it installed.
export function installManagedApp(appDir: string): boolean {
  if (!needsInstall(appDir)) {
    return false;
  }
  console.log(`📦 Installing the dependencies of the app (npm ci)...`);
  // With --json, stdout is for the JSON object only.
  const result = child_process.spawnSync('npm', [ 'ci', '--no-audit', '--no-fund' ], {
    cwd: appDir,
    stdio: [ 'ignore', isJsonMode() ? process.stderr : 'inherit', 'inherit' ],
  });
  if (result.error != null || result.status !== 0) {
    throw new Error(`npm ci failed in ${appDir}.`);
  }
  fs.writeFileSync(path.resolve(appDir, INSTALL_STAMP), installHash(appDir), 'utf-8');
  return true;
}

// The files and the fingerprint of the app of a managed project, in memory.
export async function managedAppState(projectDir: string, project: StaticPublishProjectNormalized) {
  const appConfig = await managedAppConfig(projectDir, project);
  const files = managedAppFiles(generateApp(appConfig));
  const cliPackageDir = getOwnPackageDir();
  const fingerprint = computeFingerprint(files, {
    staticPublishVersion: getOwnVersion(),
    template: MANAGED_TEMPLATE,
    machinePaths: [ cliPackageDir, path.relative(appConfig.appDir, cliPackageDir).split(path.sep).join('/') ],
  });
  return { appDir: appConfig.appDir, appConfig, files, fingerprint };
}

// Generate the app of a managed project in .static-publish/app, and install
// its dependencies if necessary.
export async function prepareManagedApp(projectDir: string, project: StaticPublishProjectNormalized) {
  const { appConfig, files, fingerprint } = await managedAppState(projectDir, project);
  console.log(`🛠️ Generating the app in ${MANAGED_APP_DIR}...`);
  const written = writeManagedAppFiles(appConfig.appDir, files);
  if (written.length > 0) {
    console.log(`  | Wrote ${written.join(', ')}`);
  }
  const installed = installManagedApp(appConfig.appDir);
  return { appDir: appConfig.appDir, appConfig, files, fingerprint, installed };
}
