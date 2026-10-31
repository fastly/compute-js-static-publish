/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import * as path from 'node:path';

import { type GeneratedFrom } from '../../../models/config/static-publish-rc.js';
import { dotRelative } from '../../util/files.js';
import { type AppTemplate } from './app-template.js';
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
  // What the app's code comes from.
  template: AppTemplate,
  // Written into static-publish.rc.js.
  generatedFrom: GeneratedFrom,
};

// The names of the template hooks. Every app has them as npm scripts. Each one
// runs scripts/template_<name>.js if the app has that file.
export const TEMPLATE_HOOKS = [ 'prebuild', 'postbuild', 'postinstall' ] as const;

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
  } = config;

  const resourceFiles: Record<string, string> = {};

  // .gitignore
  resourceFiles['.gitignore'] = renderAppResource('gitignore', {
    workingDirInApp: path.relative(computeJsDir, staticPublisherWorkingDir),
  });

  // package.json: the dependencies come from the template's package.json.
  const packageJsonScripts: Record<string, string> = {
    'dev:start': 'fastly compute serve',
    'fastly:deploy': 'fastly compute publish',
    'prebuild': 'compute-js-static-publish run-template-hook prebuild',
    'build': 'js-compute-runtime ./src/index.js ./bin/main.wasm',
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
  resourceFiles['fastly.toml'] = renderAppResource('fastly.toml', {
    author,
    description,
    name,
    serviceId,
    storage,
    localServerKvStorePath,
    s3EndpointUrl,
    s3EndpointHostname,
  });

  // static-publish.rc.js
  resourceFiles['static-publish.rc.js'] = renderAppResource('static-publish.rc.js', {
    storage,
    s3EndpointUrl,
    publishId,
    defaultCollectionName,
    staticPublisherWorkingDir: dotRelative(computeJsDir, staticPublisherWorkingDir),
    generatedFrom,
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
