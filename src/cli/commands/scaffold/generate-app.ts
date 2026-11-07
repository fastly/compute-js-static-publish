/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import * as path from 'node:path';

import { type CollectionSelection } from '../../../models/config/collection-selection.js';
import { type FastlyTomlSections } from '../../../models/config/static-publish-project.js';
import { type GeneratedFrom } from '../../../models/config/static-publish-rc.js';
import { dotRelative } from '../../util/files.js';
import { ConfigError } from '../../util/output.js';
import { type AppTemplate } from './app-template.js';
import { addFastlyTomlSections } from './fastly-toml-sections.js';
import { renderAppResource } from './render.js';

// The resolved settings of an app: everything that generateApp() needs.
// Paths are absolute. The fields map onto the scaffold flags.
export type AppConfig = {
  appDir: string,
  name: string | undefined,
  author: string | undefined,
  description: string | undefined,
  serviceId: string | undefined,
  storage:
    | { mode: 'kv-store', kvStoreName: string }
    | { mode: 's3', region: string, bucket: string, endpointUrl: string, endpointGenerated: boolean },
  publishId: string,
  defaultCollectionName: string,
  staticPublisherWorkingDir: string,
  rootDir: string,
  publicDir: string,
  staticDirs: string[],
  spaFilename: string | undefined,
  notFoundPageFilename: string | undefined,
  autoIndex: string[],
  autoExt: string[],
  // The version spec of this package for the app's package.json.
  staticPublishVersionSpec: string,
  // The template of the app.
  template: AppTemplate,
  // Written into static-publish.rc.js, if set. A managed project has none.
  generatedFrom: GeneratedFrom | undefined,
  // Written into static-publish.rc.js, if set. The template must support it.
  collectionSelection?: CollectionSelection,
  // Added to fastly.toml, if set (managed.fastlyToml of a managed project).
  fastlyToml?: FastlyTomlSections,
  // Written as package-lock.json, if set (a managed app).
  packageLock?: string,
};

// The names of the template hooks. Every app has them as npm scripts. Each one
// runs scripts/template_<name>.js if the app has that file.
export const TEMPLATE_HOOKS = [ 'prebuild', 'postbuild', 'postinstall' ] as const;

// The watch script of a template, if it has one. It runs next to
// `fastly compute serve --watch` (npm run dev:watch, or dev -- --watch), until
// it is stopped.
export const TEMPLATE_WATCH_SCRIPT = 'scripts/template_watch.js';

