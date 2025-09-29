/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

import globToRegExp from 'glob-to-regexp';

import {
  type StaticPublishRc,
  type StaticPublishPartialStorage,
  isKvStoreConfigRc,
  isS3StorageConfigRc,
} from '../../models/config/static-publish-rc.js';
import {
  getKvStoreConfigFromRc,
} from '../../models/config/kv-store-config.js';
import {
  getS3StorageConfigFromRc,
} from '../../models/config/s3-storage-config.js';
import {
  type PublishContentConfigNormalized,
  type ContentTypeDef,
} from '../../models/config/publish-content-config.js';
import {
  buildNormalizeFunctionForArray,
  buildNormalizeFunctionForObject,
  isSpecified,
  isStringAndNotEmpty,
} from './data.js';
import { type PublisherServerConfigNormalized } from '../../models/config/publisher-server-config.js';

export class LoadConfigError extends Error {
  errors: string[];

  constructor(configFilePath: string, errors: string[]) {
    super(`Error loading config file ${configFilePath}`);
    this.errors = errors;
  }
}

export async function loadStaticPublisherRcFile(): Promise<StaticPublishRc> {

  let configRaw;

  const configFile = './static-publish.rc.js';

  const configFilePath = path.resolve(configFile);
  try {
    configRaw = (await import(pathToFileURL(configFilePath).href)).default;
  } catch (ex) {
    throw new LoadConfigError(configFile, [
      `Unable to load ${configFilePath}`,
      String(ex),
    ]);
  }

  if (configRaw == null) {
    throw new LoadConfigError(configFile, [
      `Unable to load ${configFilePath}`,
      `default export does not exist or is null.`
    ]);
  }

  const errors: string[] = [];
  const config = normalizeStaticPublisherRc(configRaw, errors);
  if (config == null) {
    throw new LoadConfigError(configFile, errors);
  }

  return config;

}


export const normalizeStaticPublisherRc = buildNormalizeFunctionForObject<StaticPublishRc>((config, errors) => {

  let {
    publishId,
    defaultCollectionName,
    staticPublisherWorkingDir,
  } = config;

  let storage: StaticPublishPartialStorage | null = null;
  if (isKvStoreConfigRc(config)) {
    storage = {
      storageMode: 'kv-store',
      kvStore: getKvStoreConfigFromRc(config),
    };
  } else if (isS3StorageConfigRc(config)) {
    storage = {
      storageMode: 's3',
      s3: getS3StorageConfigFromRc(config),
    };
  }

  if (!isSpecified(config, 'publishId')) {
    errors.push('publishId must be specified.');
  } else {
    if (isStringAndNotEmpty(publishId)) {
      // ok
    } else {
      errors.push('publishId must be a non-empty string.');
    }
  }

  if (!isSpecified(config, 'defaultCollectionName')) {
    errors.push('defaultCollectionName must be specified.');
  } else {
    if (isStringAndNotEmpty(defaultCollectionName)) {
      // ok
    } else {
      errors.push('defaultCollectionName must be a non-empty string.');
    }
  }

  if (!isSpecified(config, 'staticPublisherWorkingDir')) {
    errors.push('staticPublisherWorkingDir must be specified.');
  } else {
    if (
      staticPublisherWorkingDir.startsWith('./') &&
      staticPublisherWorkingDir !== './' &&
      !staticPublisherWorkingDir.includes('//')
    ) {
      // ok
    } else {
      errors.push('staticPublisherWorkingDir must be a relative subdirectory.');
    }

    while (staticPublisherWorkingDir.endsWith('/')) {
      staticPublisherWorkingDir = staticPublisherWorkingDir.slice(0, -1);
    }
  }

  return Object.assign({},
    storage,
    {
      publishId,
      defaultCollectionName,
      staticPublisherWorkingDir,
    },
  );
});

export async function loadPublishContentConfigFile(configFile: string): Promise<PublishContentConfigNormalized> {

  let configRaw;

  const configFilePath = path.resolve(configFile);
  try {
    configRaw = (await import(pathToFileURL(configFilePath).href)).default;
  } catch (ex) {
    throw new LoadConfigError(configFile, [
      `Unable to load ${configFilePath}`,
      String(ex),
    ]);
  }

  if (configRaw == null) {
    throw new LoadConfigError(configFile, [
      `Unable to load ${configFilePath}`,
      `default export does not exist or is null.`
    ]);
  }

  const errors: string[] = [];
  const config = normalizePublishContentConfig(configRaw, errors);
  if (config == null) {
    throw new LoadConfigError(configFile, errors);
  }

  return config;

}

