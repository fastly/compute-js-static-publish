import { execSync } from 'child_process';

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

export async function callFastlyApi(fastlyApiContext: FastlyApiContext, endpoint: string, queryParams?: URLSearchParams | null, requestInit?: RequestInit): Promise<Response> {

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
  });
  const response = await fetch(request);
  return response;

}
