/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import child_process from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  APP_TEMPLATE_NAMES,
  isAppTemplateName,
  loadAppTemplate,
} from '../../build/cli/cli/commands/scaffold/app-template.js';
import { generateApp } from '../../build/cli/cli/commands/scaffold/generate-app.js';
import {
  RENDER_FILTERS,
  jsFilter,
  lineFilter,
  tomlFilter,
  tomlKeyFilter,
} from '../../build/cli/cli/commands/scaffold/render.js';

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RESOURCES_DIR = path.resolve(REPO_DIR, 'resources');

const config = {
  appDir: '/project/compute-js',
  name: 'app',
  author: 'you@example.com',
  description: 'Fastly Compute static site',
  serviceId: undefined,
  storage: { mode: 'kv-store', kvStoreName: 'site-content' },
  publishId: 'default',
  defaultCollectionName: 'live',
  staticPublisherWorkingDir: '/project/compute-js/static-publisher',
  rootDir: '/project/public',
  publicDir: '/project/public',
  staticDirs: [],
  spaFilename: undefined,
  notFoundPageFilename: undefined,
  autoIndex: [],
  autoExt: [],
  staticPublishVersionSpec: '^8.1.0',
};

describe('templates', () => {
  test('only the names of templates are valid', () => {
    assert.deepEqual(APP_TEMPLATE_NAMES, [ 'plain' ]);
    assert.equal(isAppTemplateName('plain'), true);
    for (const name of [ 'hono', 'constructor', '__proto__', 'toString', '' ]) {
      assert.equal(isAppTemplateName(name), false, name);
      assert.throws(() => loadAppTemplate(name), /Unknown template/);
    }
  });

  test('the files of a template do not include its package.json and lockfile', () => {
    for (const name of APP_TEMPLATE_NAMES) {
      const template = loadAppTemplate(name);
      assert.equal('package.json' in template.files, false);
      assert.equal('package-lock.json' in template.files, false);
    }
  });

  test('no template has a file that generateApp() writes', () => {
    for (const name of APP_TEMPLATE_NAMES) {
      const template = loadAppTemplate(name);
      assert.doesNotThrow(() => generateApp({ ...config, template }), name);
    }
  });

  test('generateApp() throws for a template file that it writes', () => {
    const template = { ...loadAppTemplate('plain') };
    template.files = { ...template.files, './fastly.toml': '' };
    assert.throws(() => generateApp({ ...config, template }), /'\.\/fastly\.toml', which generateApp\(\) writes/);
  });

  test('the dependencies of the app come from the package.json of the template', () => {
    const templatePackageJson = JSON.parse(fs.readFileSync(path.resolve(RESOURCES_DIR, 'templates/plain/package.json'), 'utf-8'));
    const files = generateApp({ ...config, template: loadAppTemplate('plain') });
    const packageJson = JSON.parse(files['package.json']);
    assert.deepEqual(packageJson.dependencies, templatePackageJson.dependencies);
    assert.deepEqual(packageJson.devDependencies, {
      ...templatePackageJson.devDependencies,
      '@fastly/compute-js-static-publish': '^8.1.0',
    });
  });

  test('the template package.json has no scripts, and does not list this package', () => {
    for (const name of APP_TEMPLATE_NAMES) {
      const packageJson = JSON.parse(fs.readFileSync(path.resolve(RESOURCES_DIR, 'templates', name, 'package.json'), 'utf-8'));
      assert.equal(packageJson.scripts, undefined, name);
      assert.equal(packageJson.dependencies?.['@fastly/compute-js-static-publish'], undefined, name);
      assert.equal(packageJson.devDependencies?.['@fastly/compute-js-static-publish'], undefined, name);
    }
  });

  test('the package includes the resources', () => {
    const result = child_process.spawnSync('npm', [ 'pack', '--dry-run', '--json', '--ignore-scripts' ], { cwd: REPO_DIR, encoding: 'utf-8' });
    assert.equal(result.status, 0, result.stderr);
    const files = JSON.parse(result.stdout)[0].files.map(file => file.path);
    for (const file of [
      'resources/app/fastly.toml.njk',
      'resources/app/gitignore.njk',
      'resources/app/publish-content.config.js.njk',
      'resources/app/static-publish.rc.js.njk',
      'resources/templates/plain/package.json',
      'resources/templates/plain/package-lock.json',
      'resources/templates/plain/src/index.js',
    ]) {
      assert.ok(files.includes(file), file);
    }
  });
});

describe('render filters', () => {
  test('every value in resources/app/ goes through a filter', () => {
    const dir = path.resolve(RESOURCES_DIR, 'app');
    for (const file of fs.readdirSync(dir)) {
      const text = fs.readFileSync(path.resolve(dir, file), 'utf-8');
      for (const [ , expression ] of text.matchAll(/\{\{(.*?)\}\}/gs)) {
        const filter = expression.match(/\|\s*([A-Za-z]+)\s*$/)?.[1];
        assert.ok(filter != null && RENDER_FILTERS.includes(filter), `${file}: {{${expression}}}`);
      }
    }
  });

  test('js', () => {
    assert.equal(jsFilter('a "b" \\ c\nd'), '"a \\"b\\" \\\\ c\\nd"');
    assert.equal(jsFilter(false), 'false');
    assert.equal(jsFilter([ '/a/', '/b/' ]), '["/a/","/b/"]');
    assert.throws(() => jsFilter(undefined));
    assert.throws(() => jsFilter({ a: 1 }));
  });

  test('toml', () => {
    assert.equal(tomlFilter('My "site"'), '"My \\"site\\""');
    assert.equal(tomlFilter('a\\b\nc\td'), '"a\\\\b\\nc\\td"');
    assert.equal(tomlFilter('a\x7fb'), '"a\\u007Fb"');
    assert.throws(() => tomlFilter(undefined));
    assert.throws(() => tomlFilter(1));
  });

  test('tomlKey', () => {
    assert.equal(tomlKeyFilter('site-content'), 'site-content');
    assert.equal(tomlKeyFilter('site_content2'), 'site_content2');
    assert.equal(tomlKeyFilter('site.content'), '"site.content"');
    assert.equal(tomlKeyFilter('my store'), '"my store"');
  });

  test('line', () => {
    assert.equal(lineFilter('static-publisher'), 'static-publisher');
    assert.throws(() => lineFilter('a\nb'));
    assert.throws(() => lineFilter(undefined));
  });
});
