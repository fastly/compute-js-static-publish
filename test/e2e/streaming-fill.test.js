/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Checks serveRequestStreaming() and serveCachedStreaming():
// - In Viceroy, with the js-compute of the template and with 4.1. The fill
//   reads the whole body first in both, because Viceroy keeps an abandoned
//   fill. Needs the Fastly CLI and network access for `npm install`.
// - On a real service, with the js-compute of the template (4.2 or later).
//   The fill streams. This replaces the active version of the test service.
//   It needs the environment variables of deployed.test.js.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  makeTempDir,
  removeDir,
  run,
  runCli,
  scaffoldApp,
  skipUnlessEnv,
  skipUnlessFastlyCli,
  startServe,
  uniquePublishId,
  writeFixtureContent,
} from './helpers.js';

// Routes:
// - /sdk: fastly.sdkVersion and FASTLY_HOSTNAME.
// - /custom/<name>?body=<text>&length=<n | null | none>: serveCachedStreaming()
//   with a produce() that returns { response, length } with that body and length.
//   The response has x-produced, a value that is new for each produce() call.
// - Other paths: serveRequestStreaming().
// Each route passes fillPromise to event.waitUntil().
const TEST_APP_INDEX = `\
/// <reference types="@fastly/js-compute" />
import { env } from 'fastly:env';
import { PublisherServer } from '@fastly/compute-js-static-publish';
import rc from '../static-publish.rc.js';

const publisherServer = PublisherServer.fromStaticPublishRc(rc);
publisherServer.setServerTimingRequestHeader('x-server-timing');
publisherServer.setResponseCache({ maxAge: 600 });

addEventListener('fetch', (event) => event.respondWith(handleRequest(event)));
async function handleRequest(event) {
  const request = event.request;
  const url = new URL(request.url);
  if (url.pathname === '/sdk') {
    return new Response(JSON.stringify({ sdkVersion: fastly.sdkVersion, hostname: env('FASTLY_HOSTNAME') }));
  }
  let served;
  if (url.pathname.startsWith('/custom/')) {
    publisherServer.beginRequest(request);
    const body = url.searchParams.get('body') ?? '';
    const lengthParam = url.searchParams.get('length');
    const length = lengthParam === 'null' ? null : lengthParam === 'none' ? undefined : Number(lengthParam);
    served = await publisherServer.serveCachedStreaming(request, url.pathname, async () => {
      return { response: new Response(body, { headers: { 'x-produced': crypto.randomUUID() } }), length };
    });
  } else {
    served = await publisherServer.serveRequestStreaming(request);
  }
  event.waitUntil(served.fillPromise);
  return served.response ?? new Response('Not found (app)', { status: 404 });
}
`;

// A request that also reports a response that ends with an error, or a
// connection that is reset before the response (complete: false, status: null).
function request(url, { method = 'GET', headers = {} } = {}) {
  const client = new URL(url).protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(url, { method, headers: { 'x-server-timing': '1', ...headers } }, (response) => {
      const chunks = [];
      let failed = false;
      const done = () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString(),
        complete: response.complete && !failed,
      });
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('error', () => { failed = true; });
      response.on('close', done);
    });
    req.on('error', (err) => {
      if (err.code === 'ECONNRESET') {
        resolve({ status: null, headers: {}, body: '', complete: false });
      } else {
        reject(err);
      }
    });
    req.end();
  });
}

function cacheResult(response) {
  return /\bcache;dur=[\d.]+;desc="([^"]*)"/.exec(response.headers['server-timing'] ?? '')?.[1];
}

