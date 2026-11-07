/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { generateApp } from '../../build/cli/cli/commands/scaffold/generate-app.js';
import { addGitignoreLines } from '../../build/cli/cli/commands/scaffold/index.js';
import { loadAppTemplate } from '../../build/cli/cli/commands/scaffold/app-template.js';
import {
  SERVICE_ID_PLACEHOLDER_LINE,
  appConfigFromProject,
  renderProjectFile,
} from '../../build/cli/cli/managed/project-file.js';
import {
  detectProjectMode,
  normalizeProjectManaged,
  normalizePublishContentConfig,
  normalizeStaticPublisherRc,
} from '../../build/cli/cli/util/config.js';
import { loadServiceId } from '../../build/cli/cli/util/service-id.js';

const tempDirs = [];
function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cjsp-unit-project-'));
  tempDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('addGitignoreLines', () => {
  const lines = [ '/.static-publish/', '/static-publisher/' ];

  test('a new file', () => {
    assert.deepEqual(addGitignoreLines(null, lines), {
      content: '# @fastly/compute-js-static-publish\n/.static-publish/\n/static-publisher/\n',
      added: lines,
    });
  });

  test('adds only the missing lines, at the end, and keeps the user lines', () => {
    const { content, added } = addGitignoreLines('node_modules\n/static-publisher/', lines);
    assert.deepEqual(added, [ '/.static-publish/' ]);
    assert.equal(content, 'node_modules\n/static-publisher/\n\n# @fastly/compute-js-static-publish\n/.static-publish/\n');
  });

  test('nothing to add', () => {
    const existing = '/.static-publish/\n/static-publisher/\n';
    assert.deepEqual(addGitignoreLines(existing, lines), { content: existing, added: [] });
  });
});

describe('detectProjectMode', () => {
  test('by the names of the files', () => {
    const dir = makeTempDir();
    assert.equal(detectProjectMode(dir), 'scaffold');
    fs.writeFileSync(path.join(dir, 'static-publish.rc.js'), '');
    assert.equal(detectProjectMode(dir), 'ejected');
    fs.writeFileSync(path.join(dir, 'static-publish.project.js'), '');
    assert.equal(detectProjectMode(dir), 'conflict');
    fs.rmSync(path.join(dir, 'static-publish.rc.js'));
    assert.equal(detectProjectMode(dir), 'managed');
  });
});

describe('managed section', () => {
  test('accepts the fields', () => {
    const errors = [];
    const managed = { name: 'a', description: 'b', authors: [ 'c' ], template: 'plain', serviceId: undefined, staticPublishVersion: '8.1.0', fastlyToml: { local_server: { secret_stores: { s: [ { key: 'k', env: 'E' } ] } } } };
    assert.deepEqual(normalizeProjectManaged(managed, errors), managed);
    assert.deepEqual(errors, []);
  });

  test('refuses wrong types', () => {
    const errors = [];
    assert.equal(normalizeProjectManaged({ name: 1, authors: 'me' }, errors), null);
    assert.match(errors.join('\n'), /managed.name/);
    assert.match(errors.join('\n'), /managed.authors/);
  });
});

describe('loadServiceId', () => {
  test('managed.serviceId comes after the flag and the environment, before fastly.toml', () => {
    const saved = process.env.FASTLY_SERVICE_ID;
    delete process.env.FASTLY_SERVICE_ID;
    try {
      assert.deepEqual(loadServiceId({ commandLine: undefined, fastlyTomlPath: '/nope/fastly.toml', projectServiceId: 'P' }), { serviceId: 'P', source: 'managed.serviceId' });
      assert.equal(loadServiceId({ commandLine: 'F', fastlyTomlPath: '/nope', projectServiceId: 'P' }).serviceId, 'F');
      process.env.FASTLY_SERVICE_ID = 'E';
      assert.equal(loadServiceId({ commandLine: undefined, fastlyTomlPath: '/nope', projectServiceId: 'P' }).serviceId, 'E');
    } finally {
      if (saved == null) {
        delete process.env.FASTLY_SERVICE_ID;
      } else {
        process.env.FASTLY_SERVICE_ID = saved;
      }
    }
  });
});

