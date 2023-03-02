import { StoreEntry } from "./types/compute.js";

// A class designed to give a Body-style interface to Uint8Array.
// The intended use case is arrays brought in from includeBytes().

export class IncludeBytesStoreEntry implements StoreEntry {
  _consumed: boolean;

  _body: ReadableStreamForBytes;

  constructor(array: Uint8Array) {
    this._body = new ReadableStreamForBytes(array);
    this._consumed = false;
  }

  get body(): ReadableStream<Uint8Array> {
    return this._body;
  }

  get bodyUsed(): boolean {
    return this._consumed;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    if (this._consumed) {
      throw new Error('Body has already been consumed');
    }
    if (this._body.locked) {
      throw new Error('The ReadableStream body is already locked and can\'t be consumed');
    }
    if (this._body._disturbed) {
      throw new Error('Body object should not be disturbed or locked');
    }
    this._consumed = true;

    let result = new Uint8Array(0);
    const reader = this._body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        const newResult = new Uint8Array(result.length + value.length);
        newResult.set(result);
        newResult.set(value, result.length);
        result = newResult;
      }

      return result;
    } finally {
      reader.releaseLock();
    }
  }

  static decoder = new TextDecoder();
  async text(): Promise<string> {
    const data = await this.arrayBuffer();
    return IncludeBytesStoreEntry.decoder.decode(data);
  }

  async json(): Promise<any> {
    const text = await this.text();
    return JSON.parse(text);
  }
}

class ReadableStreamForBytes extends ReadableStream<Uint8Array> {

  // Closest we can get to the "disturbed" flag
  _disturbed = false;

  constructor(array: Uint8Array) {
    super({
      async start(controller) {
        controller.enqueue(array);
        controller.close();
      },
    })
  }

  override getReader(): ReadableStreamDefaultReader<Uint8Array> {

    const reader = super.getReader();

    const stream = this;

    // Monkey-patch read
    const _read = reader.read;
    reader.read = async () => {
      const result = await _read.call(reader);
      if (result.done) {
        // NOTE: C@E Request body does not seem to get marked as "disturbed" until
        // end of stream is reached either...
        stream._disturbed = true;
      }
      return result;
    };

    // Monkey-patch cancel
    const _cancel = reader.cancel;
    reader.cancel = async (reason?: any) => {
      await _cancel.call(reader, reason);
      stream._disturbed = true;
    };

    return reader;

  }

}
