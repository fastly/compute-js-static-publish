/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { type PublishContentConfig } from './publish-content-config.js';
import { type StaticPublishRc } from './static-publish-rc.js';

// A managed project has one file, static-publish.project.js, in the project
// dir. The name of the file marks managed mode. An ejected app has
// static-publish.rc.js and publish-content.config.js in the app dir.
export const PROJECT_FILE_NAME = 'static-publish.project.js';
export const RC_FILE_NAME = 'static-publish.rc.js';

// The generated app of a managed project, relative to the project dir.
export const MANAGED_APP_DIR = '.static-publish/app';

// Sections that the generator adds to the fastly.toml of the app, in the
// structure of fastly.toml: local_server (for fastly compute serve) and setup
// (for the first deploy, which makes the service). For example:
// { local_server: { secret_stores: { oauth: [ { key: 'SECRET', env: 'SECRET' } ] } } }
export type FastlyTomlSections = {
  local_server?: Record<string, unknown>,
  setup?: Record<string, unknown>,
};

// Read by the generator only.
export type StaticPublishProjectManaged = {
  // fastly.toml and package.json
  name?: string,
  description?: string,
  authors?: string[],
  // The template of the generated app. A missing value means 'plain'.
  template?: string,
  // Written after the first deploy.
  serviceId?: string,
  // The version of this package that the project uses.
  staticPublishVersion?: string,
  // Added to the fastly.toml of the app.
  fastlyToml?: FastlyTomlSections,
};

// The top level has the fields of static-publish.rc.js (read by the app at
// runtime). publishContent has the fields of publish-content.config.js (read
// by publish-content). managed is read by the generator only.
// staticPublisherWorkingDir and the paths in publishContent are relative to the
// project dir.
export type StaticPublishProject = StaticPublishRc & {
  publishContent: PublishContentConfig,
  managed?: StaticPublishProjectManaged,
};
