/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

import toml from 'toml';

import { addFastlyTomlSections, checkFastlyTomlSections } from '../../build/cli/cli/commands/scaffold/fastly-toml-sections.js';
import { generateApp } from '../../build/cli/cli/commands/scaffold/generate-app.js';
import { loadAppTemplate } from '../../build/cli/cli/commands/scaffold/app-template.js';
import { managedAppState } from '../../build/cli/cli/managed/app.js';
import { ConfigError } from '../../build/cli/cli/util/output.js';

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const base = {
  appDir: '/project/compute-js',
  name: 'site',
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
  autoIndex: [ 'index.html' ],
  autoExt: [],
  staticPublishVersionSpec: '<compute-js-static-publish>',
  template: loadAppTemplate('plain'),
  generatedFrom: undefined,
};
const s3 = { ...base, storage: { mode: 's3', region: 'us-east-1', bucket: 'b', endpointUrl: 'https://s3.example.com/', endpointGenerated: false } };

const fastlyTomlOf = (config) => generateApp(config)['fastly.toml'];
// The parser gives objects with a null prototype. JSON makes them plain.
const parseToml = (text) => JSON.parse(JSON.stringify(toml.parse(text)));

describe('addFastlyTomlSections()', () => {
  test('without sections, fastly.toml does not change', () => {
    assert.equal(fastlyTomlOf({ ...base, fastlyToml: {} }), fastlyTomlOf(base));
    assert.equal(fastlyTomlOf({ ...base, fastlyToml: { local_server: {} } }), fastlyTomlOf(base));
  });

  test('adds the resources after the sections of the CLI, as valid TOML', () => {
    const text = fastlyTomlOf({
      ...base,
      fastlyToml: {
        local_server: {
          secret_stores: { oauth: [ { key: 'GITHUB_CLIENT_SECRET', env: 'GITHUB_CLIENT_SECRET' } ] },
          config_stores: { site_config: { format: 'inline-toml', contents: { greeting: 'hello' } } },
          kv_stores: { sessions: [ { key: 'a', data: 'b' } ] },
          backends: { github: { url: 'https://github.com/' } },
        },
        setup: {
          secret_stores: { oauth: { description: 'OAuth', entries: { GITHUB_CLIENT_SECRET: { description: 'The client secret' } } } },
          kv_stores: { sessions: {} },
        },
      },
    });
    assert.ok(text.startsWith(fastlyTomlOf(base).trimEnd()), 'the text of the CLI comes first, unchanged');
    assert.match(text, /^\[\[local_server\.secret_stores\.oauth\]\]\nkey = "GITHUB_CLIENT_SECRET"\nenv = "GITHUB_CLIENT_SECRET"$/m);
    assert.match(text, /^\[setup\.kv_stores\.sessions\]$/m, 'an empty resource gets its header');
    const parsed = parseToml(text);
    assert.deepEqual(parsed.local_server.kv_stores['site-content'], { file: './static-publisher/kvstore.json', format: 'json' }, 'the content KV Store stays');
    assert.deepEqual(parsed.local_server.kv_stores.sessions, [ { key: 'a', data: 'b' } ]);
    assert.deepEqual(parsed.local_server.secret_stores.oauth, [ { key: 'GITHUB_CLIENT_SECRET', env: 'GITHUB_CLIENT_SECRET' } ]);
    assert.deepEqual(parsed.local_server.config_stores.site_config, { format: 'inline-toml', contents: { greeting: 'hello' } });
    assert.equal(parsed.local_server.backends.github.url, 'https://github.com/');
    assert.equal(parsed.setup.secret_stores.oauth.entries.GITHUB_CLIENT_SECRET.description, 'The client secret');
    assert.deepEqual(parsed.setup.kv_stores.sessions, {});
  });

  test('a table with values at the type level, where the CLI writes nothing', () => {
    const text = fastlyTomlOf({ ...base, fastlyToml: { local_server: { geolocation: { format: 'inline-toml', addresses: { '127.0.0.1': { as_name: 'test' } } } } } });
    assert.equal(toml.parse(text).local_server.geolocation.addresses['127.0.0.1'].as_name, 'test');
  });

  test('a resource with the name of one that the CLI writes is an error', () => {
    assert.throws(() => fastlyTomlOf({ ...base, fastlyToml: { local_server: { kv_stores: { 'site-content': { file: 'x.json', format: 'json' } } } } }),
      /managed\.fastlyToml\.local_server\.kv_stores\.site-content: the CLI writes this entry/);
    assert.throws(() => fastlyTomlOf({ ...base, fastlyToml: { local_server: { kv_stores: { 'site-content': [] } } } }),
      /managed\.fastlyToml\.local_server\.kv_stores\.site-content: the CLI writes this entry/);
    assert.throws(() => fastlyTomlOf({ ...base, fastlyToml: { local_server: { kv_stores: { 'site-content': {} } } } }), ConfigError);
    assert.throws(() => fastlyTomlOf({ ...s3, fastlyToml: { setup: { secret_stores: { S3_CREDENTIALS: {} } } } }),
      /managed\.fastlyToml\.setup\.secret_stores\.S3_CREDENTIALS: the CLI writes this entry/);
    assert.throws(() => fastlyTomlOf({ ...s3, fastlyToml: { local_server: { backends: { s3_storage: { url: 'https://x/' } } } } }),
      /backends\.s3_storage: the CLI writes this entry/);
  });

  test('values in a table that the CLI writes are an error', () => {
    assert.throws(() => addFastlyTomlSections(fastlyTomlOf(base), { local_server: { kv_stores: { format: 'json' } } }),
      /managed\.fastlyToml\.local_server\.kv_stores: the CLI writes this table/);
  });

  test('S3 mode: new secret stores and backends next to the ones of the CLI', () => {
    const text = fastlyTomlOf({ ...s3, fastlyToml: { local_server: { secret_stores: { oauth: [ { key: 'K', file: './secret.txt' } ] } } } });
    const parsed = parseToml(text);
    assert.equal(parsed.local_server.secret_stores.S3_CREDENTIALS.length, 2);
    assert.deepEqual(parsed.local_server.secret_stores.oauth, [ { key: 'K', file: './secret.txt' } ]);
  });
});

