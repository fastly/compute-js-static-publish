/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Publishes an index that is large enough to be split into parts, with --local,
// and serves it with `fastly compute serve`. Makes sure that the server reads
// one part and not the full index, that it uses the full index if a part is
// missing, and that `clean` deletes the parts that no index uses. Also makes
// sure that hidden files work with index parts: the key of a hidden file
// (hidden:<asset key>) can be in another part than its asset key. Needs the
// Fastly CLI and network access for `npm install`. No credentials are necessary.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import {
  makeTempDir,
  rawRequest,
  removeDir,
  runCli,
  scaffoldApp,
  skipUnlessFastlyCli,
  startServe,
  writeFixtureContent,
  writeTestAppIndex,
} from './helpers.js';
import { checkResponseCache, checkServedContent } from './served-content.js';
import {
  getIndexPartNumber,
  INDEX_PARTS_MIN_ENTRIES,
  parseIndexPartKey,
} from '../../build/cli/models/index-parts/index.js';

// More files than INDEX_PARTS_MIN_ENTRIES, so that the index is split.
const EXTRA_FILE_COUNT = INDEX_PARTS_MIN_ENTRIES + 100;

function writeExtraFiles(publicDir, version) {
  const dir = path.resolve(publicDir, 'many');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < EXTRA_FILE_COUNT; i++) {
    fs.writeFileSync(path.resolve(dir, `page-${i}.txt`), `page ${i} ${version}\n`);
  }
}

const serverTimingNames = (res) =>
  (res.headers['server-timing'] ?? '').split(',').map(x => x.trim().split(';')[0]).filter(x => x !== '');

