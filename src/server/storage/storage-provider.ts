/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import {
  type StaticPublishRc,
} from '../../models/config/static-publish-rc.js';

export interface StorageProvider {
  getEntry(key: string, tags?: string[]): Promise<StorageEntry | null>;
}

export type StorageProviderBuilder = (config: StaticPublishRc) => (StorageProvider | null);

export interface StorageEntry {
  /**
   * A ReadableStream with the contents of the entry.
   */
  get body(): ReadableStream;

  /**
   * A boolean value that indicates whether the body has been read from already.
   */
  get bodyUsed(): boolean;

  /**
   * Reads the body and returns it as a promise that resolves with a string.
   * The response is always decoded using UTF-8.
   */
  text(): Promise<string>;

  /**
   * Reads the body and returns it as a promise that resolves with the result of parsing the body text as JSON.
   */
  json(): Promise<object>;

  /**
   * Reads the body and returns it as a promise that resolves with an ArrayBuffer.
   */
  arrayBuffer(): Promise<ArrayBuffer>;

  /**
   * Metadata associated with this entry
   */
  metadata(): ArrayBuffer | null;

  /**
   * Metadata string associated with this entry
   * Throws an error for invalid UTF-8
   */
  metadataText(): string | null;
}

// This is a StorageEntry implementation that is built by using a body and
// metadataText passed in through the constructor. We piggyback off Response
// for the utility functions such as json() and text().
export class StorageEntryImpl extends Response implements StorageEntry {
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

export function concatReadableStreams(streams: ReadableStream<Uint8Array>[]): ReadableStream<Uint8Array> {
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

const _storageProviderBuilders: StorageProviderBuilder[] = [];
export function registerStorageProviderBuilder(builder: StorageProviderBuilder) {
  _storageProviderBuilders.push(builder);
}

export function loadStorageProviderFromStaticPublishRc(config: StaticPublishRc) {
  let storeProvider;
  for (const builder of _storageProviderBuilders) {
    storeProvider = builder(config);
    if (storeProvider != null) {
      return storeProvider;
    }
  }
  throw new Error('Static Publisher Error: Invalid static-publish.rc.js, storage mode not recognized, or could not instantiate store provider.');
}
