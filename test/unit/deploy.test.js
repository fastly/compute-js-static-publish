/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { generateApp } from '../../build/cli/cli/commands/scaffold/generate-app.js';
import { appTemplates } from '../../build/cli/cli/commands/scaffold/templates/index.js';
import {
  computeFingerprint,
  formatVersionComment,
  managedAppFiles,
  parseVersionComment,
} from '../../build/cli/cli/managed/fingerprint.js';
import { writeBackServiceId, writeBackStaticPublishVersion } from '../../build/cli/cli/managed/project-edit.js';
import { renderProjectFile } from '../../build/cli/cli/managed/project-file.js';
import { checkProjectVersion, compareVersions, versionCheckError } from '../../build/cli/cli/managed/version-check.js';
import { previewUrlTemplates } from '../../build/cli/models/config/collection-selection.js';

const CLI_DIR = '/home/me/project/node_modules/@fastly/compute-js-static-publish';

const base = {
  appDir: '/home/me/project/.static-publish/app',
  name: 'site',
  author: 'me@example.com',
  description: 'Site',
  serviceId: undefined,
  storage: { mode: 'kv-store', kvStoreName: 'content' },
  publishId: 'default',
  defaultCollectionName: 'live',
  staticPublisherWorkingDir: '/home/me/project/static-publisher',
  rootDir: '/home/me/project/public',
  publicDir: '/home/me/project/public',
  staticDirs: [],
  spaFilename: undefined,
  notFoundPageFilename: '/home/me/project/public/404.html',
  autoIndex: [ 'index.html' ],
  autoExt: [ '.html' ],
  staticPublishVersionSpec: `file:${CLI_DIR}`,
  template: appTemplates.plain,
  generatedFrom: undefined,
  packageLock: JSON.stringify({ packages: { '../../node_modules/@fastly/compute-js-static-publish': { version: '8.1.0' } } }),
};

function fingerprintOf(config, { version = '8.1.0', cliDir = CLI_DIR } = {}) {
  return computeFingerprint(managedAppFiles(generateApp(config)), {
    staticPublishVersion: version,
    template: 'plain',
    machinePaths: [ cliDir, '../../node_modules/@fastly/compute-js-static-publish' ],
  });
}

describe('fingerprint', () => {
  const fp = fingerprintOf(base);

  test('is a SHA-256', () => {
    assert.match(fp, /^[0-9a-f]{64}$/);
  });

  test('changes for each input', () => {
    const changes = {
      'the version of this package': () => fingerprintOf(base, { version: '8.2.0' }),
      'the storage': () => fingerprintOf({ ...base, storage: { mode: 'kv-store', kvStoreName: 'other' } }),
      'the publish ID': () => fingerprintOf({ ...base, publishId: 'p2' }),
      'the default collection': () => fingerprintOf({ ...base, defaultCollectionName: 'main' }),
      'the name of the app': () => fingerprintOf({ ...base, name: 'other' }),
      'collection selection': () => fingerprintOf({ ...base, collectionSelection: { sources: [ { type: 'cookie' } ] } }),
      'the lockfile': () => fingerprintOf({ ...base, packageLock: '{}' }),
    };
    for (const [ name, fn ] of Object.entries(changes)) {
      assert.notEqual(fn(), fp, name);
    }
  });

  test('does not change for the service ID, generatedFrom, publishContent, or the path of the CLI', () => {
    assert.equal(fingerprintOf({ ...base, serviceId: 'SVC123' }), fp, 'service ID');
    assert.equal(fingerprintOf({ ...base, generatedFrom: { template: 'plain', staticPublishVersion: '8.1.0', generatedAt: '2026-10-18' } }), fp, 'generatedFrom');
    assert.equal(fingerprintOf({ ...base, spaFilename: '/home/me/project/public/index.html', autoExt: [] }), fp, 'publishContent settings');
    const otherMachine = {
      ...base,
      staticPublishVersionSpec: 'file:/Users/other/x/node_modules/@fastly/compute-js-static-publish',
    };
    assert.equal(fingerprintOf(otherMachine, { cliDir: '/Users/other/x/node_modules/@fastly/compute-js-static-publish' }), fp, 'CLI path');
  });

  test('the managed app has no publish-content.config.js', () => {
    assert.equal(managedAppFiles(generateApp(base))['publish-content.config.js'], undefined);
  });
});

describe('version comment', () => {
  const fp = 'a'.repeat(64);

  test('format and parse', () => {
    assert.equal(formatVersionComment('8.1.0', fp), `static-publish 8.1.0 fp:${fp}`);
    assert.equal(formatVersionComment('8.1.0', fp, ' abc123 '), `static-publish 8.1.0 fp:${fp} | abc123`);
    assert.deepEqual(parseVersionComment(formatVersionComment('8.1.0-beta.1', fp, 'x')), { staticPublishVersion: '8.1.0-beta.1', fingerprint: fp });
  });

  test('a comment without a fingerprint', () => {
    assert.equal(parseVersionComment(''), null);
    assert.equal(parseVersionComment(null), null);
    assert.equal(parseVersionComment('deployed by hand'), null);
    assert.equal(parseVersionComment(`static-publish 8.1.0 fp:${'a'.repeat(63)}`), null);
  });
});

