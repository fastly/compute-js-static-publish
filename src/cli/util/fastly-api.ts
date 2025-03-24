import { execSync } from 'child_process';
import { makeRetryable } from './retryable.js';

export interface FastlyApiContext {
  apiToken: string,
};

export type LoadApiKeyResult = {
  apiToken: string,
  source: string,
};

export function loadApiKey(): LoadApiKeyResult | null {

  let apiToken: string | null = null;
  let source: string = '';

  // Try to get API key from FASTLY_API_TOKEN
  apiToken = process.env.FASTLY_API_TOKEN || null;
  if (apiToken != null) {
    source = 'env';
  }

  if (apiToken == null) {
    // Try to get API key from fastly cli
    try {
      apiToken = execSync('fastly profile token --quiet', {
        encoding: 'utf-8',
      })?.trim() || null;
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

export async function callFastlyApi(
  fastlyApiContext: FastlyApiContext,
  endpoint: string,
  operationName: string,
  queryParams?: URLSearchParams | null,
  requestInit?: RequestInit,
): Promise<Response> {

  let finalEndpoint = endpoint;
  if (queryParams != null) {
    const queryString = String(queryParams);
    if (queryString.length > 0) {
      finalEndpoint += '?' + queryString;
    }
  }

  const url = new URL(finalEndpoint, 'https://api.fastly.com/');

  const headers = new Headers(requestInit?.headers);
  headers.set('Fastly-Key', fastlyApiContext.apiToken);

  const request = new Request(url, {
    ...requestInit,
    headers,
    redirect: 'error',
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
