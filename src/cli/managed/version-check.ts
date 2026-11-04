/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// managed.staticPublishVersion records the version of this package that a
// managed project uses. dev and deploy compare it with the running CLI, so
// that an upgrade is always explicit.

type ParsedVersion = { core: number[], prerelease: (string | number)[] };

function parseVersion(version: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(version.trim());
  if (match == null) {
    return null;
  }
  return {
    core: [ Number(match[1]), Number(match[2]), Number(match[3]) ],
    prerelease: match[4] != null ? match[4].split('.').map(x => /^\d+$/.test(x) ? Number(x) : x) : [],
  };
}

// Semver order: -1 if a < b, 0 if the same, 1 if a > b. null if one of them
// is not a version.
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (va == null || vb == null) {
    return null;
  }
  for (let i = 0; i < 3; i++) {
    if (va.core[i] !== vb.core[i]) {
      return va.core[i] < vb.core[i] ? -1 : 1;
    }
  }
  // A version without a prerelease is after the same version with one.
  if (va.prerelease.length === 0 || vb.prerelease.length === 0) {
    return va.prerelease.length === vb.prerelease.length ? 0 : va.prerelease.length === 0 ? 1 : -1;
  }
  for (let i = 0; i < Math.max(va.prerelease.length, vb.prerelease.length); i++) {
    const x = va.prerelease[i];
    const y = vb.prerelease[i];
    if (x === undefined) {
      return -1;
    }
    if (y === undefined) {
      return 1;
    }
    if (x === y) {
      continue;
    }
    if (typeof x === 'number' && typeof y === 'number') {
      return x < y ? -1 : 1;
    }
    if (typeof x === 'number') {
      return -1;
    }
    if (typeof y === 'number') {
      return 1;
    }
    return x < y ? -1 : 1;
  }
  return 0;
}

export type VersionCheck =
  | { result: 'same', recorded: string, running: string }
  | { result: 'newer-cli', recorded: string, running: string }
  | { result: 'older-cli', recorded: string, running: string }
  | { result: 'missing', recorded: undefined, running: string }
  | { result: 'invalid', recorded: string, running: string };

export function checkProjectVersion(recorded: string | undefined, running: string): VersionCheck {
  if (recorded == null || recorded.trim() === '') {
    return { result: 'missing', recorded: undefined, running };
  }
  const order = compareVersions(running, recorded);
  if (order == null) {
    return { result: 'invalid', recorded, running };
  }
  return { result: order === 0 ? 'same' : order > 0 ? 'newer-cli' : 'older-cli', recorded, running };
}

// The message for a check that stops dev and deploy, or null if they can continue.
export function versionCheckError(check: VersionCheck, autoUpgrade: boolean): string | null {
  switch (check.result) {
  case 'same':
    return null;
  case 'newer-cli':
    return autoUpgrade ? null :
      `This project uses ${check.recorded} of @fastly/compute-js-static-publish. You are running ${check.running}. ` +
      `Run 'upgrade' to move the project to ${check.running}, or use --auto-upgrade.`;
  case 'older-cli':
    return `This project uses ${check.recorded} of @fastly/compute-js-static-publish, which is newer than the version that runs (${check.running}). ` +
      `Run the CLI at ${check.recorded} or later. An older version never deploys over an app that a newer version made.`;
  case 'missing':
    return `managed.staticPublishVersion is missing in the project file. Run 'upgrade' to set it to ${check.running}.`;
  case 'invalid':
    return `managed.staticPublishVersion '${check.recorded}' is not a version. Run 'upgrade' to set it to ${check.running}.`;
  }
}
