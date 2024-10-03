import url from "url";
import path from "path";
import globToRegExp from 'glob-to-regexp';

import {
  buildNormalizeFunctionForArray,
  buildNormalizeFunctionForObject,
  isSpecified,
  isStringAndNotEmpty,
} from "./util/data.js";

import type {
  ContentTypeDef,
} from "../types/content-types.js";
import type {
  StaticPublisherConfigNormalized,
  PublisherServerConfigNormalized,
} from "../types/config-normalized.js";

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

const normalizePublisherServerConfig = buildNormalizeFunctionForObject<PublisherServerConfigNormalized>((config, errors) => {

  let { publicDirPrefix, staticItems, compression, spaFile, notFoundPageFile, autoExt, autoIndex } = config;

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

  if (!isSpecified(config, 'compression')) {
    compression = [ 'br', 'gzip' ];
  } else if (compression === null) {
    compression = []
  } else {
    if (!Array.isArray(compression)) {
      compression = [ compression ];
    }
    if (compression.some((x: any) => x !== 'br' && x !== 'gzip')) {
      errors.push(`compression, if specified, must be null or an array and can only contain 'br' and 'gzip'.`);
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
    compression,
    spaFile,
    notFoundPageFile,
    autoExt,
    autoIndex,
  };

});

const normalizeConfig = buildNormalizeFunctionForObject<StaticPublisherConfigNormalized>((config, errors) => {

  let {
    rootDir,
    staticContentRootDir,
    kvStoreName,
    excludeDirs,
    excludeDotFiles,
    includeWellKnown,
    contentAssetInclusionTest,
    contentCompression,
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

  if (!isSpecified(config, 'staticContentRootDir')) {
    staticContentRootDir = './src';
  } else {
    if (
      staticContentRootDir.startsWith('./') &&
      staticContentRootDir !== './' &&
      !staticContentRootDir.includes('//')
    ) {
      // ok
    } else {
      errors.push('staticContentRootDir must be a relative subdirectory.');
    }

    while (staticContentRootDir.endsWith('/')) {
      staticContentRootDir = staticContentRootDir.slice(0, -1);
    }
  }

  if (!isSpecified(config, 'kvStoreName')) {
    kvStoreName = null;
  } else {
    if (isStringAndNotEmpty(kvStoreName) || kvStoreName === null) {
      // ok
    } else if (kvStoreName === false) {
      kvStoreName = null;
    } else {
      errors.push('kvStoreName, if specified, must be a non-empty string, false, or null.');
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

  if (!isSpecified(config, 'contentAssetInclusionTest')) {
    contentAssetInclusionTest = null;
  } else if (contentAssetInclusionTest === null || typeof contentAssetInclusionTest === 'function') {
    // ok
  } else {
    errors.push('contentAssetInclusionTest, if specified, must be null or a function.');
  }

  if (!isSpecified(config, 'contentCompression')) {
    if (kvStoreName != null) {
      contentCompression = ['br', 'gzip'];
    } else {
      contentCompression = [];
    }
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
    staticContentRootDir,
    kvStoreName,
    excludeDotFiles,
    includeWellKnown,
    excludeDirs,
    contentAssetInclusionTest,
    contentCompression,
    moduleAssetInclusionTest,
    contentTypes,
    server,
  };
});

export async function loadConfigFile(errors: string[] = []): Promise<{normalized: StaticPublisherConfigNormalized | null, raw: any}> {

  let raw: any = undefined;
  const staticPublishRcPath = path.resolve('./static-publish.rc.js');
  const staticPublishRcFileURL = String(url.pathToFileURL(staticPublishRcPath));
  try {
    raw = (await import(staticPublishRcFileURL)).default;
  } catch {
    errors.push('Unable to load ' + staticPublishRcFileURL);
  }

  let normalized: any = undefined;
  if (raw != null) {
    normalized = normalizeConfig(raw, errors);
  }

  return { normalized: normalized ?? null, raw };

}