const normalizeContentTypeDef = buildNormalizeFunctionForObject<ContentTypeDef>((config, errors): ContentTypeDef | null => {

  let { test, contentType, text } = config;

  if (typeof test === 'function' || test instanceof RegExp) {
    // ok
  } else {
    errors.push('test cannot be null.');
  }

  if (isStringAndNotEmpty(contentType)) {
    // ok
  } else {
    errors.push('contentType must be a non-empty string.');
  }

  if (!isSpecified(config, 'text')) {
    text = true;
  } else {
    if (typeof text === 'boolean') {
      // ok
    } else {
      errors.push('text, if specified, must be a boolean value.');
    }
  }

  if (errors.length > 0) {
    return null;
  }

  return {
    test,
    contentType,
    text,
  };

});

const normalizeContentTypeDefs = buildNormalizeFunctionForArray<ContentTypeDef>((config, errors) => {
  return normalizeContentTypeDef(config, errors);
});

export const normalizePublishContentConfig = buildNormalizeFunctionForObject<PublishContentConfigNormalized>((config, errors) => {

  let {
    rootDir,
    excludeDirs,
    excludeDotFiles,
    includeWellKnown,
    assetInclusionTest,
    kvStoreAssetInclusionTest,
    contentCompression,
    contentTypes,
    server,
  } = config;

  if (!isSpecified(config, 'rootDir')) {
    errors.push('rootDir must be specified.');
  } else {
    if (isStringAndNotEmpty(rootDir)) {
      // ok
    } else {
      errors.push('rootDir must be a non-empty string.');
    }
  }

  if (!isSpecified(config, 'excludeDotFiles')) {
    excludeDotFiles = true;
  } else {
    if (typeof excludeDotFiles === 'boolean') {
      // ok
    } else {
      errors.push('excludeDotFiles, if specified, must be a boolean value.');
    }
  }

  if (!isSpecified(config, 'includeWellKnown')) {
    includeWellKnown = true;
  } else {
    if (typeof includeWellKnown === 'boolean') {
      // ok
    } else {
      errors.push('includeWellKnown, if specified, must be a boolean value.');
    }
  }

  if (!isSpecified(config, 'excludeDirs')) {
    excludeDirs = [ './node_modules' ];
  } else {
    if (excludeDirs === null) {
      excludeDirs = [];
    }
  }

  if (!Array.isArray(excludeDirs)) {
    excludeDirs = [ excludeDirs ];
  }
  excludeDirs = excludeDirs.map((x: unknown) => {
    if (typeof x === 'string') {
      let testString = x;
      if (!testString.startsWith('/')) {
        if (testString.startsWith('./')) {
          testString = testString.slice(1);
        } else {
          testString = '/' + testString;
        }
      }
      if (testString.endsWith('/')) {
        testString = testString.slice(0, testString.length - 1);
      }
      return { test: (name: string) => name === testString, toString: () => testString };
    }
    if ((typeof x === 'object' || typeof x === 'function') && x != null) {
      if ('test' in x && typeof x.test === 'function') {
        return x;
      }
    }
    return null;
  });
  if (excludeDirs.some((x: unknown) => x == null)) {
    errors.push('excludeDirs, if specified, must be null, a string value, a RegExp, or an array of strings and RegExp values.');
  }

  if (!isSpecified(config, 'assetInclusionTest')) {
    if (!isSpecified(config, 'kvStoreAssetInclusionTest')) {
      assetInclusionTest = null;
    } else if (kvStoreAssetInclusionTest === null || typeof kvStoreAssetInclusionTest === 'function') {
      // ok
      assetInclusionTest = kvStoreAssetInclusionTest;
    } else {
      errors.push('assetInclusionTest, if specified, must be null or a function.');
    }
  } else if (assetInclusionTest === null || typeof assetInclusionTest === 'function') {
    // ok
    if (isSpecified(config, 'kvStoreAssetInclusionTest')) {
      errors.push('assetInclusionTest and kvStoreAssetInclusionTest must not both be specified.');
    }
  } else {
    errors.push('assetInclusionTest, if specified, must be null or a function.');
  }

  if (!isSpecified(config, 'contentCompression')) {
    contentCompression = ['br', 'gzip'];
  } else if (contentCompression === null) {
    contentCompression = []
  } else {
    if (!Array.isArray(contentCompression)) {
      contentCompression = [ contentCompression ];
    }
    if (contentCompression.some((x: any) => x !== 'br' && x !== 'gzip')) {
      errors.push(`contentCompression, if specified, must be null or an array and can only contain 'br' and 'gzip'.`);
    }
  }

  if (!isSpecified(config, 'contentTypes')) {
    contentTypes = [];
  } else {
    const innerErrors: string[] = [];
    let normalized;
    if (Array.isArray(contentTypes) && (normalized = normalizeContentTypeDefs(contentTypes, innerErrors))) {
      // ok
      contentTypes = normalized;
    } else if (contentTypes === null) {
      contentTypes = [];
    } else {
      errors.push('contentTypes, if specified, must be null or an array of content type definitions.');
      errors.push(...innerErrors);
    }
  }

  if (!isSpecified(config, 'server')) {
    server = null;
  } else {
    const innerErrors: string[] = [];
    let normalized;
    if ( (normalized = normalizePublisherServerConfig(server, innerErrors)) ) {
      // ok
      server = normalized;
    } else if (server === null) {
      // ok
    } else {
      errors.push('server, if specified, must be fit for server config.');
      errors.push(...innerErrors);
    }
  }

  if (errors.length > 0) {
    return null;
  }

  return {
    rootDir,
    excludeDirs,
    excludeDotFiles,
    includeWellKnown,
    assetInclusionTest,
    contentCompression,
    contentTypes,
    server,
  };
});