// Makes the files of the app, keyed by the path relative to the app dir.
// It does not write files or use the network, so that tests can compare its
// output. It reads only the resources/ directory of this package.
export function generateApp(config: AppConfig): Record<string, string> {
  const {
    appDir: computeJsDir,
    name,
    author,
    description,
    serviceId,
    storage,
    publishId,
    defaultCollectionName,
    staticPublisherWorkingDir,
    rootDir,
    publicDir,
    staticDirs,
    spaFilename,
    notFoundPageFilename,
    autoIndex,
    autoExt,
    staticPublishVersionSpec,
    template,
    generatedFrom,
    collectionSelection,
    fastlyToml,
    packageLock,
  } = config;

  if (collectionSelection != null && !template.supports.collectionSelection) {
    throw new ConfigError(`The template '${template.name}' does not support collectionSelection.`);
  }

  const resourceFiles: Record<string, string> = {};

  // .gitignore. The working dir only if it is in the app dir.
  const workingDirInApp = path.relative(computeJsDir, staticPublisherWorkingDir);
  resourceFiles['.gitignore'] = renderAppResource('gitignore', {
    workingDirInApp: !workingDirInApp.startsWith('..') ? workingDirInApp : undefined,
  });

  // package.json: the dependencies come from the template's package.json.
  const packageJsonScripts: Record<string, string> = {
    'dev:start': 'fastly compute serve',
    'dev:watch': 'compute-js-static-publish run-dev-watch',
    'fastly:deploy': 'fastly compute publish',
    'prebuild': 'compute-js-static-publish run-template-hook prebuild',
    'build': `js-compute-runtime ./${template.entry} ./bin/main.wasm`,
    'postbuild': 'compute-js-static-publish run-template-hook postbuild',
    'postinstall': 'compute-js-static-publish run-template-hook postinstall',
  };
  if (storage.mode === 'kv-store') {
    packageJsonScripts['dev:publish'] = 'npx @fastly/compute-js-static-publish publish-content --local';
    packageJsonScripts['fastly:publish'] = 'npx @fastly/compute-js-static-publish publish-content';
  } else if (storage.mode === 's3') {
    packageJsonScripts['s3:publish'] = 'npx @fastly/compute-js-static-publish publish-content';
  }
  resourceFiles['package.json'] = JSON.stringify({
    name,
    version: '0.1.0',
    description,
    author,
    type: 'module',
    devDependencies: {
      ...template.devDependencies,
      '@fastly/compute-js-static-publish': staticPublishVersionSpec,
    },
    dependencies: {
      ...template.dependencies,
    },
    engines: {
      node: '>=20.11.0',
    },
    private: true,
    scripts: packageJsonScripts,
  }, undefined, 2);

  if (packageLock != null) {
    resourceFiles['package-lock.json'] = packageLock;
  }

  // fastly.toml
  let localServerKvStorePath: string | undefined;
  let s3EndpointUrl: string | undefined;
  let s3EndpointHostname: string | undefined;
  if (storage.mode === 'kv-store') {
    localServerKvStorePath = dotRelative(computeJsDir, path.resolve(staticPublisherWorkingDir, 'kvstore.json'));
    // kvstore.json
    resourceFiles[localServerKvStorePath] = '{}';
  } else if (storage.mode === 's3') {
    const url = new URL(storage.endpointUrl);
    s3EndpointUrl = String(url);
    s3EndpointHostname = url.hostname;
  }
  resourceFiles['fastly.toml'] = addFastlyTomlSections(renderAppResource('fastly.toml', {
    author,
    description,
    name,
    serviceId,
    storage,
    localServerKvStorePath,
    s3EndpointUrl,
    s3EndpointHostname,
  }), fastlyToml);

  // static-publish.rc.js
  resourceFiles['static-publish.rc.js'] = renderAppResource('static-publish.rc.js', {
    storage,
    s3EndpointUrl,
    publishId,
    defaultCollectionName,
    staticPublisherWorkingDir: dotRelative(computeJsDir, staticPublisherWorkingDir),
    generatedFrom,
    collectionSelection,
  });

  // publish-content.config.js
  // publicDirPrefix -- if public dir is deeper than the root dir, then
  // public dir is used as a prefix to drill into asset names.
  // e.g.,
  // root dir   : /path/to/root
  // public dir : /path/to/root/public
  // then publicDirPrefix = /public

  // The caller has already established publicDir.startsWith(rootDir)
  let publicDirPrefix = '';
  if (rootDir !== publicDir) {
    publicDirPrefix = publicDir.slice(rootDir.length);
  }

  // staticItems - specified as prefixes, relative to publicDir
  const staticItems: string[] = [];
  for (const staticDir of staticDirs) {
    // The caller has already established staticDir.startsWith(publicDir)
    let staticItem = staticDir.slice(publicDir.length);
    if (!staticItem.endsWith('/')) {
      // Ending with a slash denotes that this is a directory.
      staticItem = staticItem + '/';
    }
    staticItems.push(staticItem);
  }

  // spaFile - asset key of spa file
  let spaFile: string | false = false;
  if (spaFilename != null) {
    // The caller has already established spaFilename.startsWith(rootDir)
    // and that it exists
    spaFile = spaFilename.slice(rootDir.length);
  }

  let notFoundPageFile: string | false = false;
  if(notFoundPageFilename != null) {
    // The caller has already established notFoundPageFilename.startsWith(rootDir)
    // and that it exists
    notFoundPageFile = notFoundPageFilename.slice(rootDir.length);
  }

  resourceFiles['publish-content.config.js'] = renderAppResource('publish-content.config.js', {
    rootDir: dotRelative(computeJsDir, rootDir),
    publicDirPrefix,
    staticItems,
    spaFile,
    notFoundPageFile,
    autoExt,
    autoIndex,
  });

  // The files of the template, for example src/index.js. A template never
  // replaces a file that generateApp() writes.
  const written = new Set(Object.keys(resourceFiles).map(file => path.posix.normalize(file)));
  for (const [ file, content ] of Object.entries(template.files)) {
    if (written.has(path.posix.normalize(file))) {
      throw new Error(`The template '${template.name}' has the file '${file}', which generateApp() writes.`);
    }
    resourceFiles[file] = content;
  }

  return resourceFiles;
}
