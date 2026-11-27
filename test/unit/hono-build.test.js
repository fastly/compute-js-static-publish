/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, mock, test } from 'node:test';

import * as esbuild from 'esbuild';

import {
  PLUGINS_MANIFEST,
  bundleHonoExtensions,
  bundlePlugins,
  checkProvidedVersions,
  pluginsExternals,
  comparePluginFiles,
  listPlugins,
  watchHonoExtensions,
  watchPlugins,
  writeHonoExtensionsStub,
  writePluginsStub,
} from '../../build/cli/cli/hono/build.js';

// The build writes its messages with console.log(). The test runner reads the
// stdout of this file as its own messages, and in Node 22 some text there can
// stop the runner with 'Unable to deserialize cloned data'. Thus the messages
// are caught for all the tests of this file.
before(() => {
  mock.method(console, 'log', () => {});
});
after(() => {
  mock.restoreAll();
});

const tempDirs = [];
function makeDir(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cjsp-hono-build-'));
  tempDirs.push(dir);
  for (const [ file, content ] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.resolve(dir, file)), { recursive: true });
    fs.writeFileSync(path.resolve(dir, file), content);
  }
  return dir;
}
after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// An app dir with the given dependencies, and an rc.
function makeApp(dependencies, rc = 'export default {};\n', extra = {}) {
  return makeDir({
    'package.json': JSON.stringify({ name: 'app', dependencies, devDependencies: { esbuild: '0' } }),
    'static-publish.rc.js': rc,
    ...extra,
  });
}

describe('listPlugins()', () => {
  test('the files directly in the folder, in plugin order', () => {
    const dir = makeDir({
      '20-grip.ts': '',
      '10-auth.js': '',
      'stream.mts': '',
      '_shared.ts': '',
      '.hidden.js': '',
      'types.d.ts': '',
      'notes.md': '',
      'package.json': '{}',
      'lib/helper.ts': '',
      'middleware/old.ts': '',
    });
    assert.deepEqual(listPlugins(dir), [
      { name: 'auth', file: '10-auth.js' },
      { name: 'grip', file: '20-grip.ts' },
      { name: 'stream', file: 'stream.mts' },
    ]);
  });

  test('a number prefix orders by its value, then the files without a prefix follow', () => {
    const dir = makeDir({
      '100-c.ts': '',
      '99-b.ts': '',
      '10-a.ts': '',
      '2-d.ts': '',
      '010-e.ts': '',
      'api.ts': '',
      'Zeta.ts': '',
    });
    assert.deepEqual(listPlugins(dir).map(plugin => plugin.file), [
      '2-d.ts',
      '010-e.ts',
      '10-a.ts',
      '99-b.ts',
      '100-c.ts',
      'Zeta.ts',
      'api.ts',
    ]);
  });

  test('comparePluginFiles() keeps the exact value of a long number', () => {
    assert.equal(comparePluginFiles('9007199254740993-a.ts', '9007199254740992-b.ts'), 1);
    assert.equal(comparePluginFiles('99999999999999999999-a.ts', '100000000000000000000-b.ts') < 0, true);
  });

  test('no folder, or no files: no modules', () => {
    assert.deepEqual(listPlugins(makeDir()), []);
    assert.deepEqual(listPlugins(path.resolve(makeDir(), 'missing')), []);
  });

  test('two modules with the same name are an error', () => {
    const dir = makeDir({ '10-grip.js': '', '20-grip.ts': '' });
    assert.throws(() => listPlugins(dir), /10-grip\.js and 20-grip\.ts have the same plugin name 'grip'/);
  });

  test('index is a reserved name', () => {
    for (const file of [ 'index.ts', 'index.js', 'index.mjs', 'index.mts' ]) {
      const dir = makeDir({ [file]: '' });
      assert.throws(() => listPlugins(dir), new RegExp(`^Error: hono-compose/${file.replace('.', '\\.')}: 'index' is a reserved name in this folder\\. Rename the file, for example to 10-${file.replace('.', '\\.')}\\.$`));
    }
    // With an order prefix, or as a helper, it is not the reserved name.
    assert.deepEqual(listPlugins(makeDir({ '10-index.ts': '', '_index.ts': '', 'lib/index.ts': '', 'index.d.ts': '' })),
      [ { name: 'index', file: '10-index.ts' } ]);
  });
});

describe('pluginsExternals()', () => {
  test('the dependencies of the app and this package, with subpaths, and fastly:*', () => {
    const appDir = makeApp({ hono: '^4', '@fastly/js-compute': '^4' });
    assert.deepEqual(pluginsExternals(appDir), [
      '@fastly/compute-js-static-publish', '@fastly/compute-js-static-publish/*',
      '@fastly/js-compute', '@fastly/js-compute/*',
      'hono', 'hono/*',
      'fastly:*',
    ]);
  });
});

