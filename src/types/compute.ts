export type StoreEntryInfo = {
  readonly storeEntry: StoreEntry;
  readonly contentEncoding: string | null;
  readonly hash: string;
}

export interface StoreEntry {
  readonly body: ReadableStream<Uint8Array> | null;
  readonly bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  // blob(): Promise<Blob>;
  // formData(): Promise<FormData>;
  json(): Promise<any>;
  text(): Promise<string>;
}