// The tests for one app. app() gives { baseUrl, getOutput }; getOutput is null
// for a real service. streams is true if the fill streams.
function streamingFillTests({ app, streams, settleMs, checkSdk }) {
  const get = (urlPath, options) => request(app().baseUrl + urlPath, options);
  // Waits until the fill of the last request ends. The fill runs in waitUntil().
  const settle = () => sleep(settleMs);

  test('the app runs the expected js-compute', async () => {
    const response = await get('/sdk');
    checkSdk(JSON.parse(response.body));
  });

  test('serveRequestStreaming() caches a file', async () => {
    const first = await get('/about.html');
    assert.equal(first.status, 200);
    assert.equal(first.complete, true);
    assert.match(first.body, /<h1>About<\/h1>/);
    assert.equal(cacheResult(first), 'miss');
    await settle();

    const second = await get('/about.html');
    assert.equal(second.body, first.body);
    assert.match(cacheResult(second) ?? '', /^hit /);
  });

  test('a HEAD request fills the entry for the next GET', async () => {
    const head = await get('/', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
    assert.equal(cacheResult(head), 'miss');
    await settle();

    const response = await get('/');
    assert.equal(response.complete, true);
    assert.match(response.body, /<h1>Home<\/h1>/);
    assert.match(cacheResult(response) ?? '', /^hit /);
  });

  test('a missing file is cached as not found', async () => {
    const first = await get('/no-such-file.txt');
    assert.equal(first.status, 404);
    assert.equal(cacheResult(first), 'miss');
    await settle();
    const second = await get('/no-such-file.txt');
    assert.equal(second.status, 404);
    assert.match(cacheResult(second) ?? '', /^hit /);
  });

  test('length: null is not cached', async () => {
    const first = await get('/custom/null?body=hello&length=null');
    assert.equal(first.body, 'hello');
    await settle();
    const second = await get('/custom/null?body=hello&length=null');
    assert.equal(second.body, 'hello');
    assert.ok(first.headers['x-produced']);
    assert.notEqual(second.headers['x-produced'], first.headers['x-produced']);
  });

  test('a length that is not known is cached', async () => {
    const first = await get('/custom/none?body=hello&length=none');
    assert.equal(first.body, 'hello');
    assert.equal(cacheResult(first), 'miss');
    await settle();
    const second = await get('/custom/none?body=hello&length=none');
    assert.equal(second.body, 'hello');
    assert.match(cacheResult(second) ?? '', /^hit /);
  });

  test('a correct length is cached', async () => {
    const first = await get('/custom/ok?body=hello&length=5');
    assert.equal(first.complete, true);
    assert.equal(first.body, 'hello');
    await settle();
    const second = await get('/custom/ok?body=hello&length=5');
    assert.equal(second.body, 'hello');
    assert.match(cacheResult(second) ?? '', /^hit /);
  });

  for (const [ name, length ] of [ [ 'short', 10 ], [ 'long', 3 ] ]) {
    test(`a body that is ${name} for its length is not cached, and the next fill reads the whole body`, async () => {
      const url = `/custom/${name}?body=hello&length=${length}`;
      const first = await get(url);
      if (streams) {
        assert.ok(!(first.complete && first.body === 'hello'), `unexpected complete body: ${JSON.stringify(first)}`);
      } else {
        // A fill that does not stream reads the body, and does not use length.
        assert.equal(first.complete, true);
        assert.equal(first.body, 'hello');
      }
      await settle();

      const second = await get(url);
      assert.equal(second.complete, true);
      assert.equal(second.body, 'hello');
      assert.match(cacheResult(second) ?? '', streams ? /^miss$/ : /^hit /);
      await settle();

      const third = await get(url);
      assert.equal(third.body, 'hello');
      assert.match(cacheResult(third) ?? '', /^hit /);

      const output = app().getOutput?.();
      if (streams && output != null) {
        assert.match(output, new RegExp(`fill of '[^']*/custom/${name}' stopped: BodyLengthMismatchError`));
      }
    });
  }
}

for (const jsCompute of [ null, '4.1.0' ]) {
  describe(`streaming fill in Viceroy, js-compute ${jsCompute ?? 'of the template'}`, { skip: skipUnlessFastlyCli() }, () => {
    let dir;
    let server;

    before(async () => {
      dir = makeTempDir('streaming-fill');
      writeFixtureContent(path.resolve(dir, 'public'));
      const computeJsDir = scaffoldApp(dir, [ '--kv-store-name', 'e2e-content' ]);
      if (jsCompute != null) {
        run('npm', [ 'install', '--save-exact', `@fastly/js-compute@${jsCompute}` ], { cwd: computeJsDir });
      }
      fs.writeFileSync(path.resolve(computeJsDir, 'src/index.js'), TEST_APP_INDEX);
      runCli([ 'publish-content', '--local' ], { cwd: computeJsDir });
      server = await startServe(computeJsDir);
    });

    after(async () => {
      await server?.stop();
      if (dir != null) {
        removeDir(dir);
      }
    });

    streamingFillTests({
      app: () => server,
      streams: false,
      settleMs: 500,
      checkSdk: ({ sdkVersion, hostname }) => {
        assert.equal(hostname, 'localhost');
        if (jsCompute != null) {
          assert.equal(sdkVersion, jsCompute);
        }
      },
    });
  });
}

const skipDeployed =
  skipUnlessEnv('FASTLY_API_TOKEN', 'CJSP_TEST_KV_STORE_NAME', 'CJSP_TEST_DEPLOY_SERVICE_ID', 'CJSP_TEST_DEPLOY_URL') ||
  skipUnlessFastlyCli();

describe('streaming fill on a real service', { skip: skipDeployed }, () => {
  const serviceId = process.env.CJSP_TEST_DEPLOY_SERVICE_ID;
  const baseUrl = process.env.CJSP_TEST_DEPLOY_URL?.replace(/\/+$/, '');
  const publishId = uniquePublishId('e2e-sf');
  // FASTLY_SERVICE_ID is empty, so that the CLI does not purge.
  const cliEnv = { FASTLY_SERVICE_ID: '' };
  let dir;
  let computeJsDir;

  before(async () => {
    console.log(`Publish ID: ${publishId}`);
    dir = makeTempDir('streaming-fill-deployed');
    writeFixtureContent(path.resolve(dir, 'public'));
    computeJsDir = scaffoldApp(dir, [
      '--publish-id', publishId,
      '--kv-store-name', process.env.CJSP_TEST_KV_STORE_NAME,
    ]);
    fs.writeFileSync(path.resolve(computeJsDir, 'src/index.js'), TEST_APP_INDEX);
    runCli([ 'publish-content', '--expires-in', '1d' ], { cwd: computeJsDir, env: cliEnv });
    run('fastly', [
      'compute', 'publish',
      '--service-id', serviceId,
      '--version', 'latest',
      '--non-interactive',
      '--status-check-off',
      '--comment', `compute-js-static-publish e2e test ${publishId}`,
    ], { cwd: computeJsDir });

    // Wait until the new version of the app runs.
    const deadline = Date.now() + 300_000;
    for (;;) {
      try {
        // Other versions of the test app do not have /sdk.
        const response = await request(baseUrl + '/sdk');
        if (response.status === 200 && response.body.startsWith('{"sdkVersion"')) {
          break;
        }
      } catch {
        // The service is not ready yet.
      }
      if (Date.now() > deadline) {
        throw new Error('The new version of the app did not start in 300 s.');
      }
      await sleep(5000);
    }
  });

  after(() => {
    if (computeJsDir != null) {
      try {
        runCli([ 'collections', 'delete', '--collection-name', 'live' ], { cwd: computeJsDir, env: cliEnv });
        runCli([ 'clean' ], { cwd: computeJsDir, env: cliEnv });
      } catch (err) {
        console.error(`Could not delete the test keys for publish ID ${publishId}:`, err);
      }
    }
    if (dir != null) {
      removeDir(dir);
    }
  });

  streamingFillTests({
    app: () => ({ baseUrl, getOutput: null }),
    streams: true,
    settleMs: 2000,
    checkSdk: ({ sdkVersion, hostname }) => {
      assert.notEqual(hostname, 'localhost');
      assert.match(sdkVersion, /^(4\.([2-9]|\d{2,})|[5-9])\./);
    },
  });
});
