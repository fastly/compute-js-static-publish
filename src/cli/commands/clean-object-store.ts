import path from 'path';
import type { CommandLineOptions } from "command-line-args";

import { generateOrLoadPublishId } from "../util/publish-id.js";
import { loadConfigFile } from "../load-config.js";
import { getObjectStoreKeys, objectStoreDeleteFile } from "../util/object-store.js";
import { FastlyApiContext, loadApiKey } from "../util/fastly-api.js";
import { getObjectStoreKeysFromMetadata } from "../../util/metadata.js";
type StaticsMetadataModule = typeof import('../../../resources/statics-metadata.js');

export async function cleanObjectStore(commandLineValues: CommandLineOptions) {

  const { publishId } = generateOrLoadPublishId();

  const errors: string[] = [];
  const { normalized: config } = await loadConfigFile(errors);

  if (config == null) {
    console.error("❌ Can't load static-publish.rc.js");
    console.error("Run this from a compute-js-static-publish compute-js directory.");
    for (const error of errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }

  let fastlyApiContext: FastlyApiContext | null = null;

  const apiKeyResult = loadApiKey();
  if (apiKeyResult == null) {
    console.error("❌ Fastly API Token not provided.");
    console.error("Specify one on the command line, or use the FASTLY_API_TOKEN environment variable.");
    process.exitCode = 1;
    return;
  }

  fastlyApiContext = { apiToken: apiKeyResult.apiToken };

  const staticsMetadata: StaticsMetadataModule = await import(path.resolve('./src/statics-metadata.js'));

  const { objectStoreName, contentAssetMetadataMap } = staticsMetadata;

  if (objectStoreName == null) {
    console.error("❌ Object store not specified.");
    console.error("This only has meaning in object store mode.");
    process.exitCode = 1;
    return;
  }

  // TODO: Enable getting objectStoreName and publishId from command line

  // These are the items that are currently in the object store and that belong to this publish ID.
  const items = ((await getObjectStoreKeys(fastlyApiContext, objectStoreName)) ?? [])
    .filter(x => x.startsWith(`${publishId}:`));

  // These are the items that are currently are being used.
  const keys = getObjectStoreKeysFromMetadata(contentAssetMetadataMap);

  // So these are the items that we should be deleting.
  const itemsToDelete = items.filter(x => !keys.has(x));

  console.log("Publish ID: " + publishId);
  console.log("Object Store contains " + items.length + " item(s) for this publish ID.");
  console.log("Current site metadata contains " + keys.size + " item(s) (including compressed alternates).");

  console.log("Number of items to delete: " + itemsToDelete.length);

  for (const [index, item] of itemsToDelete.entries()) {
    console.log("Deleting item [" + (index+1) + "]: " + item);
    await objectStoreDeleteFile(fastlyApiContext, objectStoreName, item);
  }

  console.log("✅ Completed.")
}
