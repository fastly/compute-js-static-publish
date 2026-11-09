/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Hono extensions: scaffolds hono apps (ejected and managed), adds modules to
// hono-extensions/, builds them (the prebuild hook bundles the modules), and
// serves the app with `fastly compute serve` or `dev`. Also template init, the
// fingerprint, eject, and the hint. Needs the Fastly CLI and network access for
// `npm install`. No credentials are necessary.

import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  scaffoldApp,
  skipUnlessFastlyCli,
  startServe,
  writeFixtureContent,
} from './helpers.js';

const HTML = { accept: 'text/html' };
const NO_TOKEN = { FASTLY_API_TOKEN: '', FASTLY_SERVICE_ID: '' };

const startDev = (projectDir, serveArgs = []) => startServe(projectDir, {
  command: (addr) => [ process.execPath, [ CLI_PATH, 'dev', '--', '--addr', addr, ...serveArgs ] ],
});

// Requests the URL until check(res) is true, or fails after the timeout. A
// restart of the app can take some time.
async function waitForResponse(url, check, message) {
  const end = Date.now() + 120_000;
  for (;;) {
    const res = await rawRequest(url).catch(() => null);
    if (res != null && check(res)) {
      return res;
    }
    if (Date.now() > end) {
      assert.fail(message);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

function writeFiles(dir, files) {
  for (const [ file, content ] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.resolve(dir, file)), { recursive: true });
    fs.writeFileSync(path.resolve(dir, file), content);
  }
}

// Modules that use options, a binding, a helper in lib/, and each phase.
// 05-early.ts sorts before 10-header.ts, but its beforeFiles phase runs after
// the middleware phase of 10-header.ts.
const MODULES = {
  '10-header.ts': `\
import { defineExtension } from '@fastly/compute-js-static-publish/hono';
import { createMiddleware } from 'hono/factory';
import { headerName } from './lib/names';

export default defineExtension({ bindings: { site: 'ConfigStore:site_config' } }, (app, options?: { value?: string }) => {
  app.use('*', createMiddleware(async (c, next) => {
    await next();
    c.header(headerName, options?.value ?? 'no-options');
  }));
});
`,
  '05-early.ts': `\
import { defineExtension } from '@fastly/compute-js-static-publish/hono';

export default defineExtension({
  beforeFiles: (app) => {
    app.get('/early', (c) => c.text('from a beforeFiles route'));
  },
});
`,
  'hello.ts': `\
import { defineExtension } from '@fastly/compute-js-static-publish/hono';

export default defineExtension({
  beforeFiles: (app) => {
    app.get('/hello', (c) => c.json({ hello: 'from an extension route' }));
  },
});
`,
  '20-docs.ts': `\
import { defineExtension } from '@fastly/compute-js-static-publish/hono';

export default defineExtension((app, options?: { path?: string }) => {
  app.use(options?.path ?? '/no-options/*', async (c, next) => {
    await next();
    c.header('x-docs', 'yes');
  });
});
`,
  'after.ts': `\
import { defineExtension } from '@fastly/compute-js-static-publish/hono';

export default defineExtension({
  afterFiles: (app) => {
    app.on([ 'GET', 'POST' ], '/about.html', (c) => c.text('from a route after the files'));
    app.get('/after-files', (c) => c.text('from a route after the files'));
  },
});
`,
  'lib/names.ts': `export const headerName = 'x-extension';\n`,
};

// Adds templateOptions.hono to the top level of a config file.
function addTemplateOptions(file, hono) {
  const text = fs.readFileSync(file, 'utf-8');
  const marker = '  publishId: ';
  assert.ok(text.includes(marker));
  fs.writeFileSync(file, text.replace(marker, `  templateOptions: { hono: ${JSON.stringify(hono)} },\n${marker}`));
}

describe('hono extensions in an ejected app', { skip: skipUnlessFastlyCli() }, () => {
  let dir;
  let computeJsDir;
  let extensionsDir;
  let server;

  before(async () => {
    dir = makeTempDir('hono-ext');
    writeFixtureContent(path.resolve(dir, 'public'));
    computeJsDir = scaffoldApp(dir, [ '--kv-store-name', 'e2e-content', '--template', 'hono' ]);
    extensionsDir = path.resolve(dir, 'hono-extensions');
    writeFiles(extensionsDir, MODULES);
    addTemplateOptions(path.resolve(computeJsDir, 'static-publish.rc.js'), { extensions: { header: { value: 'from-options' }, docs: { path: '/docs/*' } } });
    runCli([ 'publish-content', '--local' ], { cwd: computeJsDir });
    server = await startServe(computeJsDir);
  });

  after(async () => {
    await server?.stop();
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('scaffold makes the extensions folder next to the app', () => {
    for (const file of [ 'package.json', 'tsconfig.json', '_example.ts' ]) {
      assert.ok(fs.existsSync(path.resolve(extensionsDir, file)), file);
    }
    assert.match(fs.readFileSync(path.resolve(computeJsDir, 'static-publish.rc.js'), 'utf-8'), /extensionsDir: "\.\.\/hono-extensions"/);
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(extensionsDir, 'package.json'), 'utf-8'));
    assert.ok(packageJson.peerDependencies.hono);
    assert.ok(packageJson.peerDependencies['@fastly/compute-js-static-publish']);
  });

  test('the middleware runs, with its options', async () => {
    const res = await rawRequest(server.baseUrl + '/', { headers: HTML });
    assert.equal(res.status, 200);
    assert.match(res.body.toString(), /<h1>Home<\/h1>/);
    assert.equal(res.headers['x-extension'], 'from-options');
  });

  test('the route comes before the published files', async () => {
    const res = await rawRequest(server.baseUrl + '/hello');
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body.toString()), { hello: 'from an extension route' });
  });

  test('the middleware phase of all modules comes before their beforeFiles phase', async () => {
    const res = await rawRequest(server.baseUrl + '/early');
    assert.equal(res.status, 200);
    assert.equal(res.body.toString(), 'from a beforeFiles route');
    assert.equal(res.headers['x-extension'], 'from-options', 'the middleware of 10-header.ts runs for the route of 05-early.ts');
  });

  test('a middleware runs only on its path, from its options', async () => {
    const docs = await rawRequest(server.baseUrl + '/docs/', { headers: HTML });
    assert.equal(docs.status, 200);
    assert.equal(docs.headers['x-docs'], 'yes');
    const home = await rawRequest(server.baseUrl + '/', { headers: HTML });
    assert.equal(home.status, 200);
    assert.equal(home.headers['x-docs'], undefined);
  });

  test('the afterFiles phase gets only the requests that no published file matches', async () => {
    const file = await rawRequest(server.baseUrl + '/about.html');
    assert.equal(file.status, 200);
    assert.match(file.body.toString(), /<h1>About<\/h1>/);
    const post = await rawRequest(server.baseUrl + '/about.html', { method: 'POST' });
    assert.equal(post.status, 200);
    assert.equal(post.body.toString(), 'from a route after the files');
    const noFile = await rawRequest(server.baseUrl + '/after-files');
    assert.equal(noFile.status, 200);
    assert.equal(noFile.body.toString(), 'from a route after the files');
  });

  test('the bundle leaves hono as an import', () => {
    const bundle = fs.readFileSync(path.resolve(computeJsDir, 'src/hono-extensions.generated.js'), 'utf-8');
    assert.match(bundle, /from "hono\/factory"/);
    assert.match(bundle, /x-extension/, 'the helper in lib/ is bundled');
  });

  test('template init --check: up to date, and then out of date', () => {
    assert.equal(runCli([ 'template', 'init', '--check' ], { cwd: computeJsDir }).status, 0);
    const packageJsonPath = path.resolve(extensionsDir, 'package.json');
    const original = fs.readFileSync(packageJsonPath, 'utf-8');
    try {
      const packageJson = JSON.parse(original);
      packageJson.peerDependencies.hono = '^4.0.0';
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson));
      const result = runCli([ 'template', 'init', '--check' ], { cwd: computeJsDir, allowFailure: true });
      assert.equal(result.status, 2, result.output);
      assert.match(result.output, /is out of date/);
      assert.match(result.output, /peerDependencies\.hono is \^4\.0\.0/);
      assert.equal(runCli([ 'template', 'init' ], { cwd: computeJsDir }).status, 0);
      assert.equal(runCli([ 'template', 'init', '--check' ], { cwd: computeJsDir }).status, 0);
    } finally {
      fs.writeFileSync(packageJsonPath, original);
    }
  });

  test('a binding with two resources stops the build, and names both sources', () => {
    const rcPath = path.resolve(computeJsDir, 'static-publish.rc.js');
    const original = fs.readFileSync(rcPath, 'utf-8');
    try {
      fs.writeFileSync(rcPath, original.replace('templateOptions: { hono: {', `templateOptions: { hono: {"bindings":{"site":"ConfigStore:other"},`));
      const result = run('npm', [ 'run', 'build' ], { cwd: computeJsDir, allowFailure: true });
      assert.notEqual(result.status, 0);
      assert.match(result.output, /The binding 'site' is 'ConfigStore:other' in templateOptions\.hono\.bindings, but 'ConfigStore:site_config' in hono-extensions\/10-header\.ts/);
    } finally {
      fs.writeFileSync(rcPath, original);
    }
  });
});

