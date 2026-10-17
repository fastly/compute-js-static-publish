/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Checks that PublisherServer keeps the state of a request in a scope for each
// request. `fastly compute serve` starts a new sandbox for each request, so the
// test app handles two requests of its own in one sandbox: one PublisherServer
// serves two Request objects, as in a reused sandbox. Needs the Fastly CLI and
// network access for `npm install`. No credentials are necessary.

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
} from './helpers.js';

// The app counts the reads of the index from storage, and returns the state
// that it sees after each step as JSON.
const TEST_APP_INDEX = `\
/// <reference types="@fastly/js-compute" />
import { PublisherServer } from '@fastly/compute-js-static-publish';
import rc from '../static-publish.rc.js';

const server = PublisherServer.fromStaticPublishRc(rc);
server.setServerTimingRequestHeader('x-server-timing');

let indexReads = 0;
const getEntry = server.storageProvider.getEntry.bind(server.storageProvider);
server.storageProvider.getEntry = (key, tags) => {
  if (key.includes('_index_')) {
    indexReads++;
  }
  return getEntry(key, tags);
};

function state() {
  return {
    indexReads,
    settings: server.settingsCached === undefined ? 'not-read' : server.settingsCached === null ? 'null' : 'read',
    index: server.assetEntryMapCache === undefined ? 'not-read' : server.assetEntryMapCache === null ? 'null' : 'read',
    serverTiming: server.serverTiming != null,
  };
}

addEventListener('fetch', (event) => event.respondWith(handleRequest(event)));
async function handleRequest(event) {
  const origin = new URL(event.request.url).origin;
  const results = {};

  const first = new Request(origin + '/', { headers: { 'x-server-timing': '1' } });
  results.firstStatus = (await server.serveRequest(first))?.status ?? null;
  results.afterFirst = state();

  // The same request again: its scope already has the index.
  server.beginRequest(first);
  await server.getMatchingAsset('/index.html');
  results.firstAgain = state();

  // A new request: a new scope.
  const second = new Request(origin + '/about.html');
  server.beginRequest(second);
  results.afterBeginSecond = state();
  results.secondStatus = (await server.serveRequest(second))?.status ?? null;
  results.afterSecond = state();

  // Another collection: a new scope.
  server.setActiveCollectionName('copy');
  results.afterSetCollection = state();
  results.copyAsset = (await server.getMatchingAsset('/index.html')) != null;
  results.afterCopy = state();
  server.setActiveCollectionName(null);

  return new Response(JSON.stringify(results), { headers: { 'content-type': 'application/json' } });
}
`;

describe('PublisherServer keeps the state of each request in its own scope', { skip: skipUnlessFastlyCli() }, () => {
  let dir;
  let computeJsDir;
  let server;
  let results;

  before(async () => {
    dir = makeTempDir('request-scope');
    writeFixtureContent(path.resolve(dir, 'public'));
    computeJsDir = scaffoldApp(dir, [ '--kv-store-name', 'e2e-content' ]);
    fs.writeFileSync(path.resolve(computeJsDir, 'src/index.js'), TEST_APP_INDEX);
    runCli([ 'publish-content', '--local' ], { cwd: computeJsDir });
    runCli([ 'collections', 'promote', '--collection-name', 'live', '--to', 'copy', '--local' ], { cwd: computeJsDir });
    server = await startServe(computeJsDir);
    const res = await rawRequest(server.baseUrl + '/');
    assert.equal(res.status, 200, res.body.toString());
    results = JSON.parse(res.body.toString());
  });

  after(async () => {
    await server?.stop();
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('serves both requests', () => {
    assert.equal(results.firstStatus, 200);
    assert.equal(results.secondStatus, 200);
  });

  test('the deprecated getters return the state of the current scope', () => {
    assert.deepEqual(results.afterFirst, { indexReads: 1, settings: 'read', index: 'read', serverTiming: true });
  });

  test('two calls for one request read the index one time', () => {
    assert.deepEqual(results.firstAgain, { indexReads: 1, settings: 'read', index: 'read', serverTiming: true });
  });

  test('a new request does not use the state of the previous request', () => {
    assert.deepEqual(results.afterBeginSecond, { indexReads: 1, settings: 'not-read', index: 'not-read', serverTiming: false });
    assert.deepEqual(results.afterSecond, { indexReads: 2, settings: 'read', index: 'read', serverTiming: false });
  });

  test('another collection gets a new scope', () => {
    assert.deepEqual(results.afterSetCollection, { indexReads: 2, settings: 'not-read', index: 'not-read', serverTiming: false });
    assert.equal(results.copyAsset, true);
    assert.deepEqual(results.afterCopy, { indexReads: 3, settings: 'read', index: 'read', serverTiming: false });
  });
});
