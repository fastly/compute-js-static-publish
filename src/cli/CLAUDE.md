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

The log lines for each file (scan) and each upload go through `ProgressLog` (`util/progress.ts`). Without `--verbose`, it logs only a progress line after each 1,000 items, because a large site has tens of thousands of files.

`src/cli/storage/CLAUDE.md` has the measured limits of the KV batch endpoint.

## Generating the app

`generateApp(config)` (`src/cli/commands/scaffold/generate-app.ts`) makes all files of a scaffolded app as a map from path to content. It does not write files or use the network. It reads only `resources/`:

- `resources/templates/<name>/`: a template. Its files (for example `src/index.js`) are copied into the app as they are. Its `package.json` and `package-lock.json` are not app files: `generateApp()` reads the dependencies from the `package.json`. To change a dependency, edit the `package.json` and run `npm install --package-lock-only --ignore-scripts` in the template directory. The template `package.json` has no `scripts` and does not list this package, so that `npm install --package-lock-only --ignore-scripts` in the template directory runs nothing. CI checks that each lockfile matches its `package.json`. `app-template.ts` lists the valid template names.
- `resources/app/*.njk`: `fastly.toml`, `static-publish.rc.js`, `publish-content.config.js`, and `.gitignore`, rendered with Nunjucks (`render.ts`). Autoescape is off. Each `{{ … }}` must use one of the filters `js`, `toml`, `tomlKey`, or `line`, which write the value in the syntax of the file. A unit test checks this.

A template never has a file that `generateApp()` writes itself; `generateApp()` throws if it does. `scaffold` resolves the flags into an `AppConfig` (also the S3 endpoint lookup), calls it, writes the files, and runs `npm install`.

`test/unit/generate-app.test.js` compares its output with the golden files in `test/golden/<case>/`, and `test/e2e/scaffold-golden.test.js` checks that `scaffold` writes the same files. A change that must not change the generated app must not change a golden file. After an intended change, run `UPDATE_GOLDEN=1 npm test` and check the diff of `test/golden/`. The golden copy of a `.gitignore` is named `_gitignore`, because git would obey a real one in the tree. The dependency on this package is the placeholder `<compute-js-static-publish>`, and the version and the date in `generatedFrom` are `<static-publish-version>` and `<generated-at>`.

## Before the mode is detected

`src/cli/index.ts` handles these before it detects the mode:

- `run-template-hook <name>`: the template hooks call it. It prints no banner, and works in any directory.
- `--version`: prints only the version.
- `--project-dir`: the CLI checks that the directory has `static-publish.rc.js`, then runs `process.chdir()` into it. Thus every relative path, also the paths in the options, is relative to the project dir. `parseGlobalOptions()` removes these options from `process.argv` before the commands parse it.
