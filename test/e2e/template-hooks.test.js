/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Checks the template hooks: `run-template-hook`, and the npm scripts of a
// scaffolded app that call it. Needs network access for `npm install`. No
// credentials are necessary.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { makeTempDir, removeDir, run, runCli, scaffoldApp, writeFixtureContent } from './helpers.js';

// A hook file that writes a marker file, so that a test can see that it ran.
function writeHook(dir, name, body = '') {
  fs.mkdirSync(path.resolve(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.resolve(dir, `scripts/template_${name}.js`),
    `import fs from 'node:fs';\nfs.writeFileSync('ran-${name}', 'yes');\n${body}`);
}

describe('run-template-hook', () => {
  let dir;

  before(() => {
    dir = makeTempDir('template-hooks');
    fs.writeFileSync(path.resolve(dir, 'package.json'), JSON.stringify({ type: 'module' }));
  });

  after(() => {
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('does nothing if the app has no hook file', () => {
    const result = runCli([ 'run-template-hook', 'prebuild' ], { cwd: dir });
    assert.equal(result.status, 0);
    assert.equal(result.output, '', 'no banner and no output');
  });

  test('runs the hook file', () => {
    writeHook(dir, 'postbuild');
    const result = runCli([ 'run-template-hook', 'postbuild' ], { cwd: dir });
    assert.equal(result.status, 0);
    assert.equal(fs.readFileSync(path.resolve(dir, 'ran-postbuild'), 'utf-8'), 'yes');
  });

  test('a failing hook fails the command with its exit code', () => {
    writeHook(dir, 'postinstall', 'process.exit(3);\n');
    const result = runCli([ 'run-template-hook', 'postinstall' ], { cwd: dir, allowFailure: true });
    assert.equal(result.status, 3);
  });

  test('refuses an unknown hook name', () => {
    const result = runCli([ 'run-template-hook', 'preinstall' ], { cwd: dir, allowFailure: true });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /must be one of: prebuild, postbuild, postinstall/);
  });
});

describe('template hooks in a scaffolded app', () => {
  let dir;
  let computeJsDir;

  before(() => {
    dir = makeTempDir('template-hooks-app');
    writeFixtureContent(path.resolve(dir, 'public'));
    computeJsDir = scaffoldApp(dir, [ '--kv-store-name', 'e2e-content' ]);
  });

  after(() => {
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('npm run build runs the prebuild and postbuild hooks', () => {
    writeHook(computeJsDir, 'prebuild');
    writeHook(computeJsDir, 'postbuild');
    run('npm', [ 'run', 'build' ], { cwd: computeJsDir });
    assert.equal(fs.existsSync(path.resolve(computeJsDir, 'ran-prebuild')), true, 'prebuild ran');
    assert.equal(fs.existsSync(path.resolve(computeJsDir, 'ran-postbuild')), true, 'postbuild ran');
    assert.equal(fs.existsSync(path.resolve(computeJsDir, 'bin/main.wasm')), true, 'the app was built');
  });

  test('npm install runs the postinstall hook', () => {
    writeHook(computeJsDir, 'postinstall');
    run('npm', [ 'install', '--no-audit', '--no-fund' ], { cwd: computeJsDir });
    assert.equal(fs.existsSync(path.resolve(computeJsDir, 'ran-postinstall')), true, 'postinstall ran');
  });
});
