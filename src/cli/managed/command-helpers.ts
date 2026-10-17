/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import fs from 'node:fs';
import path from 'node:path';

import { PROJECT_FILE_NAME } from '../../models/config/static-publish-project.js';
import { recordError, reportError } from '../util/cli-output.js';
import { LoadConfigError, type StaticPublishProjectNormalized, detectProjectMode, loadProjectFile } from '../util/config.js';
import { getOwnVersion } from '../util/package.js';
import { writeBackStaticPublishVersion } from './project-edit.js';
import { checkProjectVersion, versionCheckError } from './version-check.js';

// Load the project file of a managed project, or report why not.
export async function loadManagedProject(command: string, ejectedHint: string): Promise<StaticPublishProjectNormalized | null> {
  if (detectProjectMode() !== 'managed') {
    reportError('usage', `'${command}' works only in a managed project (${PROJECT_FILE_NAME}). ${ejectedHint}`);
    return null;
  }
  try {
    return await loadProjectFile();
  } catch (err) {
    console.error(`❌ Can't load ${PROJECT_FILE_NAME}`);
    if (err instanceof LoadConfigError) {
      for (const error of err.errors) {
        console.error(error);
      }
    } else {
      console.error(String(err));
    }
    recordError('config-invalid', `Can't load ${PROJECT_FILE_NAME}.`);
    return null;
  }
}

// Check managed.staticPublishVersion against the running CLI. With
// autoUpgrade, a newer CLI writes its version into the project file. Returns
// false (and reports the error) if the command must stop.
export function checkVersionForCommand(project: StaticPublishProjectNormalized, autoUpgrade: boolean): boolean {
  const check = checkProjectVersion(project.managed.staticPublishVersion, getOwnVersion());
  const error = versionCheckError(check, autoUpgrade);
  if (error != null) {
    reportError('version-mismatch', error);
    return false;
  }
  if (check.result === 'newer-cli' && autoUpgrade) {
    if (!writeProjectVersion(check.running)) {
      return false;
    }
    console.log(`✔️ --auto-upgrade: the project now uses ${check.running} (was ${check.recorded}).`);
    project.managed.staticPublishVersion = check.running;
  }
  return true;
}

// Write managed.staticPublishVersion into the project file.
export function writeProjectVersion(version: string): boolean {
  const filePath = path.resolve(PROJECT_FILE_NAME);
  const text = fs.readFileSync(filePath, 'utf-8');
  const updated = writeBackStaticPublishVersion(text, version);
  if (updated == null) {
    reportError('config-invalid', `Can't find the line 'staticPublishVersion: "…",' in the managed section of ${PROJECT_FILE_NAME}. Set it by hand to "${version}".`);
    return false;
  }
  if (updated !== text) {
    fs.writeFileSync(filePath, updated, 'utf-8');
  }
  return true;
}
