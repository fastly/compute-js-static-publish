# CLAUDE.md (CLI)

## `publish-content` flow

1. If `--overwrite-existing` and `--local` are not set, list the `<publishId>_files_sha256_` keys one time. The KV Store list uses `consistency=strong`. `getStorageKeysByHexPrefix()` runs 16 listings at the same time, one for each hex digit after the prefix, because a listing gets its pages one after another (about 0.36 s for each 1,000 keys on S3 in a test).
2. Scan the files with `concurrentMap()`, at most 16 at a time (or the CPU count, if it is less). For each variant: if its key is in the list, skip the variant. Do not compress, hash, or upload it.
   - For a chunked original, all keys `_1`, `_2`, … must be in the list.
   - Skip a compressed variant only if the original fits in one chunk. The chunk count of a compressed variant is not known before compression.
3. Upload a compressed variant only if it is smaller than the original. Thus, if a compressed variant is in storage, the index keeps it. Variants that are not smaller are compressed again at each publish. Most of these are very small files.
   - Compression uses async zlib, so it runs in parallel on the libuv thread pool. `src/cli/index.ts` sets `UV_THREADPOOL_SIZE` (4 to 16, from the CPU count) if it is not set. Do not use the `*Sync` zlib functions: they block the event loop, so files are compressed one at a time.
   - `brotliQuality` in `publish-content.config.js` sets the brotli quality (default 11, the slowest). `--brotli-quality` overrides it. If neither is set, the output is the same as the zlib default.
4. `applyBatch(batch, { existingKeys })`:
   - The KV provider splits files that are larger than 20 MiB into chunks (S3 does not use chunks). It removes the chunks that are in storage. Then it uploads NDJSON batches of at most 256 items / 8 MiB. Larger entries use one PUT each.
   - The S3 provider uploads one `PutObject` for each entry, 64 at a time by default (`--s3-upload-concurrency`). The S3 client gets an HTTP agent with enough sockets for this; the SDK default is 50.
5. The CLI writes the index and the settings only after all uploads are successful.

`src/cli/storage/CLAUDE.md` has the measured limits of the KV batch endpoint.
