# 8.2 design

All decisions in this file were made on 2026-10-17 and 2026-10-18, unless a date is given. It builds on the 8.1 design ([../v8.1/design.md](../v8.1/design.md)): `generateApp()`, the file-based `AppTemplate`, the template hooks, `generatedFrom`, the `serveRequest()` options, collection selection, and managed mode.

## 1. Scope

- Templates for users: `--template` and `managed.template` (item 3b).
- Hono: the middleware export `/hono` (item 6) and the `hono` template (item 7). Before 8.2, Hono support was in a separate package, `@fastly/hono-compute-js-static-publish`, which supports only v6 and v7. Its `serveStatic()` looked up the request path in the index directly, so it did not use `autoIndex`, `autoExt`, the response cache, or `Server-Timing`.
- Hono extensions (items 20 to 25): users add their own Hono middleware and routes **in managed mode**, with files in a known folder and options from the config. The main example: GRIP middleware (`@fanoutio/serve-grip/hono`) and a streaming route, or auth middleware, with no eject.

## 2. Templates for users (item 3b)

- **Input:** `--template <name>` (`plain` or `hono`; default `plain`), and `managed.template` in managed mode. A missing value means `plain`, so projects made with 8.1 work with no change.
- A name that is not valid is an error that lists the valid names, and nothing is written. The list of templates is looked up by its own keys only (`hasOwnProperty`), so a name such as `constructor` is not valid.
- `--help` shows the option and the valid names.
- **Switching templates in managed mode:** change `managed.template`. The next `dev` or `deploy` generates the app again with the new template, `npm ci` installs the new template's dependencies (and removes what the old template had), and the change of the fingerprint triggers a deploy.
- **In ejected mode there is no switching.** The app is the user's code, and `generatedFrom.template` is only a record. To move an ejected app to another template is a change by hand.
- Each template's settings are namespaced (`build.<template>`, `templateOptions.<template>`). Thus a user can try another template, and the settings of the earlier template stay, unused, until the user switches back.

## 3. Hono middleware (item 6)

`@fastly/compute-js-static-publish/hono`. The module imports only types from `hono`, so it does not add `hono` to the bundle. `hono` is an optional peer dependency (`^4.0.0`). `package.json` gets a new export, `./hono`.

### `fromStaticPublishRc(rc, defaults?)` and `fromPublisherServer(server, defaults?)`

- Input: the contents of `static-publish.rc.js`, or a `PublisherServer`. Optional `defaults.collectionName`.
- Output: `{ publisherServer, serveStatic, serveFallback }`. `serveStatic` and `serveFallback` make middleware that uses the defaults. An option in a call replaces the default.

### `serveStatic(options?)` → Hono `MiddlewareHandler`

- Input: the request (`c.req`), and these options:
  - `root`: the directory that request paths are relative to, in the published files (after `publicDirPrefix`, if it is set). Default `./`.
  - `path`: a path to serve in place of the request path, for example `./favicon.ico`.
  - `rewriteRequestPath(path, c)`: changes the request path before it is resolved against `root`.
  - `collectionName`: a string, `null` (the default collection), or `(c) => string | null | undefined`. `undefined` selects the active collection.
- Output:
  - A file matches: the response of `serveRequest()`, including `304`, the compressed variants, the cache headers, the response cache, and `Server-Timing`.
  - No file matches, or the method is not `GET` or `HEAD`: `next()` is called, so a later route can handle the request.
  - The resolved path is outside `root` (for example with `..`): the file is not served, and `next()` is called.
- `serveStatic()` does not serve the SPA file or the 404 page, and does not answer `/healthz`. (It calls `serveRequest()` with `fallback: false` and `healthCheck: false`.)
- A fix from the old package: `root += root` is now `root += '/'`.

### `serveFallback(options?)` → Hono `NotFoundHandler`, for `app.notFound()`

