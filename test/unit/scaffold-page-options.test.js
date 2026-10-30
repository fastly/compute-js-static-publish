/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Checks the scaffolder's errors for --spa and --not-found-page values that it
// cannot use. The scaffolder stops before it writes the app, so these tests do
// not run npm install.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, describe, test } from 'node:test';

import { action } from '../../build/cli/cli/commands/scaffold/index.js';
import { mockConsoleError, mockConsoleLog } from './mock-console.js';

describe('scaffold --spa and --not-found-page', () => {
  const savedCwd = process.cwd();
  let dir;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cjsp-scaffold-'));
    fs.mkdirSync(path.resolve(dir, 'public'));
    fs.writeFileSync(path.resolve(dir, 'public/index.html'), '<h1>Home</h1>');
    fs.writeFileSync(path.resolve(dir, 'public/404.html'), '<h1>Not found</h1>');
    process.chdir(dir);
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  after(() => {
    process.chdir(savedCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function scaffold(t, args) {
    mockConsoleLog(t);
    const errors = mockConsoleError(t);
    await action([ '--root-dir=./public', '--kv-store-name=site-content', ...args ]);
    return errors();
  }

  test('stops if --not-found-page is not under --root-dir', async (t) => {
    const errors = await scaffold(t, [ '--not-found-page=/404.html' ]);
    assert.equal(process.exitCode, 1);
    assert.match(errors.join('\n'), /Not Found file '\/404\.html' is not under the asset root directory/);
    assert.match(errors.join('\n'), /for example \.\/public\/404\.html/);
    assert.equal(fs.existsSync(path.resolve(dir, 'compute-js')), false);
  });

  test('stops if --not-found-page does not exist', async (t) => {
    const errors = await scaffold(t, [ '--not-found-page=./public/missing.html' ]);
    assert.equal(process.exitCode, 1);
    assert.match(errors.join('\n'), /Not Found file '\.\/public\/missing\.html' does not exist/);
    assert.equal(fs.existsSync(path.resolve(dir, 'compute-js')), false);
  });

  test('stops if --spa is not under --root-dir', async (t) => {
    const errors = await scaffold(t, [ '--spa=/index.html' ]);
    assert.equal(process.exitCode, 1);
    assert.match(errors.join('\n'), /SPA file '\/index\.html' is not under the asset root directory/);
    assert.match(errors.join('\n'), /for example \.\/public\/index\.html/);
    assert.equal(fs.existsSync(path.resolve(dir, 'compute-js')), false);
  });

  test('stops if --spa does not exist', async (t) => {
    const errors = await scaffold(t, [ '--spa=./public/spa.html' ]);
    assert.equal(process.exitCode, 1);
    assert.match(errors.join('\n'), /SPA file '\.\/public\/spa\.html' does not exist/);
    assert.equal(fs.existsSync(path.resolve(dir, 'compute-js')), false);
  });
});
