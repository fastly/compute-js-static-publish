/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

import * as esbuild from 'esbuild';

import {
  HONO_EXTENSIONS_MANIFEST,
  bundleHonoExtensions,
  checkProvidedVersions,
  honoExtensionsExternals,
  listHonoExtensionModules,
  watchHonoExtensions,
  writeHonoExtensionsStub,
} from '../../build/cli/cli/hono/build.js';

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

describe('listHonoExtensionModules()', () => {
  test('the files directly in the folder, in file-name order', () => {
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
    assert.deepEqual(listHonoExtensionModules(dir), [
      { name: 'auth', file: '10-auth.js' },
      { name: 'grip', file: '20-grip.ts' },
      { name: 'stream', file: 'stream.mts' },
    ]);
  });

  test('no folder, or no files: no modules', () => {
    assert.deepEqual(listHonoExtensionModules(makeDir()), []);
    assert.deepEqual(listHonoExtensionModules(path.resolve(makeDir(), 'missing')), []);
  });

  test('two modules with the same name are an error', () => {
    const dir = makeDir({ '10-grip.js': '', '20-grip.ts': '' });
    assert.throws(() => listHonoExtensionModules(dir), /10-grip\.js and 20-grip\.ts have the same module name 'grip'/);
  });
});

describe('honoExtensionsExternals()', () => {
  test('the dependencies of the app and this package, with subpaths, and fastly:*', () => {
    const appDir = makeApp({ hono: '^4', '@fastly/js-compute': '^4' });
    assert.deepEqual(honoExtensionsExternals(appDir), [
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
      const extensionsDir = makeDir({ 'package.json': JSON.stringify({ peerDependencies: { hono: range } }) });
      const warnings = checkProvidedVersions(appDir, extensionsDir);
      assert.equal(warnings.length, warns ? 1 : 0, range);
      if (warns) {
        assert.match(warnings[0], new RegExp(`expects hono ${range.replace(/[.^*+?]/g, '\\$&')}, but the app provides 4\\.13\\.14`));
      }
    }
  });

  test('packages that the app does not provide are not checked', () => {
    const appDir = makeApp({ hono: '^4' });
    const extensionsDir = makeDir({ 'package.json': JSON.stringify({ dependencies: { '@fanoutio/serve-grip': '^1' } }) });
    assert.deepEqual(checkProvidedVersions(appDir, extensionsDir), []);
  });
});

describe('bundleHonoExtensions()', () => {
  test('without the folder: the manifest with no modules', async () => {
    const appDir = makeApp({ hono: '^4' });
    await bundleHonoExtensions({ appDir, esbuild });
    const text = fs.readFileSync(path.resolve(appDir, HONO_EXTENSIONS_MANIFEST), 'utf-8');
    assert.match(text, /^export const extensions = \[\];$/m);
  });

  test('bundles the modules, and leaves the packages of the app as imports', async () => {
    const root = makeDir();
    const appDir = path.resolve(root, 'app');
    fs.mkdirSync(appDir);
    fs.writeFileSync(path.resolve(appDir, 'package.json'), JSON.stringify({ dependencies: { hono: '^4' } }));
    fs.writeFileSync(path.resolve(appDir, 'static-publish.rc.js'), `export default { build: { hono: { extensionsDir: '../ext' } } };\n`);
    const extDir = path.resolve(root, 'ext');
    for (const [ file, content ] of Object.entries({
      '10-header.ts': `import { createMiddleware } from 'hono/factory';\nimport { tag } from './lib/tag';\nconst x: string = tag;\nexport default { kind: 'extension', bindings: {}, phases: { middleware: (app) => app.use('*', createMiddleware(async (c, next) => { await next(); c.header('x', x); })) } };\n`,
      'hello.ts': `import { env } from 'fastly:env';\nexport default { kind: 'extension', bindings: {}, phases: { beforeFiles: (app) => app.get('/hello', (c) => c.text(env('X'))) } };\n`,
      'lib/tag.ts': `export const tag = 'from-lib';\n`,
    })) {
      fs.mkdirSync(path.dirname(path.resolve(extDir, file)), { recursive: true });
      fs.writeFileSync(path.resolve(extDir, file), content);
    }

    await bundleHonoExtensions({ appDir, esbuild });
    const text = fs.readFileSync(path.resolve(appDir, HONO_EXTENSIONS_MANIFEST), 'utf-8');
    assert.match(text, /^\/\/ Generated by @fastly\/compute-js-static-publish/);
    assert.match(text, /from "hono\/factory"/, 'hono stays an import');
    assert.match(text, /from "fastly:env"/, 'fastly:* stays an import');
    assert.match(text, /from-lib/, 'a helper of the folder is bundled');
    assert.doesNotMatch(text, /: string/, 'the types are removed');
    assert.match(text, /name: "header", file: "10-header\.ts", module: /);
    assert.match(text, /name: "hello", file: "hello\.ts", module: /);
  });
});

describe('bundleHonoExtensions(): only a change is written', () => {
  test('a second bundle with the same modules does not write the file', async () => {
    const appDir = makeApp({ hono: '^4' }, undefined, {
      'hono-extensions/hello.js': `export default { kind: 'extension', bindings: {}, phases: { middleware: () => {} } };\n`,
    });
    assert.equal(await bundleHonoExtensions({ appDir, esbuild }), true);
    const file = path.resolve(appDir, HONO_EXTENSIONS_MANIFEST);
    const mtime = fs.statSync(file).mtimeMs;
    assert.equal(await bundleHonoExtensions({ appDir, esbuild }), false);
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

describe('watchHonoExtensions()', () => {
  const ROUTE = `export default { kind: 'extension', bindings: {}, phases: { middleware: () => 'ROUTE_MARK' } };\n`;

  test('without the folder: the stub, then the modules when the folder is made, then the stub when it is removed', async () => {
    const appDir = makeApp({ hono: '^4' });
    const manifest = () => fs.readFileSync(path.resolve(appDir, HONO_EXTENSIONS_MANIFEST), 'utf-8');
    const watcher = await watchHonoExtensions({ appDir, esbuild });
    try {
      assert.match(manifest(), /^export const extensions = \[\];$/m);
      fs.mkdirSync(path.resolve(appDir, 'hono-extensions'), { recursive: true });
      fs.writeFileSync(path.resolve(appDir, 'hono-extensions/hello.js'), ROUTE);
      await waitFor(() => manifest().includes('ROUTE_MARK'), 'the new folder is bundled');
      fs.rmSync(path.resolve(appDir, 'hono-extensions'), { recursive: true });
      await waitFor(() => !manifest().includes('ROUTE_MARK'), 'the stub after the folder is removed');
    } finally {
      watcher.close();
    }
  });

  test('a new module, a changed helper, and a bundle error', async () => {
    const appDir = makeApp({ hono: '^4' }, undefined, {
      'hono-extensions/hello.js': `import { mark } from './lib/mark.js';\nexport default { kind: 'extension', bindings: {}, phases: { middleware: () => mark } };\n`,
      'hono-extensions/lib/mark.js': `export const mark = 'MARK_ONE';\n`,
    });
    const manifest = () => fs.readFileSync(path.resolve(appDir, HONO_EXTENSIONS_MANIFEST), 'utf-8');
    const errors = [];
    const consoleError = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    const watcher = await watchHonoExtensions({ appDir, esbuild });
    try {
      assert.match(manifest(), /MARK_ONE/);
      fs.writeFileSync(path.resolve(appDir, 'hono-extensions/lib/mark.js'), `export const mark = 'MARK_TWO';\n`);
      await waitFor(() => manifest().includes('MARK_TWO'), 'a changed helper is bundled');
      fs.writeFileSync(path.resolve(appDir, 'hono-extensions/other.js'), ROUTE);
      await waitFor(() => manifest().includes('ROUTE_MARK'), 'a new module is bundled');
      fs.writeFileSync(path.resolve(appDir, 'hono-extensions/other.js'), 'export default {');
      await waitFor(() => errors.some(e => /Could not bundle the Hono extensions/.test(e)), 'the error is shown');
      assert.match(manifest(), /ROUTE_MARK/, 'the manifest of the app stays');
    } finally {
      watcher.close();
      console.error = consoleError;
    }
  });
});

describe('writeHonoExtensionsStub()', () => {
  test('writes the manifest with no modules', () => {
    const appDir = makeDir();
    writeHonoExtensionsStub({ appDir });
    assert.ok(fs.existsSync(path.resolve(appDir, HONO_EXTENSIONS_MANIFEST)));
  });
});
