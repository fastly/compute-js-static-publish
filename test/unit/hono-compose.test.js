/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { PLUGIN_PHASES, defineExtension, definePlugin, mergeBindings } from '../../build/server/hono/compose.js';
import { checkTemplateSettings } from '../../build/cli/models/config/template-settings.js';

const entry = (file, plugin) => ({ name: file.replace(/^(\d+-)?/, '').replace(/\.\w+$/, ''), file, plugin });

describe('definePlugin()', () => {
  test('a function is the middleware phase', () => {
    const fn = () => {};
    assert.deepEqual(definePlugin(fn), { kind: 'plugin', bindings: {}, phases: { middleware: fn } });
    assert.deepEqual(definePlugin({ bindings: { grip: 'SecretStore:grip' } }, fn),
      { kind: 'plugin', bindings: { grip: 'SecretStore:grip' }, phases: { middleware: fn } });
  });

  test('an object has a function for each phase', () => {
    const a = () => {};
    const b = () => {};
    assert.deepEqual(definePlugin({ middleware: a, routes: b }), { kind: 'plugin', bindings: {}, phases: { middleware: a, routes: b } });
    assert.deepEqual(definePlugin({ bindings: { kv: 'KVStore' } }, { afterFilesRoutes: a }),
      { kind: 'plugin', bindings: { kv: 'KVStore' }, phases: { afterFilesRoutes: a } });
  });

  test('the phases, in the order that the app runs them', () => {
    assert.deepEqual(PLUGIN_PHASES, [ 'middleware', 'routes', 'afterFilesRoutes' ]);
  });
});

describe('mergeBindings()', () => {
  const auth = definePlugin({ bindings: { secrets: 'SecretStore:auth', config: 'ConfigStore:site' } }, () => {});
  const stream = definePlugin({ bindings: { config: 'ConfigStore:site' } }, { routes: () => {} });

  test('merges the bindings of the app and of the plugins', () => {
    assert.deepEqual(
      mergeBindings({ kv: 'KVStore' }, [ entry('10-auth.ts', auth), entry('stream.ts', stream) ]),
      { kv: 'KVStore', secrets: 'SecretStore:auth', config: 'ConfigStore:site' },
    );
    assert.deepEqual(mergeBindings(undefined, []), {});
  });

  test('one name with two resources is an error that names both sources', () => {
    assert.throws(
      () => mergeBindings({ config: 'ConfigStore:other' }, [ entry('10-auth.ts', auth) ]),
      /The binding 'config' is 'ConfigStore:other' in templateOptions\.hono\.bindings, but 'ConfigStore:site' in hono-compose\/10-auth\.ts\./,
    );
  });

  test('a binding name of Object.prototype is an ordinary name', () => {
    const odd = definePlugin({ bindings: { toString: 'KVStore:a', constructor: 'ConfigStore:b' } }, () => {});
    assert.deepEqual(mergeBindings({}, [ entry('odd.ts', odd) ]), { toString: 'KVStore:a', constructor: 'ConfigStore:b' });
    assert.throws(
      () => mergeBindings({ toString: 'KVStore:other' }, [ entry('odd.ts', odd) ]),
      /The binding 'toString' is 'KVStore:other' in templateOptions\.hono\.bindings, but 'KVStore:a' in hono-compose\/odd\.ts\./,
    );
  });

  test('a plugin must default-export definePlugin()', () => {
    assert.throws(() => mergeBindings({}, [ entry('x.ts', async () => {}) ]),
      /hono-compose\/x\.ts: the default export must be definePlugin\(…\)\./);
    assert.throws(() => mergeBindings({}, [ entry('z.ts', undefined) ]), /definePlugin/);
  });

  test('phases that are not correct are an error', () => {
    assert.throws(() => mergeBindings({}, [ entry('a.ts', definePlugin({})) ]),
      /hono-compose\/a\.ts: definePlugin\(\) needs a function, or an object with a function for one or more of the phases middleware, routes, afterFilesRoutes\.$/);
    assert.throws(() => mergeBindings({}, [ entry('b.ts', definePlugin({ middleware: () => {}, before: () => {} })) ]),
      /hono-compose\/b\.ts: .* 'before' is not a phase\./);
    assert.throws(() => mergeBindings({}, [ entry('d.ts', definePlugin({ before: () => {}, after: () => {} })) ]),
      /'before', 'after' are not phases\./);
    assert.throws(() => mergeBindings({}, [ entry('c.ts', definePlugin({ bindings: {} }, { routes: 'x' })) ]),
      /hono-compose\/c\.ts: the phase routes must be a function\./);
  });

  test('a phase name of an earlier beta names the new phase', () => {
    assert.throws(() => mergeBindings({}, [ entry('e.ts', definePlugin({ beforeFiles: () => {} })) ]),
      /hono-compose\/e\.ts: .* 'beforeFiles' is not a phase\. Rename 'beforeFiles' to 'routes'\.$/);
    assert.throws(() => mergeBindings({}, [ entry('f.ts', definePlugin({ beforeFiles: () => {}, afterFiles: () => {} })) ]),
      /are not phases\. Rename 'beforeFiles' to 'routes'\. Rename 'afterFiles' to 'afterFilesRoutes'\.$/);
    assert.throws(() => mergeBindings({}, [ entry('h.ts', definePlugin({ beforeFilesRoutes: () => {} })) ]),
      /hono-compose\/h\.ts: .* 'beforeFilesRoutes' is not a phase\. Rename 'beforeFilesRoutes' to 'routes'\.$/);
    assert.throws(() => mergeBindings({}, [ entry('g.ts', definePlugin({ toString: () => {} })) ]),
      /'toString' is not a phase\.$/);
  });
});