describe('version check', () => {
  test('compareVersions', () => {
    assert.equal(compareVersions('8.1.0', '8.1.0'), 0);
    assert.equal(compareVersions('8.2.0', '8.1.9'), 1);
    assert.equal(compareVersions('8.1.0', '8.10.0'), -1);
    assert.equal(compareVersions('8.1.0', '8.1.0-rc.1'), 1);
    assert.equal(compareVersions('8.1.0-beta.2', '8.1.0-beta.10'), -1);
    assert.equal(compareVersions('8.1.0-beta.1', '8.1.0-rc.1'), -1);
    assert.equal(compareVersions('8.1.0-1', '8.1.0-beta'), -1);
    assert.equal(compareVersions('x', '8.1.0'), null);
  });

  test('the same version: continue', () => {
    const check = checkProjectVersion('8.1.0', '8.1.0');
    assert.equal(check.result, 'same');
    assert.equal(versionCheckError(check, false), null);
  });

  test('a newer CLI: stop, unless --auto-upgrade', () => {
    const check = checkProjectVersion('8.1.0', '8.2.0');
    assert.equal(check.result, 'newer-cli');
    assert.match(versionCheckError(check, false), /This project uses 8\.1\.0.*You are running 8\.2\.0.*Run 'upgrade'.*--auto-upgrade/);
    assert.equal(versionCheckError(check, true), null);
  });

  test('an older CLI: always stop', () => {
    const check = checkProjectVersion('8.2.0', '8.1.0');
    assert.equal(check.result, 'older-cli');
    assert.match(versionCheckError(check, false), /8\.2\.0 or later/);
    assert.match(versionCheckError(check, true), /8\.2\.0 or later/);
  });

  test('missing or not a version: stop', () => {
    assert.match(versionCheckError(checkProjectVersion(undefined, '8.1.0'), true), /missing.*Run 'upgrade'/);
    assert.match(versionCheckError(checkProjectVersion('latest', '8.1.0'), true), /not a version/);
  });
});

describe('write-back into the project file', () => {
  const text = renderProjectFile({ ...base, appDir: '/home/me/project/.static-publish/app' }, '/home/me/project', '8.1.0');

  test('the service ID replaces the marked line', () => {
    const updated = writeBackServiceId(text, 'SVC123');
    assert.match(updated, /^ {4}serviceId: "SVC123",$/m);
    assert.equal(updated.replace('    serviceId: "SVC123",', '    serviceId: undefined,'), text, 'only that line changes');
  });

  test('no marked line: no change', () => {
    assert.equal(writeBackServiceId(text.replace('    serviceId: undefined,', '    serviceId: process.env.SVC,'), 'SVC123'), null);
    assert.equal(writeBackServiceId(writeBackServiceId(text, 'A'), 'B'), null, 'already set');
  });

  test('the version replaces its line', () => {
    const updated = writeBackStaticPublishVersion(text, '8.2.0');
    assert.match(updated, /^ {4}staticPublishVersion: "8\.2\.0",$/m);
    assert.equal(updated.replace('"8.2.0"', '"8.1.0"'), text);
  });

  test('a missing version line is added to the managed section', () => {
    const without = text.replace(/^ {4}staticPublishVersion: .*\n/m, '');
    const updated = writeBackStaticPublishVersion(without, '8.2.0');
    assert.match(updated, /^ {2}managed: \{\n {4}staticPublishVersion: "8\.2\.0",$/m);
  });

  test('a version line that is not a string: no change', () => {
    const changed = text.replace(/^ {4}staticPublishVersion: .*$/m, '    staticPublishVersion: VERSION,');
    assert.equal(writeBackStaticPublishVersion(changed, '8.2.0'), null);
  });
});

describe('previewUrlTemplates', () => {
  test('one template for each source that can make a URL', () => {
    const config = {
      sources: [
        { type: 'host', pattern: '{collection}.preview.example.com' },
        { type: 'path', prefix: '/_preview/{collection}' },
        { type: 'query', param: 'collection' },
        { type: 'cookie' },
        { type: 'header', name: 'x-c' },
      ],
    };
    assert.deepEqual(previewUrlTemplates('https://site.edgecompute.app/', config), [
      { type: 'host', url: 'https://{collection}.preview.example.com/' },
      { type: 'path', url: 'https://site.edgecompute.app/_preview/{collection}/' },
      { type: 'query', url: 'https://site.edgecompute.app/?collection={collection}' },
      { type: 'cookie', url: 'https://site.edgecompute.app/activate?collection={collection}&redirectTo=%2F' },
    ]);
  });
});
