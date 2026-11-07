/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import * as path from 'node:path';

import { type PublisherServerConfigNormalized } from '../../models/config/publisher-server-config.js';
import { type PublishContentConfigNormalized } from '../../models/config/publish-content-config.js';
import { type StaticPublishProjectManaged } from '../../models/config/static-publish-project.js';
import { type StaticPublishRc, isS3StorageConfigRc } from '../../models/config/static-publish-rc.js';
import { getKvStoreConfigFromRc } from '../../models/config/kv-store-config.js';
import { type AppTemplate } from '../commands/scaffold/app-template.js';
import { type AppConfig } from '../commands/scaffold/generate-app.js';
import { renderAppResource } from '../commands/scaffold/render.js';
import { dotRelative } from '../util/files.js';

// The line in the managed section that deploy replaces with the service ID
// after the first deploy. resources/app/static-publish.project.js.njk writes it.
export const SERVICE_ID_PLACEHOLDER_LINE = '    serviceId: undefined,';

// The text of static-publish.project.js for an app config. projectDir is the
// directory of the file. The paths in the file are relative to it.
// appConfigFromProject() gives the same app config back.
export function renderProjectFile(config: AppConfig, projectDir: string, staticPublishVersion: string): string {

  const relative = (to: string) => {
    const result = dotRelative(projectDir, to).split(path.sep).join('/');
    return result === './' ? '.' : result;
  };

  const publicDirPrefix = config.publicDir !== config.rootDir ? config.publicDir.slice(config.rootDir.length).split(path.sep).join('/') : '';
  const staticItems = config.staticDirs.map(dir => {
    const item = dir.slice(config.publicDir.length).split(path.sep).join('/');
    return item.endsWith('/') ? item : item + '/';
  });
  const assetKey = (file: string | undefined) => file != null ? file.slice(config.rootDir.length).split(path.sep).join('/') : false;

  return renderAppResource('static-publish.project.js', {
    storage: config.storage,
    s3EndpointUrl: config.storage.mode === 's3' ? String(new URL(config.storage.endpointUrl)) : undefined,
    publishId: config.publishId,
    defaultCollectionName: config.defaultCollectionName,
    staticPublisherWorkingDir: relative(config.staticPublisherWorkingDir),
    collectionSelection: config.collectionSelection,
    rootDir: relative(config.rootDir),
    publicDirPrefix,
    staticItems,
    spaFile: assetKey(config.spaFilename),
    notFoundPageFile: assetKey(config.notFoundPageFilename),
    autoExt: config.autoExt,
    autoIndex: config.autoIndex,
    name: config.name,
    description: config.description,
    authors: config.author != null ? [ config.author ] : [],
    template: config.template.name,
    serviceId: config.serviceId,
    staticPublishVersion,
    fastlyToml: config.fastlyToml,
  });
}

export type AppConfigFromProjectOptions = {
  projectDir: string,
  appDir: string,
  staticPublishVersionSpec: string,
  template: AppTemplate,
  // With S3 storage and no s3.endpoint: the endpoint that scaffolding resolves
  // from the region and the bucket (findHostnameForAwsS3RegionAndBucket()).
  s3EndpointUrl?: string,
};

// The app config of a managed project. The publish settings come from the
// normalized publishContent section.
export function appConfigFromProject(
  rc: StaticPublishRc,
  publishContent: PublishContentConfigNormalized,
  managed: StaticPublishProjectManaged,
  options: AppConfigFromProjectOptions,
): AppConfig {
  const { projectDir, appDir } = options;
  const server: Partial<PublisherServerConfigNormalized> = publishContent.server ?? {};

  const rootDir = path.resolve(projectDir, publishContent.rootDir);
  const publicDir = server.publicDirPrefix ? path.resolve(rootDir, '.' + server.publicDirPrefix) : rootDir;
  // Only the directory items of staticItems map onto --static-dir.
  const staticDirs = (server.staticItems ?? [])
    .filter(item => item.startsWith('/') && item.endsWith('/'))
    .map(item => path.resolve(publicDir, '.' + item));
  const fileOf = (assetKey: string | null | undefined) => assetKey != null ? path.resolve(rootDir, '.' + assetKey) : undefined;

  let storage: AppConfig['storage'];
  if (isS3StorageConfigRc(rc)) {
    let endpointUrl;
    if (rc.s3.endpoint != null) {
      endpointUrl = String(new URL(/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(rc.s3.endpoint) ? rc.s3.endpoint : `https://${rc.s3.endpoint}`));
    } else if (options.s3EndpointUrl != null) {
      endpointUrl = options.s3EndpointUrl;
    } else {
      throw new Error('The S3 endpoint of the project is not resolved.');
    }
    storage = { mode: 's3', region: rc.s3.region, bucket: rc.s3.bucket, endpointUrl, endpointGenerated: rc.s3.endpoint == null };
  } else {
    storage = { mode: 'kv-store', kvStoreName: getKvStoreConfigFromRc(rc).kvStoreName };
  }

  return {
    appDir,
    name: managed.name,
    author: managed.authors?.[0],
    description: managed.description,
    serviceId: managed.serviceId,
    storage,
    publishId: rc.publishId,
    defaultCollectionName: rc.defaultCollectionName,
    staticPublisherWorkingDir: path.resolve(projectDir, rc.staticPublisherWorkingDir),
    rootDir,
    publicDir,
    staticDirs,
    spaFilename: fileOf(server.spaFile),
    notFoundPageFilename: fileOf(server.notFoundPageFile),
    autoIndex: server.autoIndex ?? [],
    autoExt: server.autoExt ?? [],
    staticPublishVersionSpec: options.staticPublishVersionSpec,
    template: options.template,
    // A managed project has no generatedFrom: its generated rc must not change each day.
    generatedFrom: undefined,
    ...(rc.collectionSelection != null ? { collectionSelection: rc.collectionSelection } : {}),
    ...(managed.fastlyToml != null ? { fastlyToml: managed.fastlyToml } : {}),
  };
}
