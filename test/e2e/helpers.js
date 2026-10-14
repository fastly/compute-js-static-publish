/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Helpers for the end-to-end tests. These tests scaffold an app that uses this
// checkout, publish content with the CLI, and serve the app with
// `fastly compute serve`.

import child_process from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export const REPO_DIR = path.resolve(import.meta.dirname, '../..');
export const CLI_PATH = path.resolve(REPO_DIR, 'build/cli/cli/index.js');

// Returns the reason to skip a test, or false if all the environment
// variables are set.
export function skipUnlessEnv(...names) {
  const missing = names.filter(name => !process.env[name]);
  if (missing.length > 0) {
    return `set ${missing.join(', ')} to run this test`;
  }
  return false;
}

export function skipUnlessFastlyCli() {
  const result = child_process.spawnSync('fastly', [ 'version' ], { stdio: 'ignore' });
  if (result.error != null || result.status !== 0) {
    return 'the Fastly CLI (fastly) is not on the PATH';
  }
  return false;
}

// A unique publish ID, so that a test in real storage does not touch other data.
export function uniquePublishId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

export function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cjsp-${prefix}-`));
}

export function removeDir(dir) {
  if (process.env.KEEP_E2E_DIRS) {
    console.log(`Keeping ${dir}`);
    return;
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

// Content to publish. The files test content types, auto index, auto
// extensions, compression, and the 404 page.
export const LARGE_TEXT = 'The quick brown fox jumps over the lazy dog.\n'.repeat(2000);
export function writeFixtureContent(publicDir, { largeBinaryBytes = 0 } = {}) {
  const files = {
    'index.html': '<!doctype html><title>Home</title><h1>Home</h1>',
    'about.html': '<!doctype html><title>About</title><h1>About</h1>',
    'docs/index.html': '<!doctype html><title>Docs</title><h1>Docs</h1>',
    'cached.html': '<!doctype html><title>Cached</title><h1>Cached</h1>',
    '404.html': '<!doctype html><title>Not found</title><h1>Not found</h1>',
    'style.css': LARGE_TEXT,
    'image.tiff': crypto.randomBytes(256),
    'image.avif': crypto.randomBytes(256),
    'module.wasm': crypto.randomBytes(256),
  };
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.resolve(publicDir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  if (largeBinaryBytes > 0) {
    // Random data does not compress, so the CLI keeps only the original.
    fs.writeFileSync(path.resolve(publicDir, 'large.bin'), crypto.randomBytes(largeBinaryBytes));
  }
}

// Runs a command and returns its output. Throws if the command fails, unless
// allowFailure is set.
export function run(command, args, { cwd, env, allowFailure = false } = {}) {
  const result = child_process.spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  if (result.error != null) {
    throw result.error;
  }
  if (!allowFailure && result.status !== 0) {
    throw new Error(`'${command} ${args.join(' ')}' exited with ${result.status}:\n${output}`);
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, output };
}

// Runs the CLI of this checkout.
export function runCli(args, options) {
  return run(process.execPath, [ CLI_PATH, ...args ], options);
}

// Scaffolds an app in <dir>/compute-js that uses this checkout. The scaffolder
// keeps a `file:` dependency from the package.json in the current directory,
// so that the generated app installs this checkout and not a version from npm.
export function scaffoldApp(dir, scaffoldArgs) {
  fs.writeFileSync(path.resolve(dir, 'package.json'), JSON.stringify({
    name: 'cjsp-e2e',
    private: true,
    devDependencies: {
      '@fastly/compute-js-static-publish': `file:${REPO_DIR}`,
    },
  }, undefined, 2));
  runCli([ '--root-dir', './public', ...scaffoldArgs ], { cwd: dir });
  const computeJsDir = path.resolve(dir, 'compute-js');
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(computeJsDir, 'package.json'), 'utf-8'));
  const dependency = packageJson.devDependencies['@fastly/compute-js-static-publish'];
  if (!dependency.startsWith('file:')) {
    throw new Error(`The scaffolded app does not use this checkout: ${dependency}`);
  }
  return computeJsDir;
}

// Replaces src/index.js of a scaffolded app with a version that turns on the
// optional features. A request with `x-use-cache: 1` uses a server that has
// the response cache. Server-Timing is on for requests that have
// `x-server-timing`. Set activeCollectionName to serve a collection that is
// not the default collection. responseCacheMaxAge is in seconds.
export function writeTestAppIndex(computeJsDir, { activeCollectionName, responseCacheMaxAge = 60 } = {}) {
  const setCollection = activeCollectionName != null
    ? `server.setActiveCollectionName(${JSON.stringify(activeCollectionName)});`
    : '';
  fs.writeFileSync(path.resolve(computeJsDir, 'src/index.js'), `\
/// <reference types="@fastly/js-compute" />
import { PublisherServer } from '@fastly/compute-js-static-publish';
import rc from '../static-publish.rc.js';

function createServer(responseCache) {
  const server = PublisherServer.fromStaticPublishRc(rc);
  server.setServerTimingRequestHeader('x-server-timing');
  server.setResponseCache(responseCache);
  ${setCollection}
  return server;
}
const publisherServer = createServer(null);
const cachedPublisherServer = createServer({ maxAge: ${responseCacheMaxAge} });

addEventListener('fetch', (event) => event.respondWith(handleRequest(event)));
async function handleRequest(event) {
  const request = event.request;
  const server = request.headers.get('x-use-cache') === '1' ? cachedPublisherServer : publisherServer;
  const response = await server.serveRequest(request);
  if (response != null) {
    return response;
  }
  return new Response('Not found (app)', { status: 404 });
}
`);
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// Starts `fastly compute serve` (this also builds the app). Returns the base
// URL and a function that stops the server.
export async function startServe(computeJsDir, { env, timeoutMs = 300_000 } = {}) {
  const port = await getFreePort();
  const child = child_process.spawn('fastly', [ 'compute', 'serve', '--addr', `127.0.0.1:${port}` ], {
    cwd: computeJsDir,
    env: { ...process.env, ...env },
    stdio: [ 'ignore', 'pipe', 'pipe' ],
    // Start a new process group, so that stop() also stops Viceroy.
    detached: true,
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });

  const stop = async () => {
    if (child.exitCode == null) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // The process group has already stopped.
      }
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 5000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
  };

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`fastly compute serve stopped with ${child.exitCode}:\n${output}`);
    }
    try {
      await fetch(baseUrl + '/', { signal: AbortSignal.timeout(2000) });
      return { baseUrl, stop, getOutput: () => output };
    } catch {
      await sleep(1000);
    }
  }
  await stop();
  throw new Error(`fastly compute serve did not start in ${timeoutMs} ms:\n${output}`);
}

// Gets the number of variants to upload from the publish-content output.
export function parseUploadSummary(output) {
  const match = /\| (\d+) variant\(s\) already in storage, (\d+) to upload\./.exec(output);
  if (match == null) {
    return null;
  }
  return { existing: Number(match[1]), toUpload: Number(match[2]) };
}

// Sends a request and returns the raw response. Unlike fetch(), this does not
// decompress the body, so that a test can examine the encoded bytes.
export function rawRequest(url, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const client = new URL(url).protocol === 'https:' ? https : http;
    const request = client.request(url, { method, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}
