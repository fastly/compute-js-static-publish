/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

/// <reference types="@fastly/js-compute" />
import { KVStore, type KVStoreEntry } from 'fastly:kv-store';

// This is a custom KVStoreEntry implementation that is built by using a body and
// metadataText passed in through the constructor. We piggyback off Response
// for the utility functions such as json() and text().
class CustomKVStoreEntry extends Response implements KVStoreEntry {
  constructor(body: BodyInit, metadataText: string) {
    super(body);
    this.metadataTextValue = metadataText;
  }

  private readonly metadataTextValue: string;
  get body(): ReadableStream<Uint8Array> {
    return super.body!;
  }

  metadata(): ArrayBuffer | null {
    return new TextEncoder().encode(this.metadataTextValue);
  }
  metadataText(): string | null {
    return this.metadataTextValue;
  }
}

export async function getKVStoreEntry(
  kvStore: KVStore,
  key: string,
): Promise<KVStoreEntry | null> {

  const entry = await kvStore.get(key);
  if (entry == null) {
    return null;
  }

  const metadataText = entry.metadataText() ?? '';
  if (metadataText === '') {
    return entry;
  }

  let metadata;
  try {
    metadata = JSON.parse(metadataText);
  } catch {
    return entry;
  }

  if (!('numChunks' in metadata) || typeof metadata.numChunks !== 'number') {
    return entry;
  }

  if (metadata.numChunks < 2) {
    return entry;
  }

  const streams = [
    entry.body,
  ];

  for (let chunkIndex = 1; chunkIndex < metadata.numChunks; chunkIndex++) {
    const chunkKey = `${key}_${chunkIndex}`;
    const chunkEntry = await kvStore.get(chunkKey);
    if (chunkEntry == null) {
      throw new Error(`Missing chunk ${chunkKey}`);
    }
    streams.push(chunkEntry?.body);
  }

  const combinedStream = concatReadableStreams(streams);

  return new CustomKVStoreEntry(combinedStream, metadataText);
}

function concatReadableStreams(streams: ReadableStream<Uint8Array>[]): ReadableStream<Uint8Array> {
  let currentStreamIndex = 0;
  let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (true) {
        // If no current reader, get one from the next stream
        if (!currentReader) {
          if (currentStreamIndex >= streams.length) {
            controller.close();
            return;
          }
          currentReader = streams[currentStreamIndex].getReader();
        }

        const { value, done } = await currentReader.read();

        if (done) {
          currentReader.releaseLock();
          currentReader = null;
          currentStreamIndex++;
          continue; // Go to next stream
        }

        controller.enqueue(value);
        return; // Let pull() be called again
      }
    },
    async cancel(reason) {
      if (currentReader) {
        try {
          await currentReader.cancel(reason);
        } catch {
          // swallow
        }
      }
    }
  });
}
