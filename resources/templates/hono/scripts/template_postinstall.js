// Runs after each install (the postinstall template hook). If
// src/hono-compose.generated.js does not exist yet, writes it with no
// plugins, so that src/index.ts can import it before the first build.
import fs from 'node:fs';
import path from 'node:path';
import { PLUGINS_MANIFEST, writePluginsStub } from '@fastly/compute-js-static-publish/hono/build';

if (!fs.existsSync(path.resolve(PLUGINS_MANIFEST))) {
  writePluginsStub({ appDir: process.cwd() });
}
