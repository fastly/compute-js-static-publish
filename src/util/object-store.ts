import { callFastlyApi, FastlyApiContext } from "./fastly-api.js";

type CachedValues = {
  objectStoreNameMap?: Record<string, string>,
  objectStoreInfos?: ObjectStoreInfo[],
};

const cache = new WeakMap<FastlyApiContext, CachedValues>();

export async function getObjectStoreIdForNameMap(fastlyApiContext: FastlyApiContext): Promise<Record<string, string>> {
  const cacheEntry = cache.get(fastlyApiContext);

  let objectStoreNameMap = cacheEntry?.objectStoreNameMap;
  if (objectStoreNameMap != null) {
    return objectStoreNameMap;
  }

  const objectStoreInfos = await getObjectStoreInfos(fastlyApiContext);

  objectStoreNameMap = {};
  for (const { id, name } of objectStoreInfos) {
    objectStoreNameMap[name] = id;
  }

  cache.set(fastlyApiContext, { ...cacheEntry, objectStoreNameMap });

  return objectStoreNameMap;
}

export async function getObjectStoreIdForName(fastlyApiContext: FastlyApiContext, objectStoreName: string): Promise<string | null> {

  const objectStoreNameMap = await getObjectStoreIdForNameMap(fastlyApiContext);
  return objectStoreNameMap[objectStoreName] ?? null;
}


type ObjectStoreInfo = {
  id: string,
  name: string,
};
type ObjectStoreInfoMeta = {
  next_cursor?: string,
};
type ObjectStoreInfosResponseModel = {
  data: ObjectStoreInfo[],
  meta: ObjectStoreInfoMeta,
};

// Cache this globally. We don't expect it to change during one run of this app.
let _objectStoreInfos: ObjectStoreInfo[] | undefined = undefined;
export async function getObjectStoreInfos(fastlyApiContext: FastlyApiContext): Promise<ObjectStoreInfo[]> {

  const cacheEntry = cache.get(fastlyApiContext);

  let objectStoreInfos = cacheEntry?.objectStoreInfos;
  if (objectStoreInfos != null) {
    return objectStoreInfos;
  }

  objectStoreInfos = [];

  let cursor: string | null = null;

  while(true) {
    let endpoint = `/resources/stores/object`;
    const queryParams = new URLSearchParams();
    if (cursor != null) {
      queryParams.set('cursor', cursor);
    }

    const response = await callFastlyApi(fastlyApiContext, endpoint, queryParams);
    if (response.status !== 200) {
      throw new Error('Unexpected data format');
    }

    const infos = await response.json() as ObjectStoreInfosResponseModel;

    for (const item of infos.data) {
      objectStoreInfos.push(item);
    }

    if (infos.meta.next_cursor === undefined) {
      break;
    }
    cursor = infos.meta.next_cursor;
  }

  cache.set(fastlyApiContext, { ...cacheEntry, objectStoreInfos });

  return objectStoreInfos;
}


export async function objectStoreEntryExists(fastlyApiContext: FastlyApiContext, objectStoreName: string, key: string): Promise<boolean> {

  const objectStoreId = await getObjectStoreIdForName(fastlyApiContext, objectStoreName);
  if (objectStoreId == null) {
    return false;
  }

  const endpoint = `/resources/stores/object/${encodeURIComponent(objectStoreId)}/keys/${encodeURIComponent(key)}`;

  const response = await callFastlyApi(fastlyApiContext, endpoint, null, { method: 'HEAD' });

  return response.status === 200;

}

const encoder = new TextEncoder();
export async function objectStoreSubmitFile(fastlyApiContext: FastlyApiContext, objectStoreName: string, key: string, data: Uint8Array | string): Promise<void> {

  const objectStoreId = await getObjectStoreIdForName(fastlyApiContext, objectStoreName);
  if (objectStoreId == null) {
    throw new Error('Object store not found');
  }

  const endpoint = `/resources/stores/object/${encodeURIComponent(objectStoreId)}/keys/${encodeURIComponent(key)}`;
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