describe('local mode with index parts', { skip: skipUnlessFastlyCli() }, () => {
  let dir;
  let publicDir;
  let computeJsDir;
  let kvStoreJsonPath;
  let server;
  let publishOutput;

  const readKvStoreJson = () => JSON.parse(fs.readFileSync(kvStoreJsonPath, 'utf-8'));
  const partKeys = () => Object.keys(readKvStoreJson()).filter(key => parseIndexPartKey('default', key) != null);

  before(async () => {
    dir = makeTempDir('index-parts');
    publicDir = path.resolve(dir, 'public');
    writeFixtureContent(publicDir);
    writeExtraFiles(publicDir, 'v1');
    computeJsDir = scaffoldApp(dir, [ '--kv-store-name', 'e2e-content' ]);
    kvStoreJsonPath = path.resolve(computeJsDir, 'static-publisher/kvstore.json');
    writeTestAppIndex(computeJsDir);
    publishOutput = runCli([ 'publish-content', '--local' ], { cwd: computeJsDir }).output;
    server = await startServe(computeJsDir);
  });

  after(async () => {
    await server?.stop();
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('writes the index parts', () => {
    assert.match(publishOutput, /index parts: \d+ saved/);
    const keys = partKeys();
    assert.ok(keys.length > 1, `has index parts: ${keys.length}`);
    const index = readKvStoreJson()['default_index_live'];
    const indexParts = index.metadata?.indexParts ?? JSON.parse(index.metadata ?? '{}').indexParts;
    assert.match(String(indexParts), /^\d+:[0-9a-f]{64}$/, 'the index metadata points to the parts');
  });

  test('serves the published content', async (t) => {
    await checkServedContent(t, server.baseUrl);
  });

  test('caches responses with the response cache', async (t) => {
    await checkResponseCache(t, server.baseUrl);
  });

  test('reads one index part, not the full index', async () => {
    const res = await rawRequest(server.baseUrl + '/many/page-7.txt', { headers: { 'x-server-timing': '1' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.toString(), 'page 7 v1\n');
    const names = serverTimingNames(res);
    assert.ok(names.includes('index-part'), `Server-Timing: ${res.headers['server-timing']}`);
    assert.ok(!names.includes('index-body'), `Server-Timing: ${res.headers['server-timing']}`);
  });

  test('uses the full index if a part is missing', async () => {
    // Remove the part of /about.html from the local KV Store, and start the
    // server again, so that it reads the changed file.
    const keys = partKeys();
    const { count } = parseIndexPartKey('default', keys[0]);
    const partNumber = getIndexPartNumber('/about.html', count);
    const keyToRemove = keys.find(key => parseIndexPartKey('default', key).partNumber === partNumber);
    const kvStoreJson = readKvStoreJson();
    delete kvStoreJson[keyToRemove];
    fs.writeFileSync(kvStoreJsonPath, JSON.stringify(kvStoreJson));
    await server.stop();
    server = await startServe(computeJsDir);

    const res = await rawRequest(server.baseUrl + '/about', { headers: { 'x-server-timing': '1' } });
    assert.equal(res.status, 200);
    assert.match(res.body.toString(), /About/);
    assert.ok(serverTimingNames(res).includes('index-body'), `Server-Timing: ${res.headers['server-timing']}`);
  });

  test('clean deletes the parts that no index uses', () => {
    const oldKeys = partKeys();
    writeExtraFiles(publicDir, 'v2');
    runCli([ 'publish-content', '--local' ], { cwd: computeJsDir });
    const keysAfterPublish = partKeys();
    const newKeys = keysAfterPublish.filter(key => !oldKeys.includes(key));
    assert.ok(newKeys.length > 0, 'the new index has new parts');

    runCli([ 'clean', '--local' ], { cwd: computeJsDir });
    const keysAfterClean = partKeys();
    assert.deepEqual(keysAfterClean.sort(), newKeys.sort());
  });
});

// A request with `x-get-asset: <key>` calls getMatchingAsset(key, { includeHidden: true }).
const HIDDEN_TEST_APP_INDEX = `\
/// <reference types="@fastly/js-compute" />
import { PublisherServer } from '@fastly/compute-js-static-publish';
import rc from '../static-publish.rc.js';

const server = PublisherServer.fromStaticPublishRc(rc);
server.setServerTimingRequestHeader('x-server-timing');

addEventListener('fetch', (event) => event.respondWith(handleRequest(event)));
async function handleRequest(event) {
  const request = event.request;
  const key = request.headers.get('x-get-asset');
  if (key != null) {
    server.beginRequest(request);
    const asset = await server.getMatchingAsset(key, { includeHidden: true });
    if (asset == null) {
      return new Response('No asset (app)', { status: 404 });
    }
    return server.serveAsset(request, asset);
  }
  const response = await server.serveRequest(request);
  if (response != null) {
    return response;
  }
  return new Response('Not found (app)', { status: 404 });
}
`;

// The hidden files. With several parts, the hidden: key of most of them is in
// another part than the asset key.
const HIDDEN_FILE_COUNT = 20;

describe('local mode with index parts and hidden files', { skip: skipUnlessFastlyCli() }, () => {
  let dir;
  let computeJsDir;
  let kvStoreJsonPath;
  let server;

  const readKvStoreJson = () => JSON.parse(fs.readFileSync(kvStoreJsonPath, 'utf-8'));
  const partCount = () => {
    const key = Object.keys(readKvStoreJson()).find(key => parseIndexPartKey('default', key) != null);
    return parseIndexPartKey('default', key).count;
  };

  before(async () => {
    dir = makeTempDir('index-parts-hidden');
    const publicDir = path.resolve(dir, 'public');
    writeFixtureContent(publicDir);
    writeExtraFiles(publicDir, 'v1');
    fs.mkdirSync(path.resolve(publicDir, 'secret'), { recursive: true });
    for (let i = 0; i < HIDDEN_FILE_COUNT; i++) {
      fs.writeFileSync(path.resolve(publicDir, `secret/page-${i}.html`), `<!doctype html><h1>Secret ${i}</h1>`);
    }
    computeJsDir = scaffoldApp(dir, [ '--kv-store-name', 'e2e-content' ]);
    kvStoreJsonPath = path.resolve(computeJsDir, 'static-publisher/kvstore.json');
    fs.writeFileSync(path.resolve(computeJsDir, 'src/index.js'), HIDDEN_TEST_APP_INDEX);

    const configPath = path.resolve(computeJsDir, 'publish-content.config.js');
    const config = fs.readFileSync(configPath, 'utf-8').replace(
      /^ {2}rootDir: .*$/m,
      `$&
  hiddenItems: [ '/secret/', '/404.html' ],`,
    );
    assert.match(config, /hiddenItems/);
    fs.writeFileSync(configPath, config);

    runCli([ 'publish-content', '--local' ], { cwd: computeJsDir });
    server = await startServe(computeJsDir);
  });

  after(async () => {
    await server?.stop();
    if (dir != null) {
      removeDir(dir);
    }
  });

  // A hidden file whose hidden: key is in another part than its asset key.
  const hiddenKeyInOtherPart = () => {
    const count = partCount();
    for (let i = 0; i < HIDDEN_FILE_COUNT; i++) {
      const assetKey = `/secret/page-${i}.html`;
      if (getIndexPartNumber(assetKey, count) !== getIndexPartNumber(`hidden:${assetKey}`, count)) {
        return { assetKey, i };
      }
    }
    assert.fail(`No hidden file has its hidden: key in another part (${count} parts).`);
  };

  test('a request does not get a hidden file, and reads a part, not the full index', async () => {
    const { assetKey } = hiddenKeyInOtherPart();
    const res = await rawRequest(server.baseUrl + assetKey, { headers: { 'x-server-timing': '1' } });
    assert.equal(res.status, 404);
    assert.doesNotMatch(res.body.toString(), /Secret/);
    const names = serverTimingNames(res);
    assert.ok(names.includes('index-part'), `Server-Timing: ${res.headers['server-timing']}`);
    assert.ok(!names.includes('index-body'), `Server-Timing: ${res.headers['server-timing']}`);
  });

  test('getMatchingAsset() with includeHidden finds a hidden: key in another part', async () => {
    const { assetKey, i } = hiddenKeyInOtherPart();
    const res = await rawRequest(server.baseUrl + '/', { headers: { 'x-get-asset': assetKey, 'x-server-timing': '1' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.toString(), `<!doctype html><h1>Secret ${i}</h1>`);
    assert.ok(!serverTimingNames(res).includes('index-body'), `Server-Timing: ${res.headers['server-timing']}`);
  });

  test('the hidden 404 page is the fallback page', async () => {
    const res = await rawRequest(server.baseUrl + '/no-such-page', { headers: { accept: 'text/html', 'x-server-timing': '1' } });
    assert.equal(res.status, 404);
    assert.match(res.body.toString(), /Not found/);
    assert.doesNotMatch(res.body.toString(), /\(app\)/);
    assert.ok(!serverTimingNames(res).includes('index-body'), `Server-Timing: ${res.headers['server-timing']}`);
  });
});
