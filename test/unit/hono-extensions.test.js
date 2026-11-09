/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { EXTENSION_PHASES, defineExtension, mergeBindings } from '../../build/server/hono/extensions.js';
import { checkTemplateSettings } from '../../build/cli/models/config/template-settings.js';

const entry = (file, module) => ({ name: file.replace(/^(\d+-)?/, '').replace(/\.\w+$/, ''), file, module });

describe('defineExtension()', () => {
  test('a function is the middleware phase', () => {
    const fn = () => {};
    assert.deepEqual(defineExtension(fn), { kind: 'extension', bindings: {}, phases: { middleware: fn } });
    assert.deepEqual(defineExtension({ bindings: { grip: 'SecretStore:grip' } }, fn),
      { kind: 'extension', bindings: { grip: 'SecretStore:grip' }, phases: { middleware: fn } });
  });

  test('an object has a function for each phase', () => {
    const a = () => {};
    const b = () => {};
    assert.deepEqual(defineExtension({ middleware: a, beforeFiles: b }), { kind: 'extension', bindings: {}, phases: { middleware: a, beforeFiles: b } });
    assert.deepEqual(defineExtension({ bindings: { kv: 'KVStore' } }, { afterFiles: a }),
      { kind: 'extension', bindings: { kv: 'KVStore' }, phases: { afterFiles: a } });
  });

  test('the phases, in the order that the app runs them', () => {
    assert.deepEqual(EXTENSION_PHASES, [ 'middleware', 'beforeFiles', 'afterFiles' ]);
  });
});

describe('mergeBindings()', () => {
  const auth = defineExtension({ bindings: { secrets: 'SecretStore:auth', config: 'ConfigStore:site' } }, () => {});
  const stream = defineExtension({ bindings: { config: 'ConfigStore:site' } }, { beforeFiles: () => {} });

  test('merges the bindings of the app and of the modules', () => {
    assert.deepEqual(
      mergeBindings({ kv: 'KVStore' }, [ entry('10-auth.ts', auth), entry('stream.ts', stream) ]),
      { kv: 'KVStore', secrets: 'SecretStore:auth', config: 'ConfigStore:site' },
    );
    assert.deepEqual(mergeBindings(undefined, []), {});
  });

  test('one name with two resources is an error that names both sources', () => {
    assert.throws(
      () => mergeBindings({ config: 'ConfigStore:other' }, [ entry('10-auth.ts', auth) ]),
      /The binding 'config' is 'ConfigStore:other' in templateOptions\.hono\.bindings, but 'ConfigStore:site' in hono-extensions\/10-auth\.ts\./,
    );
  });

  test('a module must default-export defineExtension()', () => {
    assert.throws(() => mergeBindings({}, [ entry('x.ts', async () => {}) ]),
      /hono-extensions\/x\.ts: the default export must be defineExtension\(…\)\./);
    assert.throws(() => mergeBindings({}, [ entry('z.ts', undefined) ]), /defineExtension/);
  });

  test('phases that are not correct are an error', () => {
    assert.throws(() => mergeBindings({}, [ entry('a.ts', defineExtension({})) ]),
      /hono-extensions\/a\.ts: defineExtension\(\) needs a function, or an object with a function for one or more of the phases middleware, beforeFiles, afterFiles\.$/);
    assert.throws(() => mergeBindings({}, [ entry('b.ts', defineExtension({ middleware: () => {}, before: () => {} })) ]),
      /hono-extensions\/b\.ts: .* 'before' is not a phase\./);
    assert.throws(() => mergeBindings({}, [ entry('d.ts', defineExtension({ before: () => {}, after: () => {} })) ]),
      /'before', 'after' are not phases\./);
    assert.throws(() => mergeBindings({}, [ entry('c.ts', defineExtension({ bindings: {} }, { beforeFiles: 'x' })) ]),
      /hono-extensions\/c\.ts: the phase beforeFiles must be a function\./);
  });
});

describe('checkTemplateSettings()', () => {
  test('valid settings', () => {
    assert.deepEqual(checkTemplateSettings(undefined, undefined), { errors: [], warnings: [] });
    assert.deepEqual(checkTemplateSettings(
      { hono: { extensionsDir: '../hono-extensions' } },
      { hono: { bindings: { config: 'ConfigStore:site' }, extensions: { auth: { realm: 'x' } } } },
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
    assert.match(checkTemplateSettings({ hono: { extensionsDir: '/abs' } }, undefined).errors[0], /must be a relative path/);
    assert.match(checkTemplateSettings(undefined, { hono: { bindings: { a: 1 } } }).errors[0], /bindings\.a must be a non-empty string/);
    assert.match(checkTemplateSettings(undefined, { hono: { extensions: [] } }).errors[0], /extensions must be an object/);
    assert.match(checkTemplateSettings(undefined, { hono: { middleware: {} } }).warnings[0], /templateOptions\.hono\.middleware is not a setting/);
  });
});
