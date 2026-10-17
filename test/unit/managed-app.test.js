/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import child_process from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { appTemplates } from '../../build/cli/cli/commands/scaffold/templates/index.js';
import {
  THIS_PACKAGE,
  buildManagedLockfile,
  pinnedVersion,
  readTemplateLockfile,
  templatePackageJson,
} from '../../build/cli/cli/managed/lockfile.js';
import { needsInstall, writeManagedAppFiles } from '../../build/cli/cli/managed/app.js';

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const tempDirs = [];
function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cjsp-unit-managed-'));
  tempDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('template lockfiles', () => {
  for (const name of Object.keys(appTemplates)) {
    test(`${name}: the lockfile is up to date (else run: npm run update-template-lockfiles)`, () => {
      const lock = readTemplateLockfile(name);
      const pkg = templatePackageJson(name);
      const root = lock.packages[''];
      assert.deepEqual(root.dependencies ?? {}, pkg.dependencies ?? {});
      assert.deepEqual(root.devDependencies ?? {}, pkg.devDependencies ?? {});
      assert.equal(root.devDependencies?.[THIS_PACKAGE], undefined, 'the lockfile does not have this package');
      for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
        assert.ok(lock.packages[`node_modules/${dep}`]?.version, dep);
      }
    });
  }

  test('pinnedVersion() gives the version in the lockfile', () => {
    assert.match(pinnedVersion('plain', '@fastly/js-compute'), /^4\.\d+\.\d+/);
    assert.equal(pinnedVersion('plain', 'not-a-package'), undefined);
  });

  test('the package tarball has the lockfiles', () => {
    const result = child_process.spawnSync('npm', [ 'pack', '--dry-run', '--json', '--ignore-scripts' ], { cwd: REPO_DIR, encoding: 'utf-8' });
    assert.equal(result.status, 0, result.stderr);
    const files = JSON.parse(result.stdout)[0].files.map(x => x.path);
    for (const name of Object.keys(appTemplates)) {
      assert.ok(files.includes(`resources/templates/${name}/package-lock.json`), name);
    }
  });
});

describe('buildManagedLockfile', () => {
  const templateLock = {
    name: 'template-plain',
    version: '0.1.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'template-plain', version: '0.1.0', dependencies: { a: '^1.0.0' }, devDependencies: { b: '^2.0.0' } },
      'node_modules/a': { version: '1.0.1' },
    },
  };
  const cliPackageJson = {
    name: THIS_PACKAGE,
    version: '8.1.0',
    license: 'MIT',
    dependencies: { x: '^1.0.0' },
    peerDependencies: { '@fastly/js-compute': '^4.0.0' },
    bin: { 'compute-js-static-publish': 'build/cli/cli/index.js' },
    engines: { node: '>=20.11.0' },
    scripts: { test: 'x' },
  };

  test('adds the file: link to the CLI copy of this package', () => {
    const lock = buildManagedLockfile(templateLock, {
      appName: 'my-site',
      appDir: '/p/.static-publish/app',
      cliPackageDir: '/p/node_modules/@fastly/compute-js-static-publish',
      cliPackageJson,
    });
    assert.equal(lock.name, 'my-site');
    assert.equal(lock.packages[''].name, 'my-site');
    assert.deepEqual(lock.packages[''].devDependencies, { b: '^2.0.0', [THIS_PACKAGE]: 'file:/p/node_modules/@fastly/compute-js-static-publish' });
    assert.deepEqual(lock.packages[`node_modules/${THIS_PACKAGE}`], { resolved: '../../node_modules/@fastly/compute-js-static-publish', link: true });
    assert.deepEqual(lock.packages['../../node_modules/@fastly/compute-js-static-publish'], {
      version: '8.1.0',
      license: 'MIT',
      dependencies: { x: '^1.0.0' },
      bin: { 'compute-js-static-publish': 'build/cli/cli/index.js' },
      engines: { node: '>=20.11.0' },
      peerDependencies: { '@fastly/js-compute': '^4.0.0' },
      dev: true,
    });
    assert.deepEqual(lock.packages['node_modules/a'], { version: '1.0.1' });
  });

  test('does not change the template lockfile', () => {
    const copy = JSON.parse(JSON.stringify(templateLock));
    buildManagedLockfile(templateLock, { appName: 'x', appDir: '/a', cliPackageDir: '/b', cliPackageJson });
    assert.deepEqual(templateLock, copy);
  });
});

describe('writeManagedAppFiles', () => {
  test('writes the app files, and a file outside the app dir only if it is missing', () => {
    const projectDir = makeTempDir();
    const appDir = path.join(projectDir, '.static-publish/app');
    const files = { 'package.json': '{}', 'src/index.js': 'x', '../../static-publisher/kvstore.json': '{}' };
    assert.deepEqual(writeManagedAppFiles(appDir, files).sort(), Object.keys(files).sort());

    fs.writeFileSync(path.join(projectDir, 'static-publisher/kvstore.json'), '{"published":1}');
    assert.deepEqual(writeManagedAppFiles(appDir, files), [], 'no change');
    assert.equal(fs.readFileSync(path.join(projectDir, 'static-publisher/kvstore.json'), 'utf-8'), '{"published":1}');

    assert.deepEqual(writeManagedAppFiles(appDir, { ...files, 'src/index.js': 'y' }), [ 'src/index.js' ]);
  });
});

describe('needsInstall', () => {
  test('true until an install, and again when package.json or the lockfile changes', () => {
    const appDir = makeTempDir();
    fs.writeFileSync(path.join(appDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(appDir, 'package-lock.json'), '{}');
    assert.equal(needsInstall(appDir), true);
    // What installManagedApp() writes after npm ci.
    fs.mkdirSync(path.join(appDir, 'node_modules'));
    const stamp = path.join(appDir, 'node_modules/.compute-js-static-publish-install');
    fs.writeFileSync(stamp, 'x');
    assert.equal(needsInstall(appDir), true, 'another hash');
  });
});