- Input: the request, and `collectionName` as above.
- Output: the SPA file with status `200` if the collection has one; else the 404 page with status `404` if it has one; else, or if the client does not accept HTML, Hono's default `404 Not Found` text response.

### Migration from the old package

`MIGRATING.md` gets "Move from `@fastly/hono-compute-js-static-publish`": uninstall the old package and make `hono` a dependency; change the import; get `serveStatic` (and `serveFallback`) from the object that `fromStaticPublishRc()` returns; `serveStatic()` now applies `publicDirPrefix` (deprecated), `autoIndex`, and `autoExt`, and serves only `GET` and `HEAD`, so `root` is relative to `publicDirPrefix` if it is set; `serveStatic()` does not serve the fallback pages, so add `app.notFound(serveFallback())`.

## 4. The `hono` template (item 7)

- **Input:** `--template hono` (or `managed.template: 'hono'`).
- **Output:**
  - `src/index.js`: a Hono app. It uses `serveStatic()` for files, `app.notFound(serveFallback())` for the SPA file and the 404 page, and `fire(app)` from `@fastly/hono-fastly-compute`.
  - Extra `dependencies`: `hono` `^4.13.0` and `@fastly/hono-fastly-compute` `^0.4.0` (0.4.0 accepts `@fastly/js-compute` 4).
  - `gitignore`: `.hono-extensions/` and `src/hono-extensions.generated.js` (item 22).
- The template does not use `hono/service-worker`: by default, its handler sends each 404 response to `fetch()`, and Compute has no default backend.
- The template uses `logFastlyServiceVersion()` from `@fastly/hono-fastly-compute`, in place of its own logging middleware.
- **Values of this package on `c.var.staticPublisher`** ("things that belong to static-publisher"), set by a middleware of the template before the extensions. `/hono` exports the type.
  - `c.var.staticPublisher.publisherServer`: the app's `PublisherServer`.
  - `c.var.staticPublisher.collectionName`: the collection that collection selection chose.
- **Collection selection:** a middleware calls `resolveCollection()`, returns its `response` if it has one, and sets `c.var.staticPublisher.collectionName`. `fromStaticPublishRc(rc, { collectionName: (c) => c.var.staticPublisher.collectionName })`. The `path` source uses `rewriteRequestPath`. The template declares `supports.collectionSelection`.
- **Managed mode:** the `hono` template's lockfile (item 14), and tests with `managed.template: 'hono'`, including a switch from `plain` to `hono`.

## 5. Hono extensions (items 20 to 25)

A feature of the `hono` template, not of the core of this package. The folder is named `hono-extensions/`, because it is specific to the `hono` template and configures it.

### Layout

```
my-site/                          ← project dir
├── static-publish.project.js
└── hono-extensions/              ← the user's code (committed)
    ├── middleware/
    │   ├── 10-auth.js            → app.use('*', …), before everything else
    │   ├── 20-grip.ts
    │   └── _example.js           → skipped (inactive example from template init)
    ├── routes/
    │   └── stream.js             → mounted before the static files
    ├── lib/                      → helpers (not scanned)
    ├── package.json              ← dependencies of the extension code
    └── package-lock.json         ← the user's lockfile
```

- The location is `build.hono.extensionsDir` (default `./hono-extensions`), in `static-publish.project.js` (managed) or `static-publish.rc.js` (ejected). The path is relative to that file. It is a `build` setting, so it applies in managed and in ejected mode. (Not `extDir`: in this project "ext" means a file extension, as in `autoExt`.)
- **The folder is optional.** Without it, or with it empty, the app is **exactly** the default `hono` app: the manifest has empty lists, so the loops in `src/index.js` mount nothing. `src/index.js` is the same with or without the folder; only `src/hono-extensions.generated.js` changes. The fingerprint is the same as for any project without the folder. Each subfolder is optional by itself. To add or remove the folder later changes the fingerprint, so the next deploy uses it.

### Build: the hooks of the template (item 22)

