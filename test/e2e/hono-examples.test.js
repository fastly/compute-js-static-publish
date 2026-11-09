/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// The examples in examples/hono/: puts each one into the hono-extensions/
// folder of a managed hono project, installs its packages, sets it up as its
// README shows, and runs `dev`. Needs the Fastly CLI and
// network access for `npm install`. The GRIP test also needs Pushpin on the
// PATH. These tests need no credentials.
//
// The last test deploys both examples to a real service, and needs the
// variables of test/README.md. THE TEST REPLACES THE ACTIVE VERSION OF THE
// SERVICE.

import assert from 'node:assert/strict';
import child_process from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import {
  CLI_PATH,
  REPO_DIR,
  makeTempDir,
  rawRequest,
  removeDir,
  run,
  runCli,
  skipUnlessEnv,
  skipUnlessFastlyCli,
  startServe,
  uniquePublishId,
  writeFixtureContent,
} from './helpers.js';

const EXAMPLES_DIR = path.resolve(REPO_DIR, 'examples/hono');

function skipUnlessPushpin() {
  const result = child_process.spawnSync('pushpin', [ '--version' ], { stdio: 'ignore' });
  return result.error != null || result.status !== 0 ? 'Pushpin (pushpin) is not on the PATH' : skipUnlessFastlyCli();
}

// Makes a managed hono project with the examples in hono-extensions/, as the
// README of an example shows:
// - one example (a new project): replaces hono-extensions/ with the
//   hono-extensions/ folder of the example, runs template init, and installs.
// - more than one (a project that exists): copies the files of each example
//   (not package.json), and installs the packages of each example.
// With local, it publishes the content with --local.
function makeExampleProject(names, { templateOptions, fastlyToml, scaffoldArgs = [ '--kv-store-name', 'e2e-content' ], local = true }) {
  const dir = makeTempDir(`hono-example-${names.join('-')}`);
  writeFixtureContent(path.resolve(dir, 'public'));
  runCli([ '--managed', '--template', 'hono', '--root-dir', './public', ...scaffoldArgs ], { cwd: dir });
  const extensionsDir = path.resolve(dir, 'hono-extensions');
  const exampleDir = (name) => path.resolve(EXAMPLES_DIR, name, 'hono-extensions');
  // --legacy-peer-deps: do not install the peer dependencies (the packages that
  // the app provides). The version of this checkout can be one that is not on
  // npm yet, and the build uses the copies of the app.
  const npmInstall = [ 'install', '--no-audit', '--no-fund', '--legacy-peer-deps' ];
  if (names.length === 1) {
    fs.rmSync(extensionsDir, { recursive: true });
    fs.cpSync(exampleDir(names[0]), extensionsDir, { recursive: true });
    runCli([ 'template', 'init' ], { cwd: dir });
    run('npm', npmInstall, { cwd: extensionsDir });
  } else {
    const packages = [];
    for (const name of names) {
      for (const entry of fs.readdirSync(exampleDir(name))) {
        if (entry !== 'package.json') {
          fs.cpSync(path.resolve(exampleDir(name), entry), path.resolve(extensionsDir, entry), { recursive: true });
        }
      }
      const { dependencies } = JSON.parse(fs.readFileSync(path.resolve(exampleDir(name), 'package.json'), 'utf-8'));
      packages.push(...Object.entries(dependencies).map(([ pkg, range ]) => `${pkg}@${range}`));
    }
    run('npm', [ ...npmInstall, ...packages ], { cwd: extensionsDir });
  }

  const projectFile = path.resolve(dir, 'static-publish.project.js');
  const text = fs.readFileSync(projectFile, 'utf-8');
  for (const marker of [ '    staticPublishVersion: ', '  publishId: ' ]) {
    assert.ok(text.includes(marker), marker);
  }
  fs.writeFileSync(projectFile, text
    .replace('    staticPublishVersion: ', `    fastlyToml: ${JSON.stringify(fastlyToml)},\n    staticPublishVersion: `)
    .replace('  publishId: ', `  templateOptions: { hono: ${JSON.stringify(templateOptions)} },\n  publishId: `));
  if (local) {
    runCli([ 'publish-content', '--local' ], { cwd: dir });
  }
  return { dir, projectFile };
}

