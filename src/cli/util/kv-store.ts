/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import { callFastlyApi, type FastlyApiContext, FetchError } from './api-token.js';

type KVStoreInfo = {
  id: string,
  name: string,
};

type KVStoreInfoMeta = {
  next_cursor?: string,
};
type DataAndMeta<TEntry> = {
  data: TEntry[],
  meta: KVStoreInfoMeta,
};

type KVStoreEntryInfo = string;

type CachedValues = {
  kvStoreNameMap?: Record<string, string>,
  kvStoreInfos?: KVStoreInfo[],
};

const cache = new WeakMap<FastlyApiContext, CachedValues>();

export async function getKVStoreIdForNameMap(fastlyApiContext: FastlyApiContext) {
  const cacheEntry = cache.get(fastlyApiContext);

  let kvStoreNameMap = cacheEntry?.kvStoreNameMap;
  if (kvStoreNameMap != null) {
    return kvStoreNameMap;
  }

  const kvStoreInfos = await getKVStoreInfos(fastlyApiContext);

  kvStoreNameMap = {};
  for (const { id, name } of kvStoreInfos) {
    kvStoreNameMap[name] = id;
  }

  cache.set(fastlyApiContext, { ...cacheEntry, kvStoreNameMap });

  return kvStoreNameMap;
}

export async function getKVStoreIdForName(fastlyApiContext: FastlyApiContext, kvStoreName: string) {

  const kvStoreNameMap = await getKVStoreIdForNameMap(fastlyApiContext);
  return kvStoreNameMap[kvStoreName] ?? null;

}

function createArrayGetter<TEntry>() {
  return function<TFn extends (...args:any[]) => string>(fn: TFn) {
    return async function(fastlyApiContext: FastlyApiContext, operationName: string, ...args: Parameters<TFn>) {
      const results: TEntry[] = [];

      let cursor: string | null = null;
      while(true) {
        const queryParams = new URLSearchParams();
        if (cursor != null) {
          queryParams.set('cursor', cursor);
        }

        const endpoint = fn(...args);

        const response = await callFastlyApi(fastlyApiContext, endpoint, operationName, queryParams);

        const infos = await response.json() as DataAndMeta<TEntry>;

        for (const item of infos.data) {
          results.push(item);
        }

        if (infos.meta.next_cursor === undefined) {
          break;
        }
        cursor = infos.meta.next_cursor;
      }

      return results;
    };
  };
}

const _getKVStoreInfos = createArrayGetter<KVStoreInfo>()(() => `/resources/stores/kv`);

export async function getKVStoreInfos(fastlyApiContext: FastlyApiContext) {

  const cacheEntry = cache.get(fastlyApiContext);

  let kvStoreInfos = cacheEntry?.kvStoreInfos;
  if (kvStoreInfos != null) {
    return kvStoreInfos;
  }

  kvStoreInfos = await _getKVStoreInfos(fastlyApiContext, 'Listing KV Stores');

  cache.set(fastlyApiContext, { ...cacheEntry, kvStoreInfos });

  return kvStoreInfos;
}

export const _getKVStoreKeys = createArrayGetter<KVStoreEntryInfo>()(
  (kvStoreId: string, prefix?: string) => {
    let endpoint = `/resources/stores/kv/${encodeURIComponent(kvStoreId)}/keys`;
    if (prefix != null) {
      endpoint += '?prefix=' + encodeURIComponent(prefix);
    }
    return endpoint;
  }
);

export async function getKVStoreKeys(
  fastlyApiContext: FastlyApiContext,
  kvStoreName: string,
  prefix?: string,
) {

  const kvStoreId = await getKVStoreIdForName(fastlyApiContext, kvStoreName);
  if (kvStoreId == null) {
    return null;
  }

  return await _getKVStoreKeys(
    fastlyApiContext,
    `Listing Keys for KV Store [${kvStoreId}] ${kvStoreName}${prefix != null ? ` (prefix '${prefix}')` : ''}`,
    kvStoreId,
    prefix,
  );
}

export async function getKvStoreEntryInfo(fastlyApiContext: FastlyApiContext, kvStoreName: string, key: string) {

  return getKvStoreEntry(fastlyApiContext, kvStoreName, key, true);

}

export async function getKvStoreEntry(
  fastlyApiContext: FastlyApiContext,
  kvStoreName: string,
  key: string,
  metadataOnly?: boolean,
) {

  const kvStoreId = await getKVStoreIdForName(fastlyApiContext, kvStoreName);
  if (kvStoreId == null) {
    return null;
  }

  const endpoint = `/resources/stores/kv/${encodeURIComponent(kvStoreId)}/keys/${encodeURIComponent(key)}`;

  let response: Response;
  try {

    response = await callFastlyApi(fastlyApiContext, endpoint, `Checking existence of [${key}]`, null, { method: metadataOnly ? 'HEAD' : 'GET' });

  } catch(err) {
    if (err instanceof FetchError && err.status === 404) {
      return null;
    }
    throw err;
  }

  const metadata = response.headers.get('metadata');
  const generation = response.headers.get('generation');
  return {
    metadata,
    generation,
    response,
  };

}

const encoder = new TextEncoder();
export async function kvStoreSubmitEntry(
  fastlyApiContext: FastlyApiContext,
  kvStoreName: string,
  key: string,
  data: ReadableStream<Uint8Array> | Uint8Array | string,
  metadata: string | undefined,
) {

  const kvStoreId = await getKVStoreIdForName(fastlyApiContext, kvStoreName);
  if (kvStoreId == null) {
    throw new Error('KV Store not found');
  }

  const endpoint = `/resources/stores/kv/${encodeURIComponent(kvStoreId)}/keys/${encodeURIComponent(key)}`;
  const body = typeof data === 'string' ? encoder.encode(data) : data;

  await callFastlyApi(fastlyApiContext, endpoint, `Submitting item [${key}]`, null, {
    method: 'PUT',
    headers: {
      'content-type': 'application/octet-stream',
      ...(metadata != null ? { metadata } : null)
    },
    body,
  });

}

export async function kvStoreDeleteEntry(fastlyApiContext: FastlyApiContext, kvStoreName: string, key: string) {

  const kvStoreId = await getKVStoreIdForName(fastlyApiContext, kvStoreName);
  if (kvStoreId == null) {
    throw new Error('KV Store not found');
  }

  const endpoint = `/resources/stores/kv/${encodeURIComponent(kvStoreId)}/keys/${encodeURIComponent(key)}`;

  await callFastlyApi(fastlyApiContext, endpoint, `Deleting item [${key}]`, null, {
    method: 'DELETE',
  });

}