The `hono` template ships `scripts/template_prebuild.js` and `scripts/template_postinstall.js` as files in the app, the same as `src/index.js`. The core of this package has no code for extensions: it only writes the template's files, and the template hooks (8.1) run them.

`template_prebuild.js` (runs before each build):

1. Reads `build.hono.extensionsDir` (from the app's rc; in managed mode, the generator passes the resolved path).
2. Deletes `<appDir>/.hono-extensions/`, then **copies** the extensions folder there: its files and its installed `node_modules`, **without the packages that the template provides**.
3. Scans the copy (`middleware/`, `routes/`) in file-name order.
4. Writes **`src/hono-extensions.generated.js`**: the manifest, which imports each module from the copy, and collects the modules' bindings.

```js
// src/hono-extensions.generated.js (written by template_prebuild.js)
import m0 from '../.hono-extensions/middleware/10-auth.js';
import m1 from '../.hono-extensions/middleware/20-grip.ts';
import r0 from '../.hono-extensions/routes/stream.js';
export const middleware = [ { name: 'auth', module: m0 }, { name: 'grip', module: m1 } ];
export const routes = [ { name: 'stream', module: r0 } ];
export const bindings = { /* merged from the modules */ };
```

`js-compute-runtime` already bundles with esbuild (its `bundle` step: `bundle: true`, the `fastly` package condition, and a plugin that resolves `fastly:*` imports). It bundles `src/index.js`, which imports the manifest and, through it, every module and what the modules import. The template does not bundle anything itself. `build` is not changed.

- **The copy is at a fixed path in the app dir:** `<appDir>/.hono-extensions/` (`.static-publish/app/.hono-extensions/` in managed mode, `compute-js/.hono-extensions/` in ejected mode), not in the working dir.
- **Why copy** (and not import from the folder directly): imports resolve by going up the directory tree from the file that imports. From `hono-extensions/`, `hono` would resolve to `hono-extensions/node_modules/hono`, a second copy next to the app's. From the copy in the app dir, anything that is not in the copy's `node_modules` (the provided packages) resolves to the **app's** `node_modules`: one `hono` in the bundle.
- **The manifest is always generated, never a source file,** in both modes, because it comes from the current files: each build writes it again; `template_postinstall.js` also writes it (or a stub with empty lists) only so that it exists before the first build, so that an editor does not flag the import in `src/index.js` (this matters for ejected apps, where users edit `src/index.js`); it is never committed (the template's `gitignore` field). A committed stub does not work: git still shows changes to a tracked file that is in `.gitignore`.
- The scripts need only Node (`fs`, `path`). They can use the public helper API (item 21).
- **Because the scripts are part of the app:** `eject` writes them to the same place, so the ejected app builds the same; after eject, they stay with the app, like `src/index.js` (an upgrade of this package cannot change the manifest format under an ejected `src/index.js`); in managed mode, they are generated again with the rest of the app and are in the fingerprint; after eject, the user can change them.

### Which files are modules

- **File types:** `.js`, `.mjs`, `.ts`, `.mts`. js-compute's esbuild step handles TypeScript (it removes the types; it does no type checking). `.d.ts` files are ignored. (`.tsx`/`.jsx`, for `hono/jsx`, can come later.)
- **Only files directly in `middleware/` and `routes/` are modules.** Subfolders are not scanned, and files that start with `_` or `.` are skipped. Thus helpers can be next to modules (`middleware/_shared.ts`, `middleware/lib/sign.ts`), or in a folder such as `hono-extensions/lib/`.
- **Name** = the file name without the order prefix and the extension (`20-grip.ts` → `grip`). It is the key in `templateOptions.hono`. Two files with the same name (`20-grip.js` and `20-grip.ts`, or `10-grip.js` and `20-grip.ts`) are an error.
- **Order of middleware:** the file-name prefix (`10-`, `20-`, …).
- **Routes:** `defineRoutes((app, options) => …)` only. No file-based paths (they can come later without breaking this).

### Imports in modules

The modules are bundled by esbuild, so their imports work as usual:

- Relative imports (`./foo.js`), including from `.ts` files with the `.js` specifier for a `.ts` file, and specifiers with no extension.
- JSON (`./bar.json`, also `with { type: 'json' }`); the data is inlined.
- Packages from the extensions' installed packages (through the copy); the provided packages (`hono`, …) from the app.
- `fastly:*` modules (`fastly:secret-store`, `fastly:env`, …), through js-compute's plugin.
- Other file types: only esbuild's **default** loaders apply, because js-compute has no loader options. `.txt` imports as text; `.html` and `.svg` do not. Workaround: put the content in a `.js` or `.ts` module (`export default \`<svg …>\``).

What does not work, because the code runs in a Wasm bundle on Compute:

- Reading files at runtime (`fs.readFile`, `__dirname`): import them.
- Node built-ins (`node:*`): bundling fails. `template_prebuild.js` can give a clearer error if it scans the modules first.
- Dynamic imports with a calculated path (`` import(`./${x}.js`) ``): esbuild cannot follow them. A literal `import('./x.js')` works.

**Type checking** is not part of the build. For editor support and an optional `tsc --noEmit` in CI, the folder has a `tsconfig.json` (from `template init`), with the types for `@fastly/js-compute` (`fastly:*`), `hono`, and `defineMiddleware()` / `defineRoutes()`.

### Mount order in `src/index.js`

`src/index.js` loops over the manifest. It does not import modules one by one. The order matters, because `serveStatic()` goes to the next handler when no file matches.

```js
import { middleware, routes, bindings } from './hono-extensions.generated.js';

const fire = buildFire({ ...bindings, ...rc.templateOptions?.hono?.bindings });
const app = new Hono();
app.use('*', logFastlyServiceVersion());
app.use('*', staticPublisherVars());            // sets c.var.staticPublisher
// 1. middleware, in file-name order
for (const m of middleware) app.use('*', m.module.factory(rc.templateOptions?.hono?.middleware?.[m.name]));
// 2. routes
for (const r of routes) r.module.factory(app, rc.templateOptions?.hono?.routes?.[r.name]);
app.use('*', serveStatic());                     // 3. published files
app.notFound(serveFallback());                   // 4. SPA file / 404 page
fire(app);
```

After eject, this is ordinary code: the user can skip a module, change the order, or connect a module by hand, and new files in the folder are still found.

### Module shape (item 23)

Each file default-exports a **factory**, so that it can get options. `defineMiddleware()` and `defineRoutes()` from `@fastly/compute-js-static-publish/hono` give types and completion. There is no extra context argument: a handler gets everything from `c`, as in any Hono app (bindings on `c.env`, values of this package on `c.var.staticPublisher`).

```js
// hono-extensions/middleware/20-grip.js
import { defineMiddleware } from '@fastly/compute-js-static-publish/hono';
import { serveGrip } from '@fanoutio/serve-grip/hono';

export default defineMiddleware(
  { bindings: { grip: 'SecretStore:GRIP' } },
  (options) => async (c, next) => { const key = c.env.grip; /* … */ },
);
```

```js
// hono-extensions/routes/stream.js
import { defineRoutes } from '@fastly/compute-js-static-publish/hono';

export default defineRoutes((app, options) => {
  app.get('/stream', (c) => {
    if (c.var.grip.isProxied) {
      const gripInstruct = c.var.grip.startInstruct();
      gripInstruct.addChannel('test');
      gripInstruct.setHoldStream();
      return c.text('[stream open]\n');
    }
    // …
  });
});
```

### Bindings

Extensions use `c.env`, from `buildFire()` of `@fastly/hono-fastly-compute`. It supports `Acl`, `Backend`, `ConfigStore`, `env`, `KVStore`, `Logger`, and `SecretStore`, plus `c.env.clientInfo` and `c.env.serverInfo`. Resources are looked up lazily and cached; a resource that is missing or not linked is `undefined`.

- **Two sources, merged into one `buildFire()` call,** so `c.env` is the same object at runtime:
  - A module declares its own (`defineMiddleware({ bindings: … }, …)`). They are typed in that module. `template_prebuild.js` collects them into the manifest.
  - The rc declares app-level ones in `templateOptions.hono.bindings`. They are visible in `src/index.js` after eject.
- The same key with the same value is OK. The same key with **different** values is an error at build time that names both sources.
- Check binding names when possible: a Config Store name that is not a valid identifier (for example `my-config`) cannot be opened.
- Values of this package are on `c.var.staticPublisher` (§4).

### Options

- In `static-publish.project.js` (managed) or `static-publish.rc.js` (ejected), keyed by module name (no prefix):

  ```js
  templateOptions: {
    hono: {
      bindings: { config: 'ConfigStore:site_config' },
      middleware: { grip: { /* options for 20-grip.js */ } },
      routes: { stream: { /* … */ } },
    },
  },
  ```

  Top level (not in `managed`), because the generated app reads it. It is in the Wasm binary, so a change needs a deploy. Namespaced by template, like `build.hono`.
- Options for modules that do not exist give a warning, not an error, so that removing a module does not break the build.
- **Secrets are never in the config:** modules read them through bindings.
- Options for each collection (through the publish settings and `getServerConfig()`) could come later, for options that can differ between collections; never for anything that is necessary before the collection is known.

### Dependencies

The extensions folder is its own small package:

```jsonc
// hono-extensions/package.json
{
  "dependencies": { "@fanoutio/serve-grip": "^…" },
  "peerDependencies": {                       // provided by the template
    "hono": "^4",
    "@fastly/compute-js-static-publish": "^8.2"
  }
}
```

- The user runs `npm install` (or `npm ci`) **in the folder**, so that the editor and the type checker see everything, including the peer packages. Never in the generated app (it is generated again).
- The template declares the packages that it **provides** (`hono`, `@fastly/compute-js-static-publish`, `@fastly/js-compute`). `template_prebuild.js` copies the folder's `node_modules` into the app **without** them, so at build time they resolve to the app's copies: one `hono` in the bundle. Imports from other packages work the same way (serve-grip's own `import 'hono'` also finds the app's copy).
- **Two lockfiles, never merged.** The packages of the extensions come from the folder's lockfile (the user's); the packages of the app come from the template's lockfile (8.1, item 14). Thus the builds stay reproducible.
- **Version check:** `template_prebuild.js` warns if a range in the folder's `package.json` for a provided package does not include the version that the app has. The build uses the template's `hono`, not the one in the folder's `node_modules`. The message gives the fix: `hono-extensions/package.json expects hono ^4.6.0, but the app provides 4.13.2. Run: npx @fastly/compute-js-static-publish template init`. A mismatch is a warning, not an error: the app's copy is the one that runs, so the risk is only types that are a little wrong.
- **Install both:** `npm ci` in the folder **and** in the app dir. CI tools must do both, the folder first.
- **Copy rules:** a real copy, not a symlink (esbuild follows symlinks to the real path, which would bring back the second `hono`); extension code must not import files outside the folder (for example `../shared/x.js`), because they are not copied; copying `node_modules` takes a little time at each build.
- **Side effects:** error locations and source maps point at the copy, not at the folder. The Fastly CLI's file watcher may not see changes in the folder, because it is outside the app dir (check, and pass it to the watcher's directory option if necessary); otherwise, edits show at the next build.

