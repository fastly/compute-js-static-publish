/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

import {
  applyTemplateInit,
  planTemplateInit,
  providedVersions,
  templateHasInit,
} from '../../build/cli/cli/managed/template-init.js';

const tempDirs = [];
function makeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cjsp-template-init-'));
  tempDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const provided = { hono: '4.13.14', '@fastly/compute-js-static-publish': '8.1.0' };

describe('template init', () => {
  test('only the hono template has a folder', () => {
    assert.equal(templateHasInit('hono'), true);
    assert.equal(templateHasInit('plain'), false);
  });

  test('the provided packages: the dependencies of the template, and this package', () => {
    const versions = providedVersions('hono', undefined, '8.1.0');
    assert.deepEqual(Object.keys(versions).sort(), [
      '@fastly/compute-js-static-publish', '@fastly/hono-fastly-compute', '@fastly/js-compute', 'hono',
    ]);
    assert.equal(versions['@fastly/compute-js-static-publish'], '8.1.0');
    assert.match(versions.hono, /^4\.\d+\.\d+$/);
  });

  test('a new folder gets package.json, tsconfig.json, .gitignore, and the inactive example', () => {
    const dir = path.join(makeDir(), 'hono-extensions');
    const plan = planTemplateInit('hono', dir, provided, { reset: false });
    assert.deepEqual(Object.keys(plan.write).sort(), [ '.gitignore', '_example.ts', 'package.json', 'tsconfig.json' ]);
    assert.equal(plan.write['.gitignore'], '/node_modules\n');
    assert.deepEqual(plan.replace, []);
    const packageJson = JSON.parse(plan.write['package.json']);
    assert.deepEqual(packageJson.peerDependencies, { hono: '^4.13.14', '@fastly/compute-js-static-publish': '^8.1.0' });
    assert.match(packageJson.devDependencies.typescript, /^\^7\./);
    assert.equal(packageJson.type, 'module');
    applyTemplateInit(dir, plan);
    assert.deepEqual(planTemplateInit('hono', dir, provided, { reset: false }), { write: {}, replace: [], outOfDate: [] }, 'up to date after init');
  });

  test('a folder that exists: only the peer versions change, and the modules stay', () => {
    const dir = makeDir();
    fs.writeFileSync(path.join(dir, '10-auth.ts'), 'my module');
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{ "mine": true }');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: 'mine', dependencies: { '@hono/oauth-providers': '^0.9.1' }, peerDependencies: { hono: '^4.6.0' },
    }));
    const plan = planTemplateInit('hono', dir, provided, { reset: false });
    assert.equal('10-auth.ts' in plan.write, false);
    assert.equal('tsconfig.json' in plan.write, false, 'a starter file that exists is kept');
    const packageJson = JSON.parse(plan.write['package.json']);
    assert.equal(packageJson.name, 'mine');
    assert.deepEqual(packageJson.dependencies, { '@hono/oauth-providers': '^0.9.1' });
    assert.equal(packageJson.peerDependencies.hono, '^4.13.14');
    assert.match(plan.outOfDate.join('\n'), /peerDependencies\.hono is \^4\.6\.0, but the app provides 4\.13\.14/);
    assert.match(plan.outOfDate.join('\n'), /peerDependencies\.@fastly\/compute-js-static-publish is missing/);
  });

  test('a missing example is not out of date; a missing tsconfig.json is', () => {
    const dir = makeDir();
    applyTemplateInit(dir, planTemplateInit('hono', dir, provided, { reset: false }));
    fs.rmSync(path.join(dir, '_example.ts'));
    assert.deepEqual(planTemplateInit('hono', dir, provided, { reset: false }).outOfDate, []);
    fs.rmSync(path.join(dir, 'tsconfig.json'));
    assert.deepEqual(planTemplateInit('hono', dir, provided, { reset: false }).outOfDate, [ 'tsconfig.json is missing.' ]);
  });

  test('reset replaces the starter files that changed', () => {
    const dir = makeDir();
    applyTemplateInit(dir, planTemplateInit('hono', dir, provided, { reset: false }));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
    assert.deepEqual(planTemplateInit('hono', dir, provided, { reset: false }).replace, []);
    assert.deepEqual(planTemplateInit('hono', dir, provided, { reset: true }).replace, [ 'tsconfig.json' ]);
  });
});
