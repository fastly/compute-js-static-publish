/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

const DURATION_MS: Record<string, number> = {
  w: 604_800_000,
  d: 86_400_000,
  h: 3_600_000,
  m: 60_000,
  s: 1_000,
  ms: 1,
};

// Parses something like "1d2h30m" or "5m15s" or "150ms"
function parseDuration(durationStr: string) {
  const regex = /(\d+(?:\.\d+)?)(ms|[dhms])/g;
  let totalMs = 0;
  let matchedLength = 0;

  for (const match of durationStr.matchAll(regex)) {
    const [res, valueStr, unit] = match;
    const value = parseFloat(valueStr);
    totalMs += value * DURATION_MS[unit];
    matchedLength += res.length;
  }

  if (matchedLength !== durationStr.length) {
    throw new Error(`Invalid duration format: '${durationStr}'`);
  }

  return totalMs;
}

export type CalcExpirationTimeArg = {
  expiresIn?: string,
  expiresAt?: string,
  expiresNever?: boolean,
};

export function calcExpirationTime({ expiresIn, expiresAt, expiresNever }: CalcExpirationTimeArg) {
  if ([expiresIn, expiresAt, expiresNever].filter(x => x !== undefined).length > 1) {
    throw new Error('Only one of expiresIn or expiresAt or expiresNever may be provided');
  }

  if (expiresNever) {
    return null;
  }

  if (expiresIn) {
    const deltaMs = parseDuration(expiresIn);
    console.log(`  ⏳  Expiration duration '${expiresIn}' = ${deltaMs} ms`);
    return Math.floor((Date.now() + deltaMs) / 1000); // return UNIX timestamp
  }

  if (expiresAt) {
    const time = Date.parse(expiresAt);
    if (isNaN(time)) {
      throw new Error(`Invalid expiresAt value: '${expiresAt}'`);
    }
    console.log(`  ⏰️ Expiration timestamp '${expiresAt}' = '${new Date(time)}'`);
    console.log(`    → ${new Date(time).toISOString()}`);
    return Math.floor(time / 1000);
  }

  return undefined;
}

export function isExpired(unixTime: number) {
  return unixTime < Math.floor(Date.now() / 1000);
}
