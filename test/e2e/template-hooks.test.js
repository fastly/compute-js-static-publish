/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Checks the template hooks: `run-template-hook`, and the npm scripts of a
// scaffolded app that call it. Also `npm run dev:watch` and its watch script.
// Needs network access for `npm install`, and the Fastly CLI for dev:watch. No
// credentials are necessary.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import {
  CLI_PATH,
  makeTempDir,
  removeDir,
  run,
  runCli,
  scaffoldApp,
  skipUnlessFastlyCli,
  startServe,
  writeFixtureContent,
} from './helpers.js';

// A hook file that writes a marker file, so that a test can see that it ran.
function writeHook(dir, name, body = '') {
  fs.mkdirSync(path.resolve(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.resolve(dir, `scripts/template_${name}.js`),
    `import fs from 'node:fs';\nfs.writeFileSync('ran-${name}', 'yes');\n${body}`);
}

describe('run-template-hook', () => {
  let dir;

  before(() => {
    dir = makeTempDir('template-hooks');
    fs.writeFileSync(path.resolve(dir, 'package.json'), JSON.stringify({ type: 'module' }));
  });

  after(() => {
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('does nothing if the app has no hook file', () => {
    const result = runCli([ 'run-template-hook', 'prebuild' ], { cwd: dir });
    assert.equal(result.status, 0);
    assert.equal(result.output, '', 'no banner and no output');
  });

  test('runs the hook file', () => {
    writeHook(dir, 'postbuild');
    const result = runCli([ 'run-template-hook', 'postbuild' ], { cwd: dir });
    assert.equal(result.status, 0);
    assert.equal(fs.readFileSync(path.resolve(dir, 'ran-postbuild'), 'utf-8'), 'yes');
  });

  test('a failing hook fails the command with its exit code', () => {
    writeHook(dir, 'postinstall', 'process.exit(3);\n');
    const result = runCli([ 'run-template-hook', 'postinstall' ], { cwd: dir, allowFailure: true });
    assert.equal(result.status, 3);
  });

  test('refuses an unknown hook name', () => {
    const result = runCli([ 'run-template-hook', 'preinstall' ], { cwd: dir, allowFailure: true });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /must be one of: prebuild, postbuild, postinstall/);
  });
});

describe('template hooks in a scaffolded app', () => {
  let dir;
  let computeJsDir;

  before(() => {
    dir = makeTempDir('template-hooks-app');
    writeFixtureContent(path.resolve(dir, 'public'));
    computeJsDir = scaffoldApp(dir, [ '--kv-store-name', 'e2e-content' ]);
  });

  after(() => {
    if (dir != null) {
      removeDir(dir);
    }
  });

  test('npm run build runs the prebuild and postbuild hooks', () => {
    writeHook(computeJsDir, 'prebuild');
    writeHook(computeJsDir, 'postbuild');
    run('npm', [ 'run', 'build' ], { cwd: computeJsDir });
    assert.equal(fs.existsSync(path.resolve(computeJsDir, 'ran-prebuild')), true, 'prebuild ran');
    assert.equal(fs.existsSync(path.resolve(computeJsDir, 'ran-postbuild')), true, 'postbuild ran');
    assert.equal(fs.existsSync(path.resolve(computeJsDir, 'bin/main.wasm')), true, 'the app was built');
  });

  test('npm install runs the postinstall hook', () => {
    writeHook(computeJsDir, 'postinstall');
    run('npm', [ 'install', '--no-audit', '--no-fund' ], { cwd: computeJsDir });
    assert.equal(fs.existsSync(path.resolve(computeJsDir, 'ran-postinstall')), true, 'postinstall ran');
  });
});

describe('npm run dev:watch in a scaffolded app', { skip: skipUnlessFastlyCli() }, () => {
  let dir;
  let computeJsDir;
  let server;

  before(async () => {
    dir = makeTempDir('template-watch-app');
    writeFixtureContent(path.resolve(dir, 'public'));
    computeJsDir = scaffoldApp(dir, [ '--kv-store-name', 'e2e-content' ]);
    // A watch script that writes its process ID, and runs until it is stopped.
    fs.mkdirSync(path.resolve(computeJsDir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.resolve(computeJsDir, 'scripts/template_watch.js'),
      `import fs from 'node:fs';\nfs.writeFileSync('../watch-pid', String(process.pid));\nsetInterval(() => {}, 1000);\n`);
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

  const isRunning = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  test('runs the watch script next to fastly compute serve --watch', async () => {
    const pid = Number(fs.readFileSync(path.resolve(dir, 'watch-pid'), 'utf-8'));
    assert.equal(isRunning(pid), true, 'the watch script runs');

    // A change in the app directory restarts the app.
    fs.appendFileSync(path.resolve(computeJsDir, 'src/index.js'), '\n// changed\n');
    const end = Date.now() + 60_000;
    while (!/Restarting local server/.test(server.getOutput())) {
      assert.ok(Date.now() < end, `no restart:\n${server.getOutput()}`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    await server.stop();
    await new Promise(resolve => setTimeout(resolve, 1000));
    assert.equal(isRunning(pid), false, 'the watch script stopped with the server');
  });
});

describe('run-dev-watch stops its children when it gets a signal', { skip: skipUnlessFastlyCli() }, () => {
  let dir;
  let computeJsDir;
  let server;

  before(async () => {
    dir = makeTempDir('template-watch-signal');
    writeFixtureContent(path.resolve(dir, 'public'));
    computeJsDir = scaffoldApp(dir, [ '--kv-store-name', 'e2e-content' ]);
    fs.mkdirSync(path.resolve(computeJsDir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.resolve(computeJsDir, 'scripts/template_watch.js'),
      `import fs from 'node:fs';\nfs.writeFileSync('../watch-pid', String(process.pid));\nsetInterval(() => {}, 1000);\n`);
    runCli([ 'publish-content', '--local' ], { cwd: computeJsDir });
    // The CLI itself, without npm, so that the signal goes only to the CLI.
    server = await startServe(computeJsDir, {
      command: (addr) => [ process.execPath, [ CLI_PATH, 'run-dev-watch', '--addr', addr ] ],
    });
  });

  after(async () => {
    await server?.stop();
    if (dir != null) {
      removeDir(dir);
    }
  });

  const isRunning = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  test('SIGTERM to the CLI stops fastly compute serve and the watch script', async () => {
    const watchPid = Number(fs.readFileSync(path.resolve(dir, 'watch-pid'), 'utf-8'));
    assert.equal(isRunning(watchPid), true, 'the watch script runs');

    process.kill(server.pid, 'SIGTERM');
    const end = Date.now() + 30_000;
    const answers = async () => fetch(server.baseUrl + '/', { signal: AbortSignal.timeout(2000) }).then(() => true, () => false);
    while (isRunning(server.pid) || isRunning(watchPid) || await answers()) {
      assert.ok(Date.now() < end, `still running: cli ${isRunning(server.pid)}, watch script ${isRunning(watchPid)}, server ${await answers()}\n${server.getOutput()}`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  });
});
