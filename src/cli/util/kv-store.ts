import { callFastlyApi, FastlyApiContext } from "./fastly-api.js";

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

export async function getKVStoreIdForNameMap(fastlyApiContext: FastlyApiContext): Promise<Record<string, string>> {
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

export async function getKVStoreIdForName(fastlyApiContext: FastlyApiContext, kvStoreName: string): Promise<string | null> {

  const kvStoreNameMap = await getKVStoreIdForNameMap(fastlyApiContext);
  return kvStoreNameMap[kvStoreName] ?? null;
}

function createArrayGetter<TEntry>() {
  return function<TFn extends (...args:any[]) => string>(fn: TFn) {
    return async function(fastlyApiContext: FastlyApiContext, ...args: Parameters<TFn>): Promise<TEntry[]> {
      const results: TEntry[] = [];

      let cursor: string | null = null;
      while(true) {
        const queryParams = new URLSearchParams();
        if (cursor != null) {
          queryParams.set('cursor', cursor);
        }

        const endpoint = fn(...args);

        const response = await callFastlyApi(fastlyApiContext, endpoint, queryParams);
        if (response.status !== 200) {
          throw new Error('Unexpected data format');
        }

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

export async function getKVStoreInfos(fastlyApiContext: FastlyApiContext): Promise<KVStoreInfo[]> {

  const cacheEntry = cache.get(fastlyApiContext);

  let kvStoreInfos = cacheEntry?.kvStoreInfos;
  if (kvStoreInfos != null) {
    return kvStoreInfos;
  }

  kvStoreInfos = await _getKVStoreInfos(fastlyApiContext);

  cache.set(fastlyApiContext, { ...cacheEntry, kvStoreInfos });

  return kvStoreInfos;
}

export const _getKVStoreKeys = createArrayGetter<KVStoreEntryInfo>()((kvStoreId: string) => `/resources/stores/kv/${encodeURIComponent(kvStoreId)}/keys`);

export async function getKVStoreKeys(fastlyApiContext: FastlyApiContext, kvStoreName: string): Promise<KVStoreEntryInfo[] | null> {

  const kvStoreId = await getKVStoreIdForName(fastlyApiContext, kvStoreName);
  if (kvStoreId == null) {
    return null;
  }

  return await _getKVStoreKeys(fastlyApiContext, kvStoreId);
}

export async function kvStoreEntryExists(fastlyApiContext: FastlyApiContext, kvStoreName: string, key: string): Promise<boolean> {

  const kvStoreId = await getKVStoreIdForName(fastlyApiContext, kvStoreName);
  if (kvStoreId == null) {
    return false;
  }

  const endpoint = `/resources/stores/kv/${encodeURIComponent(kvStoreId)}/keys/${encodeURIComponent(key)}`;
  const maxRetries = 5;
  let response = Promise.reject();
  for (let i = 0; i < maxRetries; i++) {
    response = response.catch(() => {
      return callFastlyApi(fastlyApiContext, endpoint, null, { method: 'HEAD' })
    }).catch(reason => {
      return new Promise(function (_, reject) {
        setTimeout(() => reject(reason), 500)
      })
    })
  }
  response = await response
  return response.status === 200;
}

const encoder = new TextEncoder();
export async function kvStoreSubmitFile(fastlyApiContext: FastlyApiContext, kvStoreName: string, key: string, data: Uint8Array | string): Promise<void> {

  const kvStoreId = await getKVStoreIdForName(fastlyApiContext, kvStoreName);
  if (kvStoreId == null) {
    throw new Error('KV Store not found');
  }

  const endpoint = `/resources/stores/kv/${encodeURIComponent(kvStoreId)}/keys/${encodeURIComponent(key)}`;
  const body = typeof data === 'string' ? encoder.encode(data) : data;

  const response = await callFastlyApi(fastlyApiContext, endpoint, null, {
    method: 'PUT',
    headers: {
      'content-type': 'application/octet-stream',
    },
    body,
  });

  if (response.status !== 200) {
    throw new Error(`Submitting item ${key} gave error: ${response.status}`);
  }

}

export async function kvStoreDeleteFile(fastlyApiContext: FastlyApiContext, kvStoreName: string, key: string): Promise<void> {

  const kvStoreId = await getKVStoreIdForName(fastlyApiContext, kvStoreName);
  if (kvStoreId == null) {
    throw new Error('KV Store not found');
  }

  const endpoint = `/resources/stores/kv/${encodeURIComponent(kvStoreId)}/keys/${encodeURIComponent(key)}`;

  const response = await callFastlyApi(fastlyApiContext, endpoint, null, {
    method: 'DELETE',
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Deleting item '${key}' gave error: ${response.status}`);
  }

}
