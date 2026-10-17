/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { appTemplates } from '../../build/cli/cli/commands/scaffold/templates/index.js';
import {
  findNonDataPaths,
  isScaffoldedPublishContent,
  renderPublishContentConfig,
} from '../../build/cli/cli/managed/eject.js';
import { renderProjectFile } from '../../build/cli/cli/managed/project-file.js';

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
async function importText(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cjsp-unit-eject-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'x.js');
  fs.writeFileSync(file, text);
  return (await import(pathToFileURL(file).href)).default;
}

const config = {
  appDir: '/project/.static-publish/app',
  name: 'site',
  author: 'me@example.com',
  description: 'Site',
  serviceId: undefined,
  storage: { mode: 'kv-store', kvStoreName: 'content' },
  publishId: 'default',
  defaultCollectionName: 'live',
  staticPublisherWorkingDir: '/project/static-publisher',
  rootDir: '/project/public',
  publicDir: '/project/public',
  staticDirs: [ '/project/public/static' ],
  spaFilename: undefined,
  notFoundPageFilename: '/project/public/404.html',
  autoIndex: [ 'index.html' ],
  autoExt: [ '.html' ],
  staticPublishVersionSpec: 'x',
  template: appTemplates.plain,
  generatedFrom: undefined,
};

describe('findNonDataPaths', () => {
  test('data', () => {
    assert.deepEqual(findNonDataPaths({ rootDir: './public', server: { autoExt: [ '.html' ], spaFile: false, x: null } }), []);
  });

  test('functions and regular expressions', () => {
    assert.deepEqual(findNonDataPaths({
      assetInclusionTest: () => true,
      contentTypes: [ { test: /\.x$/, contentType: 'a/b' } ],
      excludeDirs: [ 'ok', { test: () => false } ],
    }), [ 'assetInclusionTest', 'contentTypes[0].test', 'excludeDirs[1].test' ]);
  });
});

describe('isScaffoldedPublishContent', () => {
  test('the section that scaffold --managed writes', async () => {
    const project = await importText(renderProjectFile(config, '/project', '8.1.0'));
    assert.equal(isScaffoldedPublishContent(project.publishContent, config, '/project'), true);
  });

  test('a section that the user changed', async () => {
    const project = await importText(renderProjectFile(config, '/project', '8.1.0'));
    assert.equal(isScaffoldedPublishContent({ ...project.publishContent, hiddenItems: [ '/404.html' ] }, config, '/project'), false);
    assert.equal(isScaffoldedPublishContent({ ...project.publishContent, server: { ...project.publishContent.server, autoExt: [] } }, config, '/project'), false);
  });
});

describe('renderPublishContentConfig', () => {
  test('writes the data, with rootDir relative to the new directory', async () => {
    const raw = { rootDir: './public', hiddenItems: [ '/404.html' ], server: { notFoundPageFile: '/404.html' } };
    const text = renderPublishContentConfig(raw, '/project', '/project/compute-js');
    assert.deepEqual(await importText(text), { rootDir: '../public', hiddenItems: [ '/404.html' ], server: { notFoundPageFile: '/404.html' } });
  });
});
