import path from "path";

import {
  buildNormalizeFunctionForArray,
  buildNormalizeFunctionForObject,
  isSpecified,
  isStringAndNotEmpty,
} from "./util/data.js";

import type {
  ContentTypeDef,
} from "./types/content-types.js";
import type {
  StaticPublisherConfigNormalized,
  PublisherServerConfigNormalized,
} from "./types/config-normalized.js";

const normalizeContentTypeDef = buildNormalizeFunctionForObject<ContentTypeDef>((config, errors) => {

  let { test, type, binary } = config;

  if (typeof test === 'function' || test instanceof RegExp) {
    // ok
  } else {
    errors.push('test cannot be null.');
  }

  if (isStringAndNotEmpty(type)) {
    // ok
  } else {
    errors.push('type must be a non-empty string.');
  }

  if (!isSpecified(config, 'binary')) {
    binary = false;
  } else {
    if (typeof binary === 'boolean') {
      // ok
    } else {
      errors.push('binary, if specified, must be a boolean value.');
    }
  }

  if (errors.length > 0) {
    return null;
  }

  return {
    test,
    contentType: type,
    binary,
  };

});

const normalizeContentTypeDefs = buildNormalizeFunctionForArray<ContentTypeDef>((config, errors) => {
  return normalizeContentTypeDef(config, errors);
});

const normalizePublisherServerConfig = buildNormalizeFunctionForObject<PublisherServerConfigNormalized>((config, errors) => {

  let { publicDirPrefix, spaFile, notFoundPageFile, autoExt, autoIndex } = config;

  if (!isSpecified(config, 'publicDirPrefix')) {
    publicDirPrefix = '';
  } else {
    if (typeof publicDirPrefix === 'string') {
      // ok
    } else {
      errors.push('publicDirPrefix, if specified, must be a string value.');
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
    spaFile,
    notFoundPageFile,
    autoExt,
    autoIndex,
  };

});

const normalizeConfig = buildNormalizeFunctionForObject<StaticPublisherConfigNormalized>((config, errors) => {

  let {
    rootDir,
    objectStore,
    excludeDirs,
    excludeDotFiles,
    includeWellKnown,
    contentAssetInclusionTest,
    moduleAssetInclusionTest,
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

  if (!isSpecified(config, 'objectStore')) {
    objectStore = null;
  } else {
    if (isStringAndNotEmpty(objectStore) || objectStore === null) {
      // ok
    } else if (objectStore === false) {
      objectStore = null;
    } else {
      errors.push('objectStore, if specified, must be a non-empty string, false, or null.');
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
    excludeDirs = [ 'node_modules' ];
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
      return (name: string) => name === x;
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

  if (!isSpecified(config, 'contentAssetInclusionTest')) {
    contentAssetInclusionTest = null;
  } else if (contentAssetInclusionTest === null || typeof contentAssetInclusionTest === 'function') {
    // ok
  } else {
    errors.push('contentAssetInclusionTest, if specified, must be null or a function.');
  }

  if (!isSpecified(config, 'moduleAssetInclusionTest')) {
    moduleAssetInclusionTest = null;
  } else if (moduleAssetInclusionTest === null || typeof moduleAssetInclusionTest === 'function') {
    // ok
  } else {
    errors.push('moduleAssetInclusionTest, if specified, must be null or a function.');
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
      console.log({normalized});
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
    objectStore,
    excludeDotFiles,
    includeWellKnown,
    excludeDirs,
    contentAssetInclusionTest,
    moduleAssetInclusionTest,
    contentTypes,
    server,
  };
});

export async function loadConfigFile(errors: string[] = []): Promise<StaticPublisherConfigNormalized | null> {

  let config: any = undefined;
  const staticPublishRcPath = path.resolve('./static-publish.rc.js');
  try {
    config = (await import(staticPublishRcPath)).default;
  } catch {
    errors.push('Unable to load ' + staticPublishRcPath);
  }

  if (config != null) {
    config = normalizeConfig(config, errors);
  }

  return config ?? null;

}