describe('checkFastlyTomlSections()', () => {
  const check = (value) => {
    const errors = [];
    checkFastlyTomlSections(value, errors);
    return errors;
  };

  test('valid sections', () => {
    assert.deepEqual(check({ local_server: { secret_stores: { a: [ { key: 'k', env: 'E' } ] } }, setup: {} }), []);
  });

  test('errors', () => {
    assert.match(check([]).join('\n'), /managed\.fastlyToml, if specified, must be an object/);
    assert.match(check({ scripts: {} }).join('\n'), /managed\.fastlyToml\.scripts: only local_server and setup can be added/);
    assert.match(check({ local_server: 'x' }).join('\n'), /managed\.fastlyToml\.local_server must be an object/);
    assert.match(check({ local_server: { secret_stores: [] } }).join('\n'), /local_server\.secret_stores must be an object/);
    assert.match(check({ local_server: { backends: { b: { url: () => 'x' } } } }).join('\n'), /local_server\.backends\.b\.url: the value cannot be written/);
    assert.match(check({ local_server: { kv_stores: { s: [ { key: 'a' }, 'b' ] } } }).join('\n'), /kv_stores\.s: an array must have only objects, or no objects/);
    assert.match(check({ setup: { backends: { b: { port: Infinity } } } }).join('\n'), /setup\.backends\.b\.port: the value cannot be written/);
  });
});

describe('the fingerprint and managed.fastlyToml', () => {
  // A managed KV Store project in a temp dir, as loadProjectFile() returns it.
  function project(fastlyToml) {
    return {
      rc: { kvStoreName: 'site-content', publishId: 'default', defaultCollectionName: 'live', staticPublisherWorkingDir: './static-publisher' },
      publishContent: { rootDir: './public' },
      managed: { name: 'site', authors: [ 'you@example.com' ], description: 'd', template: 'plain', staticPublishVersion: '8.1.0', fastlyToml },
    };
  }
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cjsp-unit-fastly-toml-'));
  tempDirs.push(projectDir);
  fs.mkdirSync(path.join(projectDir, 'public'));
  const fingerprint = async (fastlyToml) => (await managedAppState(projectDir, project(fastlyToml))).fingerprint;

  test('local_server does not change it; setup does', async () => {
    const none = await fingerprint(undefined);
    assert.equal(await fingerprint({ local_server: { secret_stores: { oauth: [ { key: 'K', env: 'K' } ] } } }), none);
    assert.notEqual(await fingerprint({ setup: { secret_stores: { oauth: {} } } }), none);
  });

  test('the generated fastly.toml has local_server', async () => {
    const { files } = await managedAppState(projectDir, project({ local_server: { secret_stores: { oauth: [ { key: 'K', env: 'K' } ] } } }));
    assert.match(files['fastly.toml'], /\[\[local_server\.secret_stores\.oauth\]\]/);
  });
});