describe('hono extensions in a managed project', { skip: skipUnlessFastlyCli() }, () => {
  let dir;
  let projectDir;
  let server;
  const fingerprint = () => JSON.parse(runCli([ 'status', '--json' ], { cwd: projectDir, env: NO_TOKEN }).stdout).fingerprint.current;

  before(async () => {
    dir = makeTempDir('hono-ext-managed');
    projectDir = path.resolve(dir, 'site');
    writeFixtureContent(path.resolve(projectDir, 'public'));
    runCli([ '--managed', '--template', 'hono', '--root-dir', './public', '--kv-store-name', 'e2e-content' ], { cwd: projectDir });
    writeFiles(path.resolve(projectDir, 'hono-extensions'), MODULES);
    runCli([ 'publish-content', '--local' ], { cwd: projectDir });
    server = await startDev(projectDir);
  });

  after(async () => {
    await server?.stop();
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('scaffold --managed makes the extensions folder next to the project file', () => {
    assert.ok(fs.existsSync(path.resolve(projectDir, 'hono-extensions/package.json')));
    const rc = fs.readFileSync(path.resolve(projectDir, '.static-publish/app/static-publish.rc.js'), 'utf-8');
    assert.match(rc, /extensionsDir: "\.\.\/\.\.\/hono-extensions"/);
  });

  test('dev serves the extensions', async () => {
    const res = await rawRequest(server.baseUrl + '/hello');
    assert.deepEqual(JSON.parse(res.body.toString()), { hello: 'from an extension route' });
    const home = await rawRequest(server.baseUrl + '/', { headers: HTML });
    assert.equal(home.headers['x-extension'], 'no-options');
  });

  test('a change to a module changes the fingerprint', () => {
    const before = fingerprint();
    const file = path.resolve(projectDir, 'hono-extensions/lib/names.ts');
    const original = fs.readFileSync(file, 'utf-8');
    try {
      fs.writeFileSync(file, original.replace('x-extension', 'x-extension-2'));
      assert.notEqual(fingerprint(), before);
    } finally {
      fs.writeFileSync(file, original);
    }
    assert.equal(fingerprint(), before);
  });

  test('status lists the template and the packages that it provides', () => {
    const json = JSON.parse(runCli([ 'status', '--json' ], { cwd: projectDir, env: NO_TOKEN }).stdout);
    assert.equal(json.template.name, 'hono');
    assert.ok(json.template.provides.hono);
    assert.ok(json.template.provides['@fastly/compute-js-static-publish']);
  });

  test('eject writes the path of the extensions folder relative to the new rc, and the app builds', () => {
    const ejectDir = makeTempDir('hono-ext-eject');
    try {
      fs.cpSync(projectDir, ejectDir, { recursive: true, filter: (src) => !src.includes(`${path.sep}.static-publish`) });
      const result = runCli([ 'eject' ], { cwd: ejectDir, env: { CJSP_TEST_EJECT_PACKAGE_SPEC: `file:${REPO_DIR}`, FASTLY_SERVICE_ID: '' } });
      assert.equal(result.status, 0, result.output);
      const appDir = path.resolve(ejectDir, 'compute-js');
      assert.match(fs.readFileSync(path.resolve(appDir, 'static-publish.rc.js'), 'utf-8'), /extensionsDir: "\.\.\/hono-extensions"/);
      run('npm', [ 'run', 'build' ], { cwd: appDir });
      assert.match(fs.readFileSync(path.resolve(appDir, 'src/hono-extensions.generated.js'), 'utf-8'), /from an extension route/);
    } finally {
      removeDir(ejectDir);
    }
  });
});

describe('npm run dev:watch in an ejected hono app', { skip: skipUnlessFastlyCli() }, () => {
  let dir;
  let extensionsDir;
  let server;

  before(async () => {
    dir = makeTempDir('hono-ext-dev-watch');
    writeFixtureContent(path.resolve(dir, 'public'));
    const computeJsDir = scaffoldApp(dir, [ '--kv-store-name', 'e2e-content', '--template', 'hono' ]);
    extensionsDir = path.resolve(dir, 'hono-extensions');
    writeFiles(extensionsDir, MODULES);
    runCli([ 'publish-content', '--local' ], { cwd: computeJsDir });
    server = await startServe(computeJsDir, {
      command: (addr) => [ 'npm', [ 'run', 'dev:watch', '--', '--addr', addr ] ],
    });
  });

  after(async () => {
    await server?.stop();
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('a change to a module restarts the app', async () => {
    await waitForResponse(server.baseUrl + '/hello', res => /from an extension route/.test(res.body.toString()), 'the route');
    const file = path.resolve(extensionsDir, 'hello.ts');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf-8').replace('from an extension route', 'changed while dev:watch runs'));
    await waitForResponse(server.baseUrl + '/hello', res => /changed while dev:watch runs/.test(res.body.toString()), 'the changed route');
  });
});

describe('dev --watch in a managed hono project that starts without the extensions folder', { skip: skipUnlessFastlyCli() }, () => {
  let dir;
  let server;

  before(async () => {
    dir = makeTempDir('hono-ext-watch');
    writeFixtureContent(path.resolve(dir, 'public'));
    runCli([ '--managed', '--template', 'hono', '--root-dir', './public', '--kv-store-name', 'e2e-content' ], { cwd: dir });
    fs.rmSync(path.resolve(dir, 'hono-extensions'), { recursive: true });
    runCli([ 'publish-content', '--local' ], { cwd: dir });
    server = await startDev(dir, [ '--watch' ]);
  });

  after(async () => {
    await server?.stop();
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('the app runs without the folder', async () => {
    const res = await rawRequest(server.baseUrl + '/', { headers: HTML });
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-extension'], undefined);
  });

  test('a new folder, and then a change to a module, restart the app', async () => {
    writeFiles(path.resolve(dir, 'hono-extensions'), MODULES);
    await waitForResponse(server.baseUrl + '/hello', res => res.status === 200 && /from an extension route/.test(res.body.toString()), 'the route of the new folder');
    const file = path.resolve(dir, 'hono-extensions/hello.ts');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf-8').replace('from an extension route', 'changed while dev runs'));
    await waitForResponse(server.baseUrl + '/hello', res => /changed while dev runs/.test(res.body.toString()), 'the changed route');
  });
});

describe('the hint when a managed hono project has no extensions folder', () => {
  let dir;

  before(() => {
    dir = makeTempDir('hono-ext-hint');
    writeFixtureContent(path.resolve(dir, 'public'));
    runCli([ '--managed', '--template', 'hono', '--root-dir', './public', '--kv-store-name', 'e2e-content' ], { cwd: dir });
    fs.rmSync(path.resolve(dir, 'hono-extensions'), { recursive: true });
  });

  after(() => {
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('deploy shows the hint', () => {
    const result = runCli([ 'deploy' ], { cwd: dir, env: NO_TOKEN, allowFailure: true });
    assert.match(result.output, /No \.\/hono-extensions folder\. To add your own Hono middleware and routes, run: npx @fastly\/compute-js-static-publish(@[a-z-]+)? template init/);
  });
});