// One config, two paths: the app config of scaffold flags, written as a
// project file and read back, gives the same app.
describe('project file round trip', () => {
  const base = {
    appDir: '/project/compute-js',
    name: 'golden',
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
    notFoundPageFilename: '/project/public/404.html',
    autoIndex: [ 'index.html', 'index.htm' ],
    autoExt: [ '.html', '.htm' ],
    staticPublishVersionSpec: '<compute-js-static-publish>',
    template: loadAppTemplate('plain'),
    generatedFrom: undefined,
  };
  const cases = {
    'kv-basic': base,
    'kv-full': {
      ...base, name: 'my-site', author: 'me@example.com', description: 'My site', serviceId: 'SVC123', publishId: 'pub1',
      staticDirs: [ '/project/public/static' ], spaFilename: '/project/public/spa.html', autoIndex: [ 'index.htm' ], autoExt: [ '.htm' ],
    },
    'kv-public-dir': { ...base, rootDir: '/project/site', publicDir: '/project/site/public', notFoundPageFilename: undefined },
    'working dir outside the app': { ...base, staticPublisherWorkingDir: '/project/static-publisher' },
    'kv-collection-selection': {
      ...base,
      collectionSelection: {
        sources: [ { type: 'host', pattern: '{collection}.preview.example.com' }, { type: 'query', param: 'collection', sticky: 'cookie' }, { type: 'cookie', maxAge: 604800 } ],
        allow: [ 'pr-*' ],
        onMissing: 'default',
        noindex: false,
      },
    },
    's3-endpoint': { ...base, storage: { mode: 's3', region: 'us-east-1', bucket: 'my-bucket', endpointUrl: 'https://s3.example.com/', endpointGenerated: false } },
    's3-aws': { ...base, storage: { mode: 's3', region: 'us-east-1', bucket: 'my-bucket', endpointUrl: 'https://my-bucket.s3.us-east-1.amazonaws.com/', endpointGenerated: true } },
    'managed.fastlyToml': {
      ...base,
      fastlyToml: {
        local_server: { secret_stores: { oauth: [ { key: 'GITHUB_CLIENT_SECRET', env: 'GITHUB_CLIENT_SECRET' } ] } },
        setup: { secret_stores: { oauth: { entries: { GITHUB_CLIENT_SECRET: { description: 'The client secret' } } } } },
      },
    },
  };

  for (const [ name, config ] of Object.entries(cases)) {
    test(name, async () => {
      const text = renderProjectFile(config, '/project', '8.1.0');
      const dir = makeTempDir();
      const file = path.join(dir, `${name}.project.js`);
      fs.writeFileSync(file, text);
      const raw = (await import(pathToFileURL(file).href)).default;

      const errors = [];
      const rc = normalizeStaticPublisherRc(raw, errors);
      const publishContent = normalizePublishContentConfig(raw.publishContent, errors);
      const managed = normalizeProjectManaged(raw.managed, errors);
      assert.deepEqual(errors, []);
      assert.equal(raw.managed.staticPublishVersion, '8.1.0');
      assert.equal(raw.managed.template, 'plain');

      const back = appConfigFromProject(rc, publishContent, managed, {
        projectDir: '/project',
        appDir: config.appDir,
        staticPublishVersionSpec: config.staticPublishVersionSpec,
        template: config.template,
        s3EndpointUrl: config.storage.mode === 's3' && config.storage.endpointGenerated ? config.storage.endpointUrl : undefined,
      });
      assert.deepEqual(back, config);
      assert.deepEqual(generateApp(back), generateApp(config));
    });
  }

  test('managed.template must be the name of a template', () => {
    const errors = [];
    assert.equal(normalizeProjectManaged({ template: 'next' }, errors), null);
    assert.match(errors.join('\n'), /managed\.template must be one of: plain, hono/);
    assert.equal(normalizeProjectManaged({ template: 'hono' }, []).template, 'hono');
    assert.deepEqual(normalizeProjectManaged({}, []), { name: undefined, description: undefined, authors: undefined, template: undefined, serviceId: undefined, staticPublishVersion: undefined, fastlyToml: undefined });
  });

  test('the service ID line is the marked line, unless a service ID is set', () => {
    assert.ok(renderProjectFile(base, '/project', '8.1.0').split('\n').includes(SERVICE_ID_PLACEHOLDER_LINE));
    assert.match(renderProjectFile({ ...base, serviceId: 'SVC' }, '/project', '8.1.0'), /^ {4}serviceId: "SVC",$/m);
  });

  test('the generated rc of a managed app has only the top-level fields', () => {
    const files = generateApp({ ...base, appDir: '/project/.static-publish/app' });
    const rcText = files['static-publish.rc.js'];
    for (const field of [ 'publishContent', 'managed', 'generatedFrom', 'build' ]) {
      assert.doesNotMatch(rcText, new RegExp(`\\b${field}\\b`), field);
    }
  });
});