describe('the names of earlier betas of 8.1', () => {
  test('defineExtension() throws, and gives the new name', () => {
    assert.throws(() => defineExtension(() => {}), /defineExtension\(\) is now definePlugin\(\), from the same import/);
  });

  test('the old settings are errors that give the new names', () => {
    const result = checkTemplateSettings({ hono: { extensionsDir: '../hono-extensions' } }, { hono: { extensions: { auth: {} } } });
    assert.deepEqual(result.errors, [
      'build.hono.extensionsDir is now build.hono.composeDir.',
      'templateOptions.hono.extensions is now templateOptions.hono.compose.plugins.',
    ]);
    assert.deepEqual(result.warnings, []);
  });
});

describe('checkTemplateSettings()', () => {
  test('valid settings', () => {
    assert.deepEqual(checkTemplateSettings(undefined, undefined), { errors: [], warnings: [] });
    assert.deepEqual(checkTemplateSettings(
      { hono: { composeDir: '../hono-compose' } },
      { hono: { bindings: { config: 'ConfigStore:site' }, compose: { plugins: { auth: { realm: 'x' } } } } },
    ), { errors: [], warnings: [] });
  });

  test('settings that no template declares are warnings', () => {
    const result = checkTemplateSettings({ next: {}, hono: { outDir: 'x' } }, { hono: { colors: true } });
    assert.deepEqual(result.errors, []);
    assert.equal(result.warnings.length, 3);
    assert.match(result.warnings.join('\n'), /build\.next: no template 'next'/);
    assert.match(result.warnings.join('\n'), /build\.hono\.outDir is not a setting of the template 'hono'/);
    assert.match(result.warnings.join('\n'), /templateOptions\.hono\.colors is not a setting/);
  });

  test('values of the wrong type are errors', () => {
    assert.match(checkTemplateSettings([], undefined).errors[0], /build must be an object/);
    assert.match(checkTemplateSettings({ hono: { composeDir: '/abs' } }, undefined).errors[0], /must be a relative path/);
    assert.match(checkTemplateSettings(undefined, { hono: { bindings: { a: 1 } } }).errors[0], /bindings\.a must be a non-empty string/);
    assert.match(checkTemplateSettings(undefined, { hono: { compose: [] } }).errors[0], /templateOptions\.hono\.compose must be an object/);
    assert.match(checkTemplateSettings(undefined, { hono: { compose: { plugins: [] } } }).errors[0], /templateOptions\.hono\.compose\.plugins must be an object/);
    assert.match(checkTemplateSettings(undefined, { hono: { compose: { other: 1 } } }).warnings[0], /templateOptions\.hono\.compose\.other is not a setting/);
    assert.match(checkTemplateSettings(undefined, { hono: { middleware: {} } }).warnings[0], /templateOptions\.hono\.middleware is not a setting/);
  });
});
