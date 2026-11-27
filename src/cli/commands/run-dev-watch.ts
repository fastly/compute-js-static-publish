/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { TEMPLATE_WATCH_SCRIPT } from './scaffold/generate-app.js';

// The Fastly CLI of the app (its node_modules/.bin/fastly) if it has one, or
// else fastly from the PATH.
export function appFastlyCommand(appDir: string): string {
  const appFastly = path.resolve(appDir, 'node_modules/.bin/fastly');
  return fs.existsSync(appFastly) ? appFastly : 'fastly';
}

// The time that the processes of the Fastly CLI get to stop after a SIGTERM,
// before they get a SIGKILL.
const STOP_GRACE_MS = 5000;

function processGroupIsRunning(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessGroup(pgid: number, ms: number) {
  const end = Date.now() + ms;
  while (processGroupIsRunning(pgid) && Date.now() < end) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

// Makes sure that no process of a process group runs. If a process runs, it
// gets a SIGTERM, and after graceMs a SIGKILL. Returns true if a SIGKILL was
// necessary.
export async function stopProcessGroup(pgid: number, graceMs: number = STOP_GRACE_MS): Promise<boolean> {
  if (!processGroupIsRunning(pgid)) {
    return false;
  }
  try {
    process.kill(-pgid, 'SIGTERM');
  } catch {
    // The process group has already stopped.
  }
  await waitForProcessGroup(pgid, graceMs);
  if (!processGroupIsRunning(pgid)) {
    return false;
  }
  try {
    process.kill(-pgid, 'SIGKILL');
  } catch {
    // The process group has already stopped.
  }
  await waitForProcessGroup(pgid, 2000);
  return true;
}

export type ServeResult = {
  status: number | null,
  signal: NodeJS.Signals | null,
  error?: Error,
};

// Runs `fastly compute serve` in the app dir. With --watch, the watch script
// (if the app has one) runs next to it, until the Fastly CLI stops. The script
// can watch files outside the app dir: when they change, it writes a file in
// the app dir, and then the Fastly CLI builds the app again. The Fastly CLI of
// the app is used, if it has one.
export async function serveApp(appDir: string, serveArgs: string[]): Promise<ServeResult> {
  const fastly = appFastlyCommand(appDir);

  const watchScript = path.resolve(appDir, TEMPLATE_WATCH_SCRIPT);
  const watcher = serveArgs.includes('--watch') && fs.existsSync(watchScript) ?
    child_process.spawn(process.execPath, [ watchScript ], { cwd: appDir, stdio: 'inherit' }) :
    undefined;
  watcher?.on('error', error => {
    console.error(`❌ Could not run ${TEMPLATE_WATCH_SCRIPT}: ${String(error)}`);
  });

  console.log(`▶️ fastly compute serve ${serveArgs.join(' ')}`);
  // The Fastly CLI of the app is a Node.js wrapper that starts the fastly
  // binary, which starts Viceroy. The wrapper does not forward signals. Thus
  // the Fastly CLI runs in its own process group, and a signal goes to the
  // whole group.
  const child = child_process.spawn(fastly, [ 'compute', 'serve', ...serveArgs ], { cwd: appDir, stdio: 'inherit', detached: true });

  // A signal to this process (for example SIGTERM from a process manager, or
  // SIGINT from Ctrl+C) goes to the Fastly CLI and to the watch script, so that
  // nothing stays running. This process waits until all the processes of the
  // Fastly CLI stop. The wrapper can stop before the fastly binary, for example
  // when the binary gets the signal during a restart of --watch.
  const forward = (signal: NodeJS.Signals) => {
    if (child.pid != null) {
      try {
        process.kill(-child.pid, signal);
      } catch {
        // The process group has already stopped.
      }
    }
    watcher?.kill(signal);
  };
  const signals: NodeJS.Signals[] = [ 'SIGINT', 'SIGTERM', 'SIGHUP' ];
  for (const signal of signals) {
    process.on(signal, forward);
  }
  try {
    return await new Promise<ServeResult>(resolve => {
      child.on('error', error => resolve({ status: null, signal: null, error }));
      child.on('exit', (status, signal) => resolve({ status, signal }));
    });
  } finally {
    if (child.pid != null && await stopProcessGroup(child.pid)) {
      console.warn('⚠️ The Fastly CLI did not stop after SIGTERM, so it got a SIGKILL.');
    }
    for (const signal of signals) {
      process.off(signal, forward);
    }
    watcher?.kill();
  }
}

// The dev:watch script of every app calls this: `fastly compute serve --watch`
// in the current directory, with the watch script of the app. The arguments
// go to `fastly compute serve`. Returns the exit code.
export async function runDevWatch(args: string[]): Promise<number> {
  const serveArgs = args.includes('--watch') ? args : [ '--watch', ...args ];
  const result = await serveApp(path.resolve(), serveArgs);
  if (result.error != null) {
    console.error(`❌ Could not run 'fastly compute serve': ${String(result.error)}`);
    return 1;
  }
  return result.status ?? (result.signal != null ? 0 : 1);
}