export const normalizePublisherServerConfig = buildNormalizeFunctionForObject<PublisherServerConfigNormalized>((config, errors) => {

  let {
    publicDirPrefix,
    staticItems,
    allowedEncodings,
    spaFile,
    notFoundPageFile,
    autoExt,
    autoIndex,
  } = config;

  if (!isSpecified(config, 'publicDirPrefix')) {
    publicDirPrefix = '';
  } else {
    if (typeof publicDirPrefix === 'string') {
      // ok
    } else {
      errors.push('publicDirPrefix, if specified, must be a string value.');
    }
  }

  if (!isSpecified(config, 'staticItems')) {
    staticItems = [];
  } else {
    if (staticItems === null || staticItems === false) {
      staticItems = [];
    }
    if (!Array.isArray(staticItems)) {
      staticItems = [ staticItems ];
    }
    if (staticItems.every((x: any) => typeof x === 'string')) {
      staticItems = (staticItems as string[]).map((x, index) => {
        if (x.includes('*')) {
          let re;
          try {
            const regexp = globToRegExp(x, {globstar: true});
            re = 're:' + String(regexp);
          } catch {
            errors.push(`staticItems item at index ${index}, '${x}', cannot be parsed as glob pattern.`);
            re = null;
          }
          return re;
        }
        return x;
      });
    } else {
      errors.push('staticItems, if specified, must be a string value, an array of string values, false, or null');
    }
  }

  if (!isSpecified(config, 'allowedEncodings')) {
    allowedEncodings = [ 'br', 'gzip' ];
  } else if (allowedEncodings === null) {
    allowedEncodings = []
  } else {
    if (!Array.isArray(allowedEncodings)) {
      allowedEncodings = [ allowedEncodings ];
    }
    if (allowedEncodings.some((x: any) => x !== 'br' && x !== 'gzip')) {
      errors.push(`allowedEncodings, if specified, must be null or an array and can only contain 'br' and 'gzip'.`);
    }
  }

  if (!isSpecified(config, 'spaFile')) {
    spaFile = null;
  } else {
    if (typeof spaFile === 'string' || spaFile === null) {
      // ok
    } else if (spaFile === false) {
      spaFile = null;
    } else {
      errors.push('spaFile, if specified, must be a string value, false, or null');
    }
  }

  if (!isSpecified(config, 'notFoundPageFile')) {
    notFoundPageFile = null;
  } else {
    if (typeof notFoundPageFile === 'string' || notFoundPageFile === null) {
      // ok
    } else if (notFoundPageFile === false) {
      notFoundPageFile = null;
    } else {
      errors.push('notFoundPageFile, if specified, must be a string value, false, or null');
    }
  }

  if (!isSpecified(config, 'autoExt')) {
    autoExt = [];
  } else {
    if (Array.isArray(autoExt) && autoExt.every(e => typeof e === 'string')) {
      // ok
    } else if (autoExt === false || autoExt === null) {
      autoExt = [];
    } else if (typeof autoExt === 'string') {
      autoExt = [ autoExt ];
    } else {
      errors.push('autoExt, if specified, must be an array of string values, a string value, false, or null');
    }
  }

  if (!isSpecified(config, 'autoIndex')) {
    autoIndex = [];
  } else {
    if (Array.isArray(autoIndex) && autoIndex.every(e => typeof e === 'string')) {
      // ok
    } else if (autoIndex === false || autoIndex === null) {
      autoIndex = [];
    } else if (typeof autoIndex === 'string') {
      autoIndex = [ autoIndex ];
    } else {
      errors.push('autoIndex, if specified, must be an array of string values, a string value, false, or null');
    }
  }

  if (errors.length > 0) {
    return null;
  }

  return {
    publicDirPrefix,
    staticItems,
    allowedEncodings,
    spaFile,
    notFoundPageFile,
    autoExt,
    autoIndex,
  };

});