// Opens a streaming GET request, and keeps the body that arrives.
function openStream(url) {
  let body = '';
  let response;
  const client = new URL(url).protocol === 'https:' ? https : http;
  const request = client.get(url, (res) => {
    response = res;
    res.setEncoding('utf-8');
    res.on('data', (chunk) => { body += chunk; });
  });
  request.on('error', () => {});
  return {
    status: () => response?.statusCode,
    headers: () => response?.headers,
    body: () => body,
    close: () => request.destroy(),
  };
}

async function waitFor(check, message, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) {
      assert.fail(message);
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

// A session cookie of the OAuth example, signed as hono/cookie
// setSignedCookie() does.
function makeSessionCookie(id, { key, exp = Math.floor(Date.now() / 1000) + 600 }) {
  const value = JSON.stringify({ id, name: 'E2E', exp });
  const signature = crypto.createHmac('sha256', key).update(value).digest('base64');
  return `session=${encodeURIComponent(`${value}.${signature}`)}`;
}

describe('the GRIP example, with Pushpin', { skip: skipUnlessPushpin() }, () => {
  const PUBLISH_KEY = 'e2e-publish-key';
  let dir;
  let server;

  before(async () => {
    ({ dir } = makeExampleProject([ 'grip' ], {
      templateOptions: {},
      fastlyToml: {
        local_server: {
          pushpin: { enable: true },
          backends: { self: { url: 'http://127.0.0.1:7676/', override_host: '127.0.0.1:7676' } },
          secret_stores: {
            grip: [
              { key: 'GRIP_URL', env: 'GRIP_URL' },
              { key: 'GRIP_VERIFY_KEY', env: 'GRIP_VERIFY_KEY' },
              { key: 'PUBLISH_KEY', env: 'PUBLISH_KEY' },
            ],
          },
        },
      },
    }));
    const projectFile = path.resolve(dir, 'static-publish.project.js');
    server = await startServe(dir, {
      env: {
        GRIP_URL: 'http://localhost:5561/?verify-iss=viceroy',
        GRIP_VERIFY_KEY: 'viceroy_dev_signing_key_dont_use_in_production',
        PUBLISH_KEY,
      },
      // The backend 'self' must be the address of the local server, which
      // startServe() chooses.
      command: (addr) => {
        fs.writeFileSync(projectFile, fs.readFileSync(projectFile, 'utf-8').replaceAll('127.0.0.1:7676', addr));
        return [ process.execPath, [ CLI_PATH, 'dev', '--', '--addr', addr ] ];
      },
    });
  });

  after(async () => {
    await server?.stop();
    if (dir != null) {
      removeDir(dir);
    }
  });

  const publish = (channel, body, key = PUBLISH_KEY) => fetch(`${server.baseUrl}/publish/${channel}`, {
    method: 'POST',
    headers: key != null ? { authorization: `Bearer ${key}` } : {},
    body,
  });

  test('the published files do not go through Fanout', async () => {
    const res = await rawRequest(server.baseUrl + '/', { headers: { accept: 'text/html' } });
    assert.equal(res.status, 200);
    assert.match(res.body.toString(), /<h1>Home<\/h1>/);
  });

  test('a stream and an SSE connection get a published message', async () => {
    const stream = openStream(`${server.baseUrl}/events/stream/e2e`);
    const sse = openStream(`${server.baseUrl}/events/sse/e2e`);
    try {
      await waitFor(() => stream.body().includes('[stream open]') && sse.body().includes(':open'), 'the streams did not open');
      assert.equal(stream.status(), 200);
      assert.match(sse.headers()['content-type'], /^text\/event-stream/);
      const res = await publish('e2e', 'hello\nworld');
      assert.equal(res.status, 200, await res.text());
      await waitFor(() => stream.body().includes('world\n') && sse.body().includes('data: world\n'), 'the message did not arrive');
      assert.equal(stream.body(), '[stream open]\nhello\nworld\n');
      assert.equal(sse.body(), ':open\n\ndata: hello\ndata: world\n\n');
    } finally {
      stream.close();
      sse.close();
    }
  });

  test('publish without the key, or with a wrong key, is 401', async () => {
    assert.equal((await publish('e2e', 'x', null)).status, 401);
    assert.equal((await publish('e2e', 'x', 'wrong-key')).status, 401);
  });

  test('a request that did not come through Fanout is refused', async () => {
    const res = await rawRequest(`${server.baseUrl}/events/stream/e2e`, { headers: { 'grip-sig': 'not-a-signature' } });
    assert.equal(res.status, 400);
  });
});

describe('the OAuth example', { skip: skipUnlessFastlyCli() }, () => {
  const SESSION_KEY = 'e2e-session-key-0123456789';
  let dir;
  let server;

  before(async () => {
    ({ dir } = makeExampleProject([ 'oauth' ], {
      templateOptions: {
        extensions: {
          oauth: {
            protect: '/docs/*',
            allowedUsers: [ 'github:octocat' ],
            github: { clientId: 'e2e-github-client' },
            google: { clientId: 'e2e-google-client' },
          },
        },
      },
      fastlyToml: {
        local_server: {
          secret_stores: {
            oauth: [
              { key: 'SESSION_KEY', env: 'SESSION_KEY' },
              { key: 'GITHUB_CLIENT_SECRET', env: 'GITHUB_CLIENT_SECRET' },
              { key: 'GOOGLE_CLIENT_SECRET', env: 'GOOGLE_CLIENT_SECRET' },
            ],
          },
        },
      },
    }));
    server = await startServe(dir, {
      env: { SESSION_KEY, GITHUB_CLIENT_SECRET: 'not-a-real-secret', GOOGLE_CLIENT_SECRET: 'not-a-real-secret' },
      command: (addr) => [ process.execPath, [ CLI_PATH, 'dev', '--', '--addr', addr ] ],
    });
  });

  after(async () => {
    await server?.stop();
    if (dir != null) {
      removeDir(dir);
    }
  });

  const sessionCookie = (id, options) => makeSessionCookie(id, { key: SESSION_KEY, ...options });
  const get = (pathname, headers = {}) => rawRequest(server.baseUrl + pathname, { headers: { accept: 'text/html', ...headers } });

  test('a path that is not protected needs no login', async () => {
    const res = await get('/');
    assert.equal(res.status, 200);
  });

  test('a protected path without a session goes to the login, and keeps the path', async () => {
    const res = await get('/docs/');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/auth/github');
    assert.ok(res.headers['set-cookie'].some(x => x.startsWith('oauth_return_to=%2Fdocs%2F;')));
  });

  test('the login routes go to GitHub and Google with the client ID', async () => {
    const github = await get('/auth/github');
    assert.equal(github.status, 302);
    assert.match(github.headers.location, /^https:\/\/github\.com\/login\/oauth\/authorize\?client_id=e2e-github-client&/);
    const google = await get('/auth/google');
    assert.equal(google.status, 302);
    assert.match(google.headers.location, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?.*client_id=e2e-google-client/);
  });

  test('a callback with a state that does not match is 401', async () => {
    const res = await get('/auth/github?code=fake&state=one', { cookie: 'state=two' });
    assert.equal(res.status, 401);
  });

  test('a session of an allowed user gets the file, with Cache-Control: private', async () => {
    const res = await get('/docs/', { cookie: sessionCookie('github:octocat') });
    assert.equal(res.status, 200);
    assert.match(res.body.toString(), /<h1>Docs<\/h1>/);
    assert.equal(res.headers['cache-control'], 'private');
  });

  test('another user gets 403', async () => {
    const res = await get('/docs/', { cookie: sessionCookie('github:someone-else') });
    assert.equal(res.status, 403);
  });

  test('a session with a wrong signature, or an expired one, goes to the login', async () => {
    assert.equal((await get('/docs/', { cookie: sessionCookie('github:octocat', { key: 'wrong-key' }) })).status, 302);
    assert.equal((await get('/docs/', { cookie: sessionCookie('github:octocat', { exp: 1 }) })).status, 302);
  });

  test('logout deletes the session cookie', async () => {
    const res = await get('/auth/logout');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/');
    assert.ok(res.headers['set-cookie'].some(x => /^session=; Max-Age=0;/.test(x)));
  });
});

// Both examples in one app on a real service, with Fastly Fanout. The service
// must have:
// - Fanout turned on, and the backend 'self' to its own domain;
// - one Secret Store, linked with the names 'grip' and 'oauth', with the
//   entries PUBLISH_KEY (= CJSP_TEST_GRIP_PUBLISH_KEY), FANOUT_API_TOKEN (=
//   CJSP_TEST_PUBLISH_API_TOKEN), SESSION_KEY (= CJSP_TEST_OAUTH_SESSION_KEY),
//   and GITHUB_CLIENT_SECRET (any value).
// See test/README.md. The app has no published content, so that the test
// leaves no keys in the KV Store.
describe('the GRIP and OAuth examples, deployed', {
  skip: skipUnlessEnv(
    'FASTLY_API_TOKEN', 'CJSP_TEST_KV_STORE_NAME', 'CJSP_TEST_DEPLOY_SERVICE_ID', 'CJSP_TEST_DEPLOY_URL',
    'CJSP_TEST_GRIP_PUBLISH_KEY', 'CJSP_TEST_OAUTH_SESSION_KEY',
  ) || skipUnlessFastlyCli(),
}, () => {
  const baseUrl = process.env.CJSP_TEST_DEPLOY_URL?.replace(/\/+$/, '');
  const publishId = uniquePublishId('e2e');
  let dir;

  before(async () => {
    ({ dir } = makeExampleProject([ 'grip', 'oauth' ], {
      scaffoldArgs: [ '--kv-store-name', process.env.CJSP_TEST_KV_STORE_NAME, '--publish-id', publishId ],
      local: false,
      templateOptions: {
        extensions: { oauth: { protect: '/docs/*', allowedUsers: [ 'github:octocat' ], github: { clientId: 'e2e-github-client' } } },
      },
      fastlyToml: {},
    }));
    const env = { FASTLY_SERVICE_ID: process.env.CJSP_TEST_DEPLOY_SERVICE_ID };
    runCli([ 'deploy', '--force', '--non-interactive', '--comment', `compute-js-static-publish e2e test ${publishId}` ], { cwd: dir, env });

    // Wait until the new version of the app answers.
    const end = Date.now() + 300_000;
    while ((await rawRequest(`${baseUrl}/auth/logout`)).status !== 302) {
      assert.ok(Date.now() < end, 'the app did not start to answer');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  });

  after(() => {
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('GRIP: a stream and an SSE connection get a message through Fanout', async () => {
    const channel = publishId;
    const stream = openStream(`${baseUrl}/events/stream/${channel}`);
    const sse = openStream(`${baseUrl}/events/sse/${channel}`);
    try {
      await waitFor(() => stream.body().includes('[stream open]') && sse.body().includes(':open'), 'the streams did not open');
      const publish = (key) => fetch(`${baseUrl}/publish/${channel}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}` },
        body: 'hello\nworld',
      });
      assert.equal((await publish('wrong-key')).status, 401);
      const res = await publish(process.env.CJSP_TEST_GRIP_PUBLISH_KEY);
      assert.equal(res.status, 200, await res.text());
      await waitFor(() => stream.body().includes('world\n') && sse.body().includes('data: world\n'), 'the message did not arrive');
      assert.equal(stream.body(), '[stream open]\nhello\nworld\n');
      assert.equal(sse.body(), ':open\n\ndata: hello\ndata: world\n\n');
    } finally {
      stream.close();
      sse.close();
    }
  });

  test('OAuth: a callback with a fake code gets an error from GitHub', async () => {
    const start = await rawRequest(`${baseUrl}/auth/github`);
    assert.equal(start.status, 302);
    const state = new URL(start.headers.location).searchParams.get('state');
    const cookie = start.headers['set-cookie'].map(x => x.split(';')[0]).join('; ');
    const res = await rawRequest(`${baseUrl}/auth/github?code=fake&state=${encodeURIComponent(state)}`, { headers: { cookie } });
    // 400 comes from the answer of GitHub. Thus the app could call GitHub.
    assert.equal(res.status, 400, res.body.toString());
  });

  test('OAuth: the session of an allowed user goes through the login check', async () => {
    const key = process.env.CJSP_TEST_OAUTH_SESSION_KEY;
    assert.equal((await rawRequest(`${baseUrl}/docs/`)).status, 302);
    assert.equal((await rawRequest(`${baseUrl}/docs/`, { headers: { cookie: makeSessionCookie('github:someone-else', { key }) } })).status, 403);
    const res = await rawRequest(`${baseUrl}/docs/`, { headers: { cookie: makeSessionCookie('github:octocat', { key }) } });
    assert.ok(res.status !== 302 && res.status !== 403, `status ${res.status}`);
    assert.equal(res.headers['cache-control'], 'private');
  });
});
