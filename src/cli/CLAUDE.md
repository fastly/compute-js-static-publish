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

## Generating the app

`generateApp(config)` (`src/cli/commands/scaffold/generate-app.ts`) makes all files of a scaffolded app as a map from path to content. It does not use the file system or the network. `scaffold` resolves the flags into an `AppConfig` (also the S3 endpoint lookup), calls it, writes the files, and runs `npm install`. Managed mode and `eject` will use the same function.

`test/unit/generate-app.test.js` compares its output with the golden files in `test/golden/<case>/`, and `test/e2e/scaffold-golden.test.js` checks that `scaffold` writes the same files. A change that must not change the generated app must not change a golden file. After an intended change, run `UPDATE_GOLDEN=1 npm test` and check the diff of `test/golden/`. The golden copy of a `.gitignore` is named `_gitignore`, because git would obey a real one in the tree. The dependency on this package is the placeholder `<compute-js-static-publish>`, and `generatedFrom` has `<static-publish-version>` and `<generated-at>`.

The template supplies `src/index.js` and its dependencies (`scaffold/templates/`, `AppTemplate`). In 8.1 there is only `plain`, and users cannot select a template. A template only adds: `generateApp()` throws for a template file that it writes itself. Every app has the template hooks (`prebuild`, `postbuild`, `postinstall` npm scripts that call `compute-js-static-publish run-template-hook <name>`, which runs `scripts/template_<name>.js` if it exists). `src/cli/index.ts` handles `run-template-hook` before it shows the banner or detects the mode, so that the hooks print nothing extra.

## CLI output contract (for CI)

`src/cli/util/cli-output.ts` has the contract: exit codes (`0` success, `1` the operation failed, `2` a usage or config error), the `--json` output (one object on stdout at the end, `schemaVersion: 1`; `console.log` goes to stderr), and the error codes (`CliErrorCode`, documented in the README; adding one is a contract change). `src/cli/index.ts` removes the global flags (`--version`, `--project-dir`, `--non-interactive`, `--json`) from `process.argv` in place (command-line-args removes the first two items only for `process.argv` itself), runs `process.chdir()` for `--project-dir`, and catches uncaught errors (exit `1`, `failed`). Commands call `recordError()`/`reportError()` instead of setting `process.exitCode`, and `setJsonResult()`. Every console method redacts the token and the S3 secret key. Only `publish-content`, `collections list`, and `--version` support `--json`.