### `template init` (item 24)

A command of the core. Each template defines what it initializes. For `hono`, it sets up the folder of `build.hono.extensionsDir`.

- **It works only on the app's current template:** `managed.template` in managed mode, `generatedFrom.template` in ejected mode. There is no `--template` override. It never switches templates and never calls `generateApp()`: it only makes or updates the template's extension folder.
- **An app with no `generatedFrom`** (made before 8.1): an error with the steps to add the record by hand. No guessing.
- **Scaffolding with `--template hono`** (also with `--managed`) runs `template init` at the end.
- If a user changes `managed.template` to `hono` by hand, nothing runs `template init`. `deploy` and `dev` could show a hint (decide in item 24).

| Command | Effect |
|---|---|
| `template init` | If the folder is missing: makes it, with `package.json` (peer dependencies set to the provided versions, from `pinnedVersion()`), a starter `tsconfig.json`, empty `middleware/` and `routes/`, and an **inactive** example, `middleware/_example.js` (skipped until the user renames it, so that a new Hono app is still exactly the plain Hono app). If the folder exists: updates only the parts that the template owns (the peer versions in `package.json`, merged; the user's own dependencies are not changed), and adds missing starter files. Never changes user modules. |
| `template init --reset` | Also writes the starter files (`tsconfig.json`, the example) again, as the template has them. Lists what it will replace and asks, or needs `--force` in non-interactive mode. Never deletes user modules. |
| `template init --check` | Changes nothing. Fails if the parts that the template owns have drifted. For CI. |

Then `npm install` in the folder (npm 7 and later install peer dependencies). `status --json` lists the provided packages and their versions.

**Where the versions come from:** in managed mode, the template's pinned versions (`pinnedVersion()`, from the shipped lockfile); in ejected mode, the app's installed packages (for example `compute-js/node_modules/hono/package.json`).

### Fingerprint

There is no separate bundle to hash. The fingerprint includes the **contents of the extensions folder** (modules and helpers) and **its lockfile**, so any change to the user's code or to its resolved dependencies triggers a deploy, and nothing else does. (The manifest follows from these.)

### Eject

Nothing about the extensions changes at eject:

- `scripts/template_prebuild.js`, `scripts/template_postinstall.js`, and `src/index.js` are written into the ejected app at the same place as in the generated one, and the hooks in `package.json` stay. New files in the folder are found after eject too.
- The folder stays where it is. `build.hono.extensionsDir` stays in the rc, with the path written again relative to the rc's new location (for example `../hono-extensions`; check in items 18 and 24).
- The user can now change `src/index.js` (skip or reorder modules) and the hook scripts.

### What this needs from the template mechanism (item 20)

8.1's `AppTemplate` gets:

```ts
type AppTemplate = {
  // from 8.1: files, dependencies, devDependencies, gitignore, supports
  initFiles?: Record<string, string>,  // for template init, written under the template's own folder;
                                       // package.json is merged, not replaced
  provides?: string[],                 // packages that the app provides to extension code
  settings?: {                         // the settings that the template reads, for validation
    build?: …,                         // build.<template>, e.g. build.hono.extensionsDir
    templateOptions?: …,               // templateOptions.<template>
  },
};
```

- The core writes the files in the same way for scaffold, managed generation, and eject. No hook interface or plugin dispatch is necessary, beyond the template hooks of 8.1.
- `build.<template>` in the rc: kept out of the generated rc in managed mode (it affects the fingerprint only through what it selects, for example the contents of the extensions folder); kept at eject.
- Settings that a template does not declare give warnings (in ejected mode, warnings only, because the user owns the code).
- `StaticPublishRc` declares `templateOptions` and `build` (typed for each template).

### Public helper API (item 21)

The files that a template ships use only the public API of this package, because they stay in the app after eject, with later versions of this package. The helpers for template scripts (for example: read the rc; list the modules with the naming rules) are a public, semver'd API, for example a Node-side subpath export.

## 6. Not in 8.2

See [../README.md](../README.md#not-in-81-or-82): resource declarations (GRIP/Fanout), esbuild loader settings, `.tsx`/`.jsx` modules, file-based routes.
