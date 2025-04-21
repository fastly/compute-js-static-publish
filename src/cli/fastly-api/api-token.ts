/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { spawnSync } from 'node:child_process';
import cli from '@fastly/cli';

import { makeRetryable } from '../util/retryable.js';

export interface FastlyApiContext {
  apiToken: string,
}

export type LoadApiTokenResult = {
  apiToken: string,
  source: string,
};

export type LoadApiParams = {
  commandLine: any,
};

export function loadApiToken(params: LoadApiParams): LoadApiTokenResult | null {

  let apiToken: string | null = null;
  let source: string = '';

  // Try command line arg
  if (typeof params.commandLine === 'string') {
    apiToken = params.commandLine.trim();
    source = 'commandline';
  }

  // Try env (FASTLY_API_TOKEN)
  if (apiToken == null) {
    apiToken = process.env.FASTLY_API_TOKEN || null;
    if (apiToken != null) {
      source = 'env';
    }
  }

  // Try fastly cli
  if (apiToken == null) {
    try {
      const { stdout, error } = spawnSync(cli, ['profile', 'token', '--quiet'], {
        encoding: 'utf-8',
      });
      apiToken = error ? null : stdout.trim();
    } catch {
      apiToken = null;
    }
    if (apiToken != null) {
      source = 'fastly-profile-token';
    }
  }

  if (apiToken == null) {
    return null;
  }

  return { apiToken, source };

}

const RETRYABLE_STATUS_CODES = [
  408, // Request Timeout
  409, // Conflict (depends)
  423, // Locked
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
];

export class FetchError extends Error {
  constructor(message: string, status: number) {
    super(message);
    this.name = 'FetchError';
    this.status = status;
  }
  status: number;
}

function isReadableStream(data: unknown): data is ReadableStream {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as ReadableStream).getReader === 'function' &&
    typeof (data as ReadableStream).tee === 'function'
  );
}

export async function callFastlyApi(
  fastlyApiContext: FastlyApiContext,
  endpoint: string,
  operationName: string,
  queryParams?: URLSearchParams | null,
  requestInit?: RequestInit,
): Promise<Response> {

  const url = new URL(endpoint, 'https://api.fastly.com/');
  if (queryParams != null) {
    for (const [key, value] of queryParams.entries()) {
      url.searchParams.append(key, value);
    }
  }

  const headers = new Headers(requestInit?.headers);
  headers.set('Fastly-Key', fastlyApiContext.apiToken);

  const request = new Request(url, {
    ...requestInit,
    headers,
    redirect: 'error',
    ...(isReadableStream(requestInit?.body) ? { duplex: 'half' } as RequestInit : null),
  });

  let response;
  try {
    response = await fetch(request);
  } catch(err) {
    if (err instanceof TypeError) {
      throw makeRetryable(err);
    } else {
      throw err;
    }
  }
  if (!response.ok) {
    if (!RETRYABLE_STATUS_CODES.includes(response.status)) {
      throw new FetchError(`${operationName} failed: ${response.status}`, response.status);
    }
    throw makeRetryable(new FetchError(`Retryable ${operationName} error: ${response.status}`, response.status));
  }
  return response;

}
