/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// Returns true if version (for example, fastly.sdkVersion, '4.3.0') is
// major.minor or later. A version that is missing or cannot be read gives false.
export function isSdkVersionAtLeast(version: string | null | undefined, major: number, minor: number): boolean {
  const match = /^(\d+)\.(\d+)/.exec(version ?? '');
  if (match == null) {
    return false;
  }
  const versionMajor = Number(match[1]);
  const versionMinor = Number(match[2]);
  return versionMajor > major || (versionMajor === major && versionMinor >= minor);
}
