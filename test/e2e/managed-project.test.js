/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Scaffolds a managed project (static-publish.project.js), and runs the
// commands from the project dir. No network and no credentials are necessary.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { makeTempDir, removeDir, runCli, writeFixtureContent } from './helpers.js';

describe('managed project', () => {
  let dir;
  let projectDir;
  let scaffoldOutput;

  before(() => {
    dir = makeTempDir('managed');
    projectDir = path.resolve(dir, 'site');
    writeFixtureContent(path.resolve(projectDir, 'public'));
    fs.writeFileSync(path.resolve(projectDir, '.gitignore'), 'node_modules\n');
    ({ output: scaffoldOutput } = runCli([ '--managed', '--root-dir', './public', '--kv-store-name', 'e2e-content' ], { cwd: projectDir }));
  });

  after(() => {
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('scaffold --managed writes only the project file and .gitignore lines', () => {
    assert.deepEqual(fs.readdirSync(projectDir).sort(), [ '.gitignore', 'public', 'static-publish.project.js' ]);
    assert.equal(fs.readFileSync(path.resolve(projectDir, '.gitignore'), 'utf-8'),
      'node_modules\n\n# @fastly/compute-js-static-publish\n/.static-publish/\n/static-publisher/\n');
    assert.match(scaffoldOutput, /Added to \.gitignore: \/\.static-publish\/, \/static-publisher\//);
  });

  test('the project file has the sections', () => {
    const text = fs.readFileSync(path.resolve(projectDir, 'static-publish.project.js'), 'utf-8');
    assert.match(text, /staticPublisherWorkingDir: "\.\/static-publisher"/);
    assert.match(text, /publishContent: \{\n {4}rootDir: "\.\/public"/);
    assert.match(text, /^ {4}serviceId: undefined,$/m);
    assert.match(text, /staticPublishVersion: "\d+\.\d+\.\d+/);
  });

  test('publish-content runs from the project dir, with the working dir beside the project file', () => {
    const json = JSON.parse(runCli([ 'publish-content', '--local', '--json' ], { cwd: projectDir }).stdout);
    assert.equal(json.collection, 'live');
    assert.equal(json.files.total, 12);
    assert.ok(fs.existsSync(path.resolve(projectDir, 'static-publisher/kvstore.json')));
    assert.ok(!fs.existsSync(path.resolve(projectDir, '.static-publish')), 'publishing does not need a generated app');
  });

  test('the banner says that it is a managed project', () => {
    const { output } = runCli([ 'collections', 'list', '--local' ], { cwd: projectDir });
    assert.match(output, /Management mode, managed project/);
    assert.match(output, /live \*DEFAULT\*/);
  });

  test('--project-dir from another directory', () => {
    const { stdout } = runCli([ 'collections', 'list', '--local', '--json', '--project-dir', 'site' ], { cwd: dir });
    assert.equal(JSON.parse(stdout).collections[0].name, 'live');
  });

  test('--config replaces publishContent for one run', () => {
    fs.mkdirSync(path.resolve(projectDir, 'other'));
    fs.writeFileSync(path.resolve(projectDir, 'other/only.html'), '<h1>Only</h1>');
    fs.writeFileSync(path.resolve(projectDir, 'other.config.js'), `export default { rootDir: './other' };\n`);
    const { stdout } = runCli([ 'publish-content', '--local', '--json', '--config', './other.config.js', '--collection-name', 'other' ], { cwd: projectDir });
    assert.equal(JSON.parse(stdout).files.total, 1);
  });

  test('a project file and an rc in one directory is an error', () => {
    const conflictDir = makeTempDir('managed-conflict');
    try {
      fs.writeFileSync(path.resolve(conflictDir, 'static-publish.project.js'), 'export default {};');
      fs.writeFileSync(path.resolve(conflictDir, 'static-publish.rc.js'), 'export default {};');
      const result = runCli([ 'collections', 'list', '--json' ], { cwd: conflictDir, allowFailure: true });
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).error.code, 'config-invalid');
      assert.match(result.output, /both static-publish\.project\.js .* and static-publish\.rc\.js/);
    } finally {
      removeDir(conflictDir);
    }
  });

  test('a project file without publishContent is an error', () => {
    const badDir = makeTempDir('managed-bad');
    try {
      fs.writeFileSync(path.resolve(badDir, 'static-publish.project.js'),
        `export default { kvStoreName: 'x', publishId: 'default', defaultCollectionName: 'live', staticPublisherWorkingDir: './static-publisher' };`);
      const result = runCli([ 'publish-content', '--local', '--json' ], { cwd: badDir, allowFailure: true });
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).error.code, 'config-invalid');
      assert.match(result.output, /publishContent must be specified/);
    } finally {
      removeDir(badDir);
    }
  });

  test('a working dir that is the project dir is an error', () => {
    const badDir = makeTempDir('managed-working-dir');
    try {
      fs.writeFileSync(path.resolve(badDir, 'static-publish.project.js'),
        `export default { kvStoreName: 'x', publishId: 'default', defaultCollectionName: 'live', staticPublisherWorkingDir: './', publishContent: { rootDir: './public' } };`);
      const result = runCli([ 'collections', 'list', '--local', '--json' ], { cwd: badDir, allowFailure: true });
      assert.equal(result.status, 2);
      assert.match(result.output, /staticPublisherWorkingDir must be a relative path/);
    } finally {
      removeDir(badDir);
    }
  });
});
