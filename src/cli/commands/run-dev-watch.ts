/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { TEMPLATE_WATCH_SCRIPT } from './scaffold/generate-app.js';

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
  const appFastly = path.resolve(appDir, 'node_modules/.bin/fastly');
  const fastly = fs.existsSync(appFastly) ? appFastly : 'fastly';

  const watchScript = path.resolve(appDir, TEMPLATE_WATCH_SCRIPT);
  const watcher = serveArgs.includes('--watch') && fs.existsSync(watchScript) ?
    child_process.spawn(process.execPath, [ watchScript ], { cwd: appDir, stdio: 'inherit' }) :
    undefined;

  console.log(`▶️ fastly compute serve ${serveArgs.join(' ')}`);
  const result = await new Promise<ServeResult>(resolve => {
    const child = child_process.spawn(fastly, [ 'compute', 'serve', ...serveArgs ], { cwd: appDir, stdio: 'inherit' });
    child.on('error', error => resolve({ status: null, signal: null, error }));
    child.on('exit', (status, signal) => resolve({ status, signal }));
  });
  watcher?.kill();
  return result;
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
