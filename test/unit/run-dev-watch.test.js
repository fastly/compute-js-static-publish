/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import assert from 'node:assert/strict';
import child_process from 'node:child_process';
import { describe, test } from 'node:test';

import { stopProcessGroup } from '../../build/cli/cli/commands/run-dev-watch.js';

// A shell in its own process group. With ignoreTerm, it ignores SIGTERM.
function startGroup({ ignoreTerm }) {
  const script = `${ignoreTerm ? 'trap "" TERM; ' : ''}while :; do sleep 1; done`;
  return child_process.spawn('sh', [ '-c', script ], { detached: true, stdio: 'ignore' });
}

const isGroupRunning = (pgid) => {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('stopProcessGroup()', { skip: process.platform === 'win32' }, () => {
  test('a group that ignores SIGTERM gets a SIGKILL', async () => {
    const child = startGroup({ ignoreTerm: true });
    // Give the shell time to set the trap.
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(await stopProcessGroup(child.pid, 300), true);
    assert.equal(isGroupRunning(child.pid), false);
  });

  test('a group that stops on SIGTERM does not get a SIGKILL', async () => {
    const child = startGroup({ ignoreTerm: false });
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(await stopProcessGroup(child.pid, 5000), false);
    assert.equal(isGroupRunning(child.pid), false);
  });

  test('a group that has stopped is not changed', async () => {
    const child = startGroup({ ignoreTerm: false });
    await new Promise(resolve => setTimeout(resolve, 200));
    const exited = new Promise(resolve => child.once('exit', resolve));
    process.kill(-child.pid, 'SIGKILL');
    await exited;
    assert.equal(await stopProcessGroup(child.pid, 300), false);
  });
});