describe('checkProvidedVersions()', () => {
  test('a range that does not include the version of the app is a warning', () => {
    const appDir = makeApp({ hono: '^4' }, undefined, { 'node_modules/hono/package.json': JSON.stringify({ version: '4.13.14' }) });
    for (const [ range, warns ] of [ [ '^4.6.0', false ], [ '^4.14.0', true ], [ '~4.13.0', false ], [ '4.13', false ], [ '4.12', true ], [ '>=5', true ], [ '*', false ], [ 'workspace:*', false ] ]) {
      const composeDir = makeDir({ 'package.json': JSON.stringify({ peerDependencies: { hono: range } }) });
      const warnings = checkProvidedVersions(appDir, composeDir);
      assert.equal(warnings.length, warns ? 1 : 0, range);
      if (warns) {
        assert.match(warnings[0], new RegExp(`expects hono ${range.replace(/[.^*+?]/g, '\\$&')}, but the app provides 4\\.13\\.14`));
      }
    }
  });

  test('packages that the app does not provide are not checked', () => {
    const appDir = makeApp({ hono: '^4' });
    const composeDir = makeDir({ 'package.json': JSON.stringify({ dependencies: { '@fanoutio/serve-grip': '^1' } }) });
    assert.deepEqual(checkProvidedVersions(appDir, composeDir), []);
  });
});

describe('bundlePlugins()', () => {
  test('without the folder: the manifest with no modules', async () => {
    const appDir = makeApp({ hono: '^4' });
    await bundlePlugins({ appDir, esbuild });
    const text = fs.readFileSync(path.resolve(appDir, PLUGINS_MANIFEST), 'utf-8');
    assert.match(text, /^export const plugins = \[\];$/m);
  });

  test('bundles the modules, and leaves the packages of the app as imports', async () => {
    const root = makeDir();
    const appDir = path.resolve(root, 'app');
    fs.mkdirSync(appDir);
    fs.writeFileSync(path.resolve(appDir, 'package.json'), JSON.stringify({ dependencies: { hono: '^4' } }));
    fs.writeFileSync(path.resolve(appDir, 'static-publish.rc.js'), `export default { build: { hono: { composeDir: '../ext' } } };\n`);
    const extDir = path.resolve(root, 'ext');
    for (const [ file, content ] of Object.entries({
      '10-header.ts': `import { createMiddleware } from 'hono/factory';\nimport { tag } from './lib/tag';\nconst x: string = tag;\nexport default { kind: 'plugin', bindings: {}, phases: { middleware: (app) => app.use('*', createMiddleware(async (c, next) => { await next(); c.header('x', x); })) } };\n`,
      'hello.ts': `import { env } from 'fastly:env';\nexport default { kind: 'plugin', bindings: {}, phases: { routes: (app) => app.get('/hello', (c) => c.text(env('X'))) } };\n`,
      'lib/tag.ts': `export const tag = 'from-lib';\n`,
    })) {
      fs.mkdirSync(path.dirname(path.resolve(extDir, file)), { recursive: true });
      fs.writeFileSync(path.resolve(extDir, file), content);
    }

    await bundlePlugins({ appDir, esbuild });
    const text = fs.readFileSync(path.resolve(appDir, PLUGINS_MANIFEST), 'utf-8');
    assert.match(text, /^\/\/ Generated by @fastly\/compute-js-static-publish/);
    assert.match(text, /from "hono\/factory"/, 'hono stays an import');
    assert.match(text, /from "fastly:env"/, 'fastly:* stays an import');
    assert.match(text, /from-lib/, 'a helper of the folder is bundled');
    assert.doesNotMatch(text, /: string/, 'the types are removed');
    assert.match(text, /name: "header", file: "10-header\.ts", plugin: /);
    assert.match(text, /name: "hello", file: "hello\.ts", plugin: /);
  });
});

describe('bundlePlugins(): only a change is written', () => {
  test('a second bundle with the same modules does not write the file', async () => {
    const appDir = makeApp({ hono: '^4' }, undefined, {
      'hono-compose/hello.js': `export default { kind: 'plugin', bindings: {}, phases: { middleware: () => {} } };\n`,
    });
    assert.equal(await bundlePlugins({ appDir, esbuild }), true);
    const file = path.resolve(appDir, PLUGINS_MANIFEST);
    const mtime = fs.statSync(file).mtimeMs;
    assert.equal(await bundlePlugins({ appDir, esbuild }), false);
    assert.equal(fs.statSync(file).mtimeMs, mtime);
  });
});

