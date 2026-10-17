/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import * as path from 'node:path';

import { type GeneratedFrom } from '../../../models/config/static-publish-rc.js';
import { dotRelative } from '../../util/files.js';
import { type AppTemplate } from './templates/index.js';

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
  // Written into static-publish.rc.js, if set.
  generatedFrom: GeneratedFrom | undefined,
};

// The names of the template hooks. Every app has them as npm scripts. Each one
// runs scripts/template_<name>.js if the app has that file.
export const TEMPLATE_HOOKS = [ 'prebuild', 'postbuild', 'postinstall' ] as const;

// Makes the files of the app, keyed by the path relative to the app dir.
// It does not use the file system or the network, so scaffolding, managed
// mode, and eject can share it, and tests can compare its output.
export function generateApp(config: AppConfig): Record<string, string> {
  const {
    appDir: computeJsDir,
    name,
    author,
    description,
    serviceId: fastlyServiceId,
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
    staticPublishVersionSpec: computeJsStaticPublisherVersion,
    template,
    generatedFrom,
  } = config;
  const storageMode = storage.mode;

  const resourceFiles: Record<string, string> = {};

  // .gitignore
  resourceFiles['.gitignore'] = `\
/node_modules
/bin
/pkg
/${path.relative(computeJsDir, staticPublisherWorkingDir)}
` + (template.gitignore ?? []).map(line => `${line}\n`).join('');

  // package.json
  const packageJsonScripts: Record<string, string> = {
    'dev:start': 'fastly compute serve',
    'fastly:deploy': 'fastly compute publish',
    'build': 'js-compute-runtime ./src/index.js ./bin/main.wasm',
  };
  for (const hook of TEMPLATE_HOOKS) {
    packageJsonScripts[hook] = `compute-js-static-publish run-template-hook ${hook}`;
  }
  if (storageMode === 'kv-store') {
    packageJsonScripts['dev:publish'] = 'npx @fastly/compute-js-static-publish publish-content --local';
    packageJsonScripts['fastly:publish'] = 'npx @fastly/compute-js-static-publish publish-content';
  } else if (storageMode === 's3') {
    packageJsonScripts['s3:publish'] = 'npx @fastly/compute-js-static-publish publish-content';
  }
  resourceFiles['package.json'] = JSON.stringify({
    name,
    version: '0.1.0',
    description,
    author,
    type: 'module',
    devDependencies: {
      "@fastly/cli": "^16.0.0",
      '@fastly/compute-js-static-publish': computeJsStaticPublisherVersion,
      ...template.devDependencies,
    },
    dependencies: {
      '@fastly/js-compute': '^4.0.0',
      ...template.dependencies,
    },
    engines: {
      node: '>=20.11.0',
    },
    private: true,
    scripts: packageJsonScripts,
  }, undefined, 2);

  // fastly.toml
  let fastlyTomlLocalServer = '';
  let fastlyTomlSetup = '';
  if (storage.mode === 'kv-store') {
    const kvStoreName = storage.kvStoreName;
    const localServerKvStorePath = dotRelative(computeJsDir, path.resolve(staticPublisherWorkingDir, 'kvstore.json'));
    fastlyTomlLocalServer = /* language=text */ `\
[local_server]

[local_server.kv_stores]
${kvStoreName} = { file = "${localServerKvStorePath}", format = "json" }
`;
    fastlyTomlSetup = /* language=text */ `\
[setup]

[setup.kv_stores]
[setup.kv_stores.${kvStoreName}]
`;

    // kvstore.json
    resourceFiles[localServerKvStorePath] = '{}';
  } else if (storage.mode === 's3') {
    const s3EndpointUrl = new URL(storage.endpointUrl);
    fastlyTomlLocalServer = /* language=text */ `\
[local_server]

[local_server.secret_stores]
[[local_server.secret_stores.S3_CREDENTIALS]]
key = "S3_ACCESS_KEY_ID"
env = "S3_ACCESS_KEY_ID"
[[local_server.secret_stores.S3_CREDENTIALS]]
key = "S3_SECRET_ACCESS_KEY"
env = "S3_SECRET_ACCESS_KEY"

[local_server.backends]
[local_server.backends.s3_storage]
url = "${String(s3EndpointUrl)}"
override_host = "${s3EndpointUrl.hostname}"
`;
    fastlyTomlSetup = /* language=text */ `\
[setup]

[setup.backends]
[setup.backends.s3_storage]
address = "${s3EndpointUrl.hostname}"
description = "S3 API endpoint"
port = 443
[setup.secret_stores]
[setup.secret_stores.S3_CREDENTIALS]
description = "Credentials for S3 storage"
[setup.secret_stores.S3_CREDENTIALS.entries]
[setup.secret_stores.S3_CREDENTIALS.entries.S3_ACCESS_KEY_ID]
description = "Access Key ID"
[setup.secret_stores.S3_CREDENTIALS.entries.S3_SECRET_ACCESS_KEY]
description = "Secret Access Key"
`;
  }

  resourceFiles['fastly.toml'] = /* language=text */ `\
# This file describes a Fastly Compute package. To learn more visit:
# https://developer.fastly.com/reference/fastly-toml/

authors = [ "${author}" ]
description = "${description}"
language = "javascript"
manifest_version = 3
name = "${name}"
${fastlyServiceId != null ? `service_id = "${fastlyServiceId}"\n` : ''}
[scripts]
build = "npm run build"

${fastlyTomlLocalServer}
${fastlyTomlSetup}
`;

  // static-publish.rc.js
  let staticPublishStorage = '';
  if (storage.mode === 'kv-store') {
    staticPublishStorage = `\
  storageMode: "kv-store",
  kvStore: {
    kvStoreName: ${JSON.stringify(storage.kvStoreName)},
  },\
`;
  } else if (storage.mode === 's3') {
    staticPublishStorage = `\
  storageMode: "s3",
  s3: {
    region: ${JSON.stringify(storage.region)},
    bucket: ${JSON.stringify(storage.bucket)},\
` + (!storage.endpointGenerated ? `
    endpoint: ${JSON.stringify(String(new URL(storage.endpointUrl)))},\
` : '') + `
  },\
`;
  }
  resourceFiles['static-publish.rc.js'] = `\
/*
 * Generated by @fastly/compute-js-static-publish.
 */

/** @type {import('@fastly/compute-js-static-publish').StaticPublishRc} */
const rc = {
${staticPublishStorage}
  publishId: ${JSON.stringify(publishId)},
  defaultCollectionName: ${JSON.stringify(defaultCollectionName)},
  staticPublisherWorkingDir: ${JSON.stringify(dotRelative(computeJsDir, staticPublisherWorkingDir))},${generatedFrom != null ? `
  generatedFrom: {
    template: ${JSON.stringify(generatedFrom.template)},
    staticPublishVersion: ${JSON.stringify(generatedFrom.staticPublishVersion)},
    generatedAt: ${JSON.stringify(generatedFrom.generatedAt)},
  },` : ''}
};

export default rc;
`;

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

  resourceFiles['publish-content.config.js'] = `\
/*
 * Generated by @fastly/compute-js-static-publish.
 */

// Commented items are defaults, feel free to modify and experiment!
// See README for a detailed explanation of the configuration options.

/** @type {import('@fastly/compute-js-static-publish').PublishContentConfig} */
const config = {
  rootDir: ${JSON.stringify(dotRelative(computeJsDir, rootDir))},
  // excludeDirs: [ './node_modules' ],
  // excludeDotFiles: true,
  // includeWellKnown: true,
  // assetInclusionTest: (assetKey) => true,
  // contentCompression: [ 'br', 'gzip' ],
  // brotliQuality: 11,
  // contentTypes: [
  //   { test: /.custom$/, contentType: 'application/x-custom', text: false },
  // ],
  
  // Server settings are saved to storage per collection
  server: {${publicDirPrefix !== '' ? `
    publicDirPrefix: ${JSON.stringify(publicDirPrefix)},` : ''}
    staticItems: ${JSON.stringify(staticItems)},
    allowedEncodings: [ 'br', 'gzip' ],
    spaFile: ${JSON.stringify(spaFile)},
    notFoundPageFile: ${JSON.stringify(notFoundPageFile)}, 
    autoExt: ${JSON.stringify(autoExt)},
    autoIndex: ${JSON.stringify(autoIndex)},
  },
};

export default config;
`;

  // The template's files. A template only adds files.
  for (const [ file, content ] of Object.entries(template.files)) {
    const key = path.posix.normalize(file);
    if (Object.keys(resourceFiles).some(x => path.posix.normalize(x) === key)) {
      throw new Error(`Template file '${file}' is a file that generateApp() writes.`);
    }
    resourceFiles[file] = content;
  }

  return resourceFiles;
}
