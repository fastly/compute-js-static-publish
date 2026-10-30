/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Compares the output of generateApp() with the golden files in test/golden/.
// To update the golden files after an intended change, run the tests with
// UPDATE_GOLDEN=1, and check the diff of test/golden/.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadAppTemplate } from '../../build/cli/cli/commands/scaffold/app-template.js';
import { generateApp } from '../../build/cli/cli/commands/scaffold/generate-app.js';
import toml from 'toml';

const GOLDEN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../golden');
const UPDATE = process.env.UPDATE_GOLDEN === '1';

// A .gitignore in test/golden/ would make git ignore golden files, so the
// golden copy of a .gitignore is named _gitignore.
const toGoldenName = (name) => name.replace(/(^|\/)\.gitignore$/, '$1_gitignore');

// The settings that the scaffolder makes from its defaults, with the
// fixture of the golden cases: a project in /project, with ./public.
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
  generatedFrom: { template: 'plain', staticPublishVersion: '<static-publish-version>', generatedAt: '<generated-at>' },
};

const cases = {
  'kv-basic': base,
  'kv-full': {
    ...base,
    name: 'my-site',
    author: 'me@example.com',
    description: 'My site',
    serviceId: 'SVC123',
    publishId: 'pub1',
    staticDirs: [ '/project/public/static' ],
    spaFilename: '/project/public/spa.html',
    autoIndex: [ 'index.htm' ],
    autoExt: [ '.htm' ],
  },
  'kv-public-dir': {
    ...base,
    rootDir: '/project/site',
    publicDir: '/project/site/public',
    notFoundPageFilename: undefined,
  },
  'kv-default-collection': {
    ...base,
    defaultCollectionName: 'production',
  },
  'kv-escaping': {
    ...base,
    name: 'my-site',
    author: 'Me "Myself" <me@example.com>',
    description: 'A site with \\ and "quotes"',
    storage: { mode: 'kv-store', kvStoreName: 'site.content' },
  },
  's3-endpoint': {
    ...base,
    storage: { mode: 's3', region: 'us-east-1', bucket: 'my-bucket', endpointUrl: 'https://s3.example.com/', endpointGenerated: false },
  },
  's3-aws': {
    ...base,
    storage: { mode: 's3', region: 'us-east-1', bucket: 'my-bucket', endpointUrl: 'https://my-bucket.s3.us-east-1.amazonaws.com/', endpointGenerated: true },
  },
};

function readGolden(dir) {
  const files = {};
  const walk = (sub) => {
    for (const entry of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
      const rel = path.posix.join(sub, entry.name);
      if (entry.isDirectory()) {
        walk(rel);
      } else {
        files[rel] = fs.readFileSync(path.join(dir, rel), 'utf-8');
      }
    }
  };
  walk('');
  return files;
}

describe('generateApp() golden files', () => {
  for (const [ name, config ] of Object.entries(cases)) {
    test(name, () => {
      const generated = {};
      for (const [ file, content ] of Object.entries(generateApp(config))) {
        generated[toGoldenName(path.posix.normalize(file))] = content;
      }
      const dir = path.join(GOLDEN_DIR, name);
      if (UPDATE) {
        fs.rmSync(dir, { recursive: true, force: true });
        for (const [ file, content ] of Object.entries(generated)) {
          fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
          fs.writeFileSync(path.join(dir, file), content);
        }
        return;
      }
      const golden = readGolden(dir);
      assert.deepEqual(Object.keys(generated).sort(), Object.keys(golden).sort(), 'the list of files');
      for (const file of Object.keys(golden)) {
        assert.equal(generated[file], golden[file], file);
      }
    });
  }
});

describe('generateApp() writes a valid fastly.toml', () => {
  for (const [ name, config ] of Object.entries(cases)) {
    test(name, () => {
      const parsed = toml.parse(generateApp(config)['fastly.toml']);
      assert.equal(parsed.name, config.name);
      assert.equal(parsed.description, config.description);
      assert.deepEqual(parsed.authors, [ config.author ]);
      if (config.storage.mode === 'kv-store') {
        assert.ok(config.storage.kvStoreName in parsed.setup.kv_stores);
        assert.ok(config.storage.kvStoreName in parsed.local_server.kv_stores);
      }
    });
  }
});