// Waits until check() is true, or fails after the timeout.
async function waitFor(check, message) {
  const end = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > end) {
      assert.fail(message);
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

describe('watchPlugins()', () => {
  const ROUTE = `export default { kind: 'plugin', bindings: {}, phases: { middleware: () => 'ROUTE_MARK' } };\n`;

  test('without the folder: the stub, then the modules when the folder is made, then the stub when it is removed', async () => {
    const appDir = makeApp({ hono: '^4' });
    const manifest = () => fs.readFileSync(path.resolve(appDir, PLUGINS_MANIFEST), 'utf-8');
    const watcher = await watchPlugins({ appDir, esbuild });
    try {
      assert.match(manifest(), /^export const plugins = \[\];$/m);
      fs.mkdirSync(path.resolve(appDir, 'hono-compose'), { recursive: true });
      fs.writeFileSync(path.resolve(appDir, 'hono-compose/hello.js'), ROUTE);
      await waitFor(() => manifest().includes('ROUTE_MARK'), 'the new folder is bundled');
      fs.rmSync(path.resolve(appDir, 'hono-compose'), { recursive: true });
      await waitFor(() => !manifest().includes('ROUTE_MARK'), 'the stub after the folder is removed');
    } finally {
      watcher.close();
    }
  });

  test('a new module, a changed helper, and a bundle error', async () => {
    const appDir = makeApp({ hono: '^4' }, undefined, {
      'hono-compose/hello.js': `import { mark } from './lib/mark.js';\nexport default { kind: 'plugin', bindings: {}, phases: { middleware: () => mark } };\n`,
      'hono-compose/lib/mark.js': `export const mark = 'MARK_ONE';\n`,
    });
    const manifest = () => fs.readFileSync(path.resolve(appDir, PLUGINS_MANIFEST), 'utf-8');
    const errors = [];
    const consoleError = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    const watcher = await watchPlugins({ appDir, esbuild });
    try {
      assert.match(manifest(), /MARK_ONE/);
      fs.writeFileSync(path.resolve(appDir, 'hono-compose/lib/mark.js'), `export const mark = 'MARK_TWO';\n`);
      await waitFor(() => manifest().includes('MARK_TWO'), 'a changed helper is bundled');
      fs.writeFileSync(path.resolve(appDir, 'hono-compose/other.js'), ROUTE);
      await waitFor(() => manifest().includes('ROUTE_MARK'), 'a new plugin is bundled');
      fs.writeFileSync(path.resolve(appDir, 'hono-compose/other.js'), 'export default {');
      await waitFor(() => errors.some(e => /Could not bundle the plugins: /.test(e)), 'the error is shown');
      assert.match(manifest(), /ROUTE_MARK/, 'the manifest of the app stays');
    } finally {
      watcher.close();
      console.error = consoleError;
    }
  });
});

describe('the names of earlier betas of 8.1', () => {
  test('the old settings stop the bundle, with the new names', async () => {
    const appDir = makeApp({ hono: '^4' }, `export default { build: { hono: { extensionsDir: './x' } }, templateOptions: { hono: { extensions: {} } } };\n`);
    await assert.rejects(bundlePlugins({ appDir, esbuild }),
      /^Error: The plugins of the hono template have new names: build\.hono\.extensionsDir is now build\.hono\.composeDir\. templateOptions\.hono\.extensions is now templateOptions\.hono\.compose\.plugins\.$/);
  });

  test('a hono-extensions/ folder with files, and no hono-compose/, stops the bundle', async () => {
    const appDir = makeApp({ hono: '^4' }, undefined, { 'hono-extensions/auth.ts': '' });
    await assert.rejects(bundlePlugins({ appDir, esbuild }), /The folder hono-extensions\/ is now hono-compose\/\. Rename it/);
    // With hono-compose/, the old folder is not used, and is not an error.
    fs.mkdirSync(path.resolve(appDir, 'hono-compose'));
    assert.equal(await bundlePlugins({ appDir, esbuild }), true);
    // An empty old folder is not an error.
    const other = makeApp({ hono: '^4' }, undefined, { 'hono-extensions/.keep': '' });
    fs.rmSync(path.resolve(other, 'hono-extensions/.keep'));
    assert.equal(await bundlePlugins({ appDir: other, esbuild }), true);
  });

  test('the old functions of the scripts throw, and give the new names', () => {
    assert.throws(() => bundleHonoExtensions(), /update scripts\/ and src\/index\.ts of the app as MIGRATING\.md shows\. bundleHonoExtensions\(\) is now bundlePlugins\(\)\./);
    assert.throws(() => watchHonoExtensions(), /watchHonoExtensions\(\) is now watchPlugins\(\)\./);
    assert.throws(() => writeHonoExtensionsStub(), /writeHonoExtensionsStub\(\) is now writePluginsStub\(\)\./);
  });
});

describe('writePluginsStub()', () => {
  test('writes the manifest with no modules', () => {
    const appDir = makeDir();
    writePluginsStub({ appDir });
    assert.ok(fs.existsSync(path.resolve(appDir, PLUGINS_MANIFEST)));
  });
});
