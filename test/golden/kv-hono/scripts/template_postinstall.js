// Runs after each install (the postinstall template hook). If
// src/hono-extensions.generated.js does not exist yet, writes it with no
// modules, so that src/index.ts can import it before the first build.
import fs from 'node:fs';
import path from 'node:path';
import { HONO_EXTENSIONS_MANIFEST, writeHonoExtensionsStub } from '@fastly/compute-js-static-publish/hono/build';

if (!fs.existsSync(path.resolve(HONO_EXTENSIONS_MANIFEST))) {
  writeHonoExtensionsStub({ appDir: process.cwd() });
}
