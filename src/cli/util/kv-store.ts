import { callFastlyApi, FastlyApiContext, FetchError } from "./fastly-api.js";

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

export const _getKVStoreKeys = createArrayGetter<KVStoreEntryInfo>()((kvStoreId: string) => `/resources/stores/kv/${encodeURIComponent(kvStoreId)}/keys`);

export async function getKVStoreKeys(fastlyApiContext: FastlyApiContext, kvStoreName: string) {

  const kvStoreId = await getKVStoreIdForName(fastlyApiContext, kvStoreName);
  if (kvStoreId == null) {
    return null;
  }

  return await _getKVStoreKeys(fastlyApiContext, `Listing Keys for KV Store [${kvStoreId}] ${kvStoreName}`, kvStoreId);
}

export async function kvStoreEntryExists(fastlyApiContext: FastlyApiContext, kvStoreName: string, key: string) {

  const kvStoreId = await getKVStoreIdForName(fastlyApiContext, kvStoreName);
  if (kvStoreId == null) {
    return false;
  }

  const endpoint = `/resources/stores/kv/${encodeURIComponent(kvStoreId)}/keys/${encodeURIComponent(key)}`;

  try {

    await callFastlyApi(fastlyApiContext, endpoint, `Checking existence of [${key}]`, null, { method: 'HEAD' });

  } catch(err) {
    if (err instanceof FetchError && err.status === 404) {
      return false;
    }
    throw err;
  }

  return true;

}

const encoder = new TextEncoder();
export async function kvStoreSubmitFile(fastlyApiContext: FastlyApiContext, kvStoreName: string, key: string, data: Uint8Array | string) {

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
    },
    body,
  });

}

export async function kvStoreDeleteFile(fastlyApiContext: FastlyApiContext, kvStoreName: string, key: string) {

  const kvStoreId = await getKVStoreIdForName(fastlyApiContext, kvStoreName);
  if (kvStoreId == null) {
    throw new Error('KV Store not found');
  }

  const endpoint = `/resources/stores/kv/${encodeURIComponent(kvStoreId)}/keys/${encodeURIComponent(key)}`;

  await callFastlyApi(fastlyApiContext, endpoint, `Deleting item [${key}]`, null, {
    method: 'DELETE',
  });

}
