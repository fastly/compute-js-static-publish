/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';

import { type OptionDefinition } from 'command-line-args';

import { MANAGED_APP_DIR, PROJECT_FILE_NAME, RC_FILE_NAME } from '../../../../models/config/static-publish-project.js';
import { type StaticPublishRc } from '../../../../models/config/static-publish-rc.js';
import { DEFAULT_APP_TEMPLATE_NAME } from '../../scaffold/app-template.js';
import { DEFAULT_HONO_EXTENSIONS_DIR } from '../../../hono/build.js';
import { loadManagedProject } from '../../../managed/command-helpers.js';
import { applyTemplateInit, planTemplateInit, providedVersions, templateHasInit } from '../../../managed/template-init.js';
import { parseCommandLine } from '../../../util/args.js';
import { LoadConfigError, detectProjectMode, loadStaticPublisherRcFile } from '../../../util/config.js';
import { rootRelative } from '../../../util/files.js';
import { fail, isNonInteractive, recordFailure } from '../../../util/output.js';
import { cliCommand, getOwnVersion } from '../../../util/package.js';

function help() {
  console.log(`\

Usage:
  ${cliCommand()} template init [options]

Description:
  Makes or updates the folder of the app's template: for the hono template,
  the extensions folder (build.hono.extensionsDir, default ./hono-extensions).
  The template is managed.template in ${PROJECT_FILE_NAME}, or
  generatedFrom.template in ${RC_FILE_NAME}.

  A new folder gets package.json, tsconfig.json, and inactive examples. In a
  folder that exists, it updates only the peer dependencies on the packages
  that the app provides, and adds the starter files that are missing. It never
  changes your modules. Then run npm install in the folder.

Options:
  --reset                          Also write the starter files again (tsconfig.json
                                   and the examples). Asks before it replaces a file,
                                   or needs --force in non-interactive mode.
  --force                          With --reset: replace without a question.
  --check                          Change nothing. Fail (template-init-needed) if
                                   the folder is out of date. For CI.

Global Options:
  -h, --help                       Show this help message and exit.
`);
}

export type RunTemplateInitParams = {
  templateName: string,
  rc: Pick<StaticPublishRc, 'build'>,
  // The directory of the project file or of static-publish.rc.js. The path of
  // the folder is relative to it.
  baseDir: string,
  // The node_modules of the app, for the versions of the provided packages.
  appNodeModulesDir: string | undefined,
  reset?: boolean,
  force?: boolean,
  check?: boolean,
};

// The folder of a template.
function templateFolderDir(templateName: string, rc: Pick<StaticPublishRc, 'build'>, baseDir: string): string {
  // Only the hono template has a folder.
  return path.resolve(baseDir, rc.build?.hono?.extensionsDir ?? DEFAULT_HONO_EXTENSIONS_DIR);
}

// template init for a template and a folder. scaffold also runs it.
export async function runTemplateInit(params: RunTemplateInitParams) {
  const { templateName, rc, baseDir, appNodeModulesDir, reset = false, force = false, check = false } = params;
  if (!templateHasInit(templateName)) {
    console.log(`✔️ The template '${templateName}' has no folder to initialize.`);
    return;
  }

  const folderDir = templateFolderDir(templateName, rc, baseDir);
  const folderName = rootRelative(folderDir);
  const provided = providedVersions(templateName, appNodeModulesDir, getOwnVersion());
  const plan = planTemplateInit(templateName, folderDir, provided, { reset });

  if (check) {
    if (plan.outOfDate.length > 0) {
      fail('template-init-needed', `${folderName} is out of date. Run: ${cliCommand()} template init`);
      for (const reason of plan.outOfDate) {
        console.error(`  * ${reason}`);
      }
      return;
    }
    console.log(`✅ ${folderName} is up to date.`);
    return;
  }

  if (plan.replace.length > 0 && !force) {
    console.log(`template init --reset replaces these files in ${folderName}:`);
    for (const file of plan.replace) {
      console.log(`  * ${file}`);
    }
    if (isNonInteractive()) {
      fail('usage', 'In non-interactive mode, template init --reset needs --force to replace files.');
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('Replace them? (y/N) ');
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) {
      console.log('Nothing changed.');
      return;
    }
  }

  const isNew = !fs.existsSync(folderDir);
  const files = Object.keys(plan.write);
  if (files.length === 0) {
    console.log(`✅ ${folderName} is up to date. Nothing changed.`);
    return;
  }
  applyTemplateInit(folderDir, plan);
  console.log(`✅ ${isNew ? 'Made' : 'Updated'} ${folderName}: ${files.join(', ')}`);
  if (isNew || 'package.json' in plan.write) {
    console.log(`  * Run npm install in ${folderName}.`);
  }
}

export async function action(actionArgs: string[]) {

  const optionDefinitions: OptionDefinition[] = [
    { name: 'reset', type: Boolean },
    { name: 'force', type: Boolean },
    { name: 'check', type: Boolean },
  ];
  const parsed = parseCommandLine(actionArgs, optionDefinitions);
  if (parsed.needHelp) {
    if (parsed.error != null) {
      console.error(String(parsed.error));
      console.error();
      recordFailure('usage', String(parsed.error));
    }
    help();
    return;
  }
  const { reset, force, check } = parsed.commandLineOptions;
  if (check && (reset || force)) {
    fail('usage', '--check cannot be used with --reset or --force.');
    return;
  }
  if (force && !reset) {
    fail('usage', '--force is only for --reset.');
    return;
  }

  let templateName: string | undefined;
  let rc: StaticPublishRc;
  let appNodeModulesDir: string;
  if (detectProjectMode() === 'managed') {
    const project = await loadManagedProject('template init', '');
    if (project == null) {
      return;
    }
    templateName = project.managed.template ?? DEFAULT_APP_TEMPLATE_NAME;
    rc = project.rc;
    appNodeModulesDir = path.resolve(MANAGED_APP_DIR, 'node_modules');
  } else {
    try {
      rc = await loadStaticPublisherRcFile();
    } catch (err) {
      console.error(`❌ Can't load ${RC_FILE_NAME}`);
      if (err instanceof LoadConfigError) {
        for (const error of err.errors) {
          console.error(error);
        }
      }
      recordFailure('config-invalid', `Can't load ${RC_FILE_NAME}.`);
      return;
    }
    templateName = rc.generatedFrom?.template;
    if (templateName == null) {
      fail('config-invalid', `${RC_FILE_NAME} has no generatedFrom, so the template of the app is not known.`);
      console.error(`  * Add it by hand, for example:`);
      console.error(`    generatedFrom: { template: 'hono', staticPublishVersion: '${getOwnVersion()}', generatedAt: 'YYYY-MM-DD' },`);
      return;
    }
    appNodeModulesDir = path.resolve('node_modules');
  }

  await runTemplateInit({
    templateName,
    rc,
    baseDir: path.resolve(),
    appNodeModulesDir,
    reset,
    force,
    check,
  });
}
