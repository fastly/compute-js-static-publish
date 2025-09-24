/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import fs from 'node:fs';
import { StorageProviderBatchEntry } from '../storage/storage-provider.js';
import { directoryExists, getFileSize } from './files.js';

// split large files into 20MiB chunks
export const KV_STORE_CHUNK_SIZE = 1_024 * 1_024 * 20;

export function shouldRecreateChunks(chunksDir: string, numChunks: number, item: StorageProviderBatchEntry, chunkSize: number) {
  console.log(` 📄 '${item.key}' - ${item.size} bytes → ${numChunks} chunks`)
  if (!directoryExists(chunksDir)) {
    console.log(`  ・ Creating chunks for '${item.key}' - found no existing chunks`);
    return true;
  }

  const existingChunks = fs.readdirSync(chunksDir).length;
  if (existingChunks !== numChunks) {
    console.log(`  ・ Recreating chunks for '${item.key}' - found ${existingChunks} existing chunk(s), expected ${numChunks}`);
    return true;
  }

  const finalChunkSize = item.size % chunkSize;
  for (let chunk = 0; chunk < numChunks; chunk++) {
    const chunkFileName = `${chunksDir}/${chunk}`;
    // If the chunk does not exist
    if (!fs.existsSync(chunkFileName)) {
      console.log(`  ・ Recreating chunks for '${item.key}' - chunk ${chunk} does not exist`);
      return true;
    }

    // or if the chunk isn't the expected size
    const expectedFileSize = chunk === numChunks - 1 ? finalChunkSize : chunkSize;

    const existingFileSize = getFileSize(chunkFileName);
    if (existingFileSize !== expectedFileSize) {
      console.log(`  ・ Recreating chunks for '${item.key}' - chunk ${chunk} existing file size ${existingFileSize} does not match expected size ${expectedFileSize}`);
      return true;
    }
  }

  console.log(`  ・ Existing chunks for '${item.key}' look good.`);
  return false;
}

export async function applyKVStoreEntriesChunks(kvStoreItemDescriptions: StorageProviderBatchEntry[], chunkSize: number) {

  const items = kvStoreItemDescriptions.splice(0);
  // kvStoreItemDescriptions is now empty.

  for (const item of items) {
    if (item.size <= chunkSize) {
      // If file is not over the chunk size, use it as it is.
      kvStoreItemDescriptions.push(item);
      continue;
    }

    // Check if the chunks exist on disk, and if they don't, recreate them.

    const chunksDir = `${item.filePath}_chunks`;
    const numChunks = Math.ceil(item.size / chunkSize);

    if (shouldRecreateChunks(chunksDir, numChunks, item, chunkSize)) {
      // Recreate chunks
      fs.rmSync(chunksDir, { recursive: true, force: true });
      fs.mkdirSync(chunksDir, { recursive: true });

      const numWrittenChunks = await new Promise<number>((resolve, reject) => {
        const chunkPaths: string[] = [];
        let chunkIndex = 0;
        let bytesWritten = 0;
        let currentStream: fs.WriteStream | null = null;

        const inputStream = fs.createReadStream(item.filePath);
        inputStream.on('error', reject);

        inputStream.on('data', (chunk) => {
          let offset = 0;

          while (offset < chunk.length) {
            if (!currentStream || bytesWritten >= chunkSize) {
              if (currentStream != null) {
                currentStream.end();
              }
              const chunkFileName = `${chunksDir}/${chunkIndex}`;
              currentStream = fs.createWriteStream(chunkFileName);
              chunkPaths.push(chunkFileName);
              chunkIndex++;
              bytesWritten = 0;
            }

            const bytesLeftInChunk = chunkSize - bytesWritten;
            const bytesLeftInBuffer = chunk.length - offset;
            const bytesToWrite = Math.min(bytesLeftInChunk, bytesLeftInBuffer);
            const slice = chunk.slice(offset, offset + bytesToWrite);

            currentStream.write(slice);
            bytesWritten += bytesToWrite;
            offset += bytesToWrite;
          }
        });

        inputStream.on('end', () => {
          if (currentStream != null) {
            currentStream.end();
          }
          resolve(chunkPaths.length);
        });
      });

      if (numWrittenChunks !== numChunks) {
        throw new Error(`numWrittenChunks (${numWrittenChunks}) does not equal numChunks (${numChunks})`);
      }
    }

    for (let chunkIndex = 0; chunkIndex < numChunks; chunkIndex++) {

      const kvItem = structuredClone(item);

      // Source the chunk from the chunk directory
      kvItem.filePath = `${chunksDir}/${chunkIndex}`;

      // Add chunk ID to metadata
      if (kvItem.metadataJson == null) {
        kvItem.metadataJson = {};
      }
      kvItem.metadataJson.chunkIndex = String(chunkIndex);

      if (chunkIndex !== 0) {

        // For additional chunks (all but the first):
        // add suffix to key
        kvItem.key = item.key + '_' + chunkIndex;
        // remove other metadata
        delete kvItem.metadataJson.hash;
        delete kvItem.metadataJson.size;
        delete kvItem.metadataJson.numChunks;

      }

      kvStoreItemDescriptions.push(kvItem);

    }
  }

}
