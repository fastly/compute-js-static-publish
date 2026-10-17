/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import globToRegExp from 'glob-to-regexp';

import {
  type StaticPublishRc,
  type StaticPublishPartialStorage,
  checkStaticPublisherWorkingDir,
  isKvStoreConfigRc,
  isS3StorageConfigRc,
} from '../../models/config/static-publish-rc.js';
import {
  type StaticPublishProjectManaged,
  PROJECT_FILE_NAME,
  RC_FILE_NAME,
} from '../../models/config/static-publish-project.js';
import { validateCollectionSelection } from '../../models/config/collection-selection.js';
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

// The mode of the current directory, from the names of the files in it.
export type ProjectMode = 'managed' | 'ejected' | 'scaffold' | 'conflict';

export function detectProjectMode(dir: string = '.'): ProjectMode {
  const hasProject = fs.existsSync(path.resolve(dir, PROJECT_FILE_NAME));
  const hasRc = fs.existsSync(path.resolve(dir, RC_FILE_NAME));
  if (hasProject && hasRc) {
    return 'conflict';
  }
  return hasProject ? 'managed' : hasRc ? 'ejected' : 'scaffold';
}

// The name of the config file of the current directory, for messages.
export function configFileName(): string {
  return detectProjectMode() === 'managed' ? PROJECT_FILE_NAME : RC_FILE_NAME;
}

export type StaticPublishProjectNormalized = {
  rc: StaticPublishRc,
  // The raw publishContent section. loadPublishContentConfig() normalizes it.
  publishContent: unknown,
  managed: StaticPublishProjectManaged,
};

async function importDefault(configFile: string) {
  const configFilePath = path.resolve(configFile);
  let configRaw;
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
  return configRaw;
}

export const normalizeProjectManaged = buildNormalizeFunctionForObject<StaticPublishProjectManaged>((config, errors) => {
  const { name, description, authors, serviceId, staticPublishVersion } = config as Record<string, unknown>;
  for (const [ key, value ] of Object.entries({ name, description, serviceId, staticPublishVersion })) {
    if (value !== undefined && typeof value !== 'string') {
      errors.push(`managed.${key}, if specified, must be a string.`);
    }
  }
  if (authors !== undefined && !(Array.isArray(authors) && authors.every(x => typeof x === 'string'))) {
    errors.push('managed.authors, if specified, must be an array of strings.');
  }
  if (errors.length > 0) {
    return null;
  }
  return { name, description, authors, serviceId, staticPublishVersion } as StaticPublishProjectManaged;
});

// Loads static-publish.project.js from the current directory (the project dir).
export async function loadProjectFile(): Promise<StaticPublishProjectNormalized> {
  const configFile = `./${PROJECT_FILE_NAME}`;
  const configRaw = await importDefault(configFile);

  const errors: string[] = [];
  const rc = normalizeStaticPublisherRc(configRaw, errors);
  if (!('publishContent' in configRaw) || configRaw.publishContent == null || typeof configRaw.publishContent !== 'object') {
    errors.push('publishContent must be specified.');
  }
  let managed: StaticPublishProjectManaged | null = {};
  if ('managed' in configRaw && configRaw.managed != null) {
    managed = normalizeProjectManaged(configRaw.managed, errors);
  }
  if (rc == null || managed == null || errors.length > 0) {
    throw new LoadConfigError(configFile, errors);
  }
  return { rc, publishContent: configRaw.publishContent, managed };
}

// Loads the settings of the app: static-publish.rc.js in an ejected app, or the
// top level of static-publish.project.js in a managed project.
export async function loadStaticPublisherRcFile(): Promise<StaticPublishRc> {

  if (detectProjectMode() === 'managed') {
    return (await loadProjectFile()).rc;
  }

  let configRaw;

  const configFile = `./${RC_FILE_NAME}`;

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
    collectionSelection,
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
    const workingDirError = checkStaticPublisherWorkingDir(staticPublisherWorkingDir);
    if (workingDirError != null) {
      // The caller uses the result even if there are errors. Thus return null,
      // so that publish-content never writes into a directory that breaks the rule.
      errors.push(workingDirError);
      return null;
    }

    while (staticPublisherWorkingDir.endsWith('/')) {
      staticPublisherWorkingDir = staticPublisherWorkingDir.slice(0, -1);
    }
  }

  if (isSpecified(config, 'collectionSelection') && collectionSelection != null) {
    // The caller uses the result even if there are errors. Thus return null, so
    // that a collectionSelection that is not valid stops the command.
    const collectionSelectionErrors = validateCollectionSelection(collectionSelection);
    if (collectionSelectionErrors.length > 0) {
      errors.push(...collectionSelectionErrors);
      return null;
    }
  } else {
    collectionSelection = undefined;
  }

  return Object.assign({},
    storage,
    {
      publishId,
      defaultCollectionName,
      staticPublisherWorkingDir,
    },
    collectionSelection != null ? { collectionSelection } : {},
  );
});

// Loads the publish settings: the file of --config if given, else the
// publishContent section of static-publish.project.js in a managed project,
// else ./publish-content.config.js.
export async function loadPublishContentConfig(configFile: string | undefined): Promise<PublishContentConfigNormalized> {
  if (configFile == null && detectProjectMode() === 'managed') {
    const project = await loadProjectFile();
    const errors: string[] = [];
    const config = normalizePublishContentConfig(project.publishContent, errors);
    if (config == null || errors.length > 0) {
      throw new LoadConfigError(`./${PROJECT_FILE_NAME} (publishContent)`, errors);
    }
    return config;
  }
  return loadPublishContentConfigFile(configFile ?? './publish-content.config.js');
}

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

// staticItems and hiddenItems: a string, an array of strings, false, or null.
// Glob patterns become 're:' items. See models/config/item-patterns.ts.
function normalizeItemList(name: string, value: unknown, errors: string[]): string[] {
  if (value === null || value === false) {
    value = [];
  }
  if (!Array.isArray(value)) {
    value = [ value ];
  }
  const items = value as unknown[];
  if (!items.every((x) => typeof x === 'string')) {
    errors.push(`${name}, if specified, must be a string value, an array of string values, false, or null`);
    return [];
  }
  return (items as string[]).map((x, index) => {
    if (x.includes('*')) {
      try {
        const regexp = globToRegExp(x, {globstar: true});
        return 're:' + String(regexp);
      } catch {
        errors.push(`${name} item at index ${index}, '${x}', cannot be parsed as glob pattern.`);
        return '';
      }
    }
    return x;
  });
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
    hiddenItems,
    contentCompression,
    brotliQuality,
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

  if (!isSpecified(config, 'hiddenItems')) {
    hiddenItems = [];
  } else {
    hiddenItems = normalizeItemList('hiddenItems', hiddenItems, errors);
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

  if (!isSpecified(config, 'brotliQuality') || brotliQuality === null) {
    brotliQuality = undefined;
  } else if (!Number.isInteger(brotliQuality) || brotliQuality < 0 || brotliQuality > 11) {
    errors.push('brotliQuality, if specified, must be an integer from 0 to 11.');
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
    hiddenItems,
    contentCompression,
    brotliQuality,
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
    staticItems = normalizeItemList('staticItems', staticItems, errors);
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
