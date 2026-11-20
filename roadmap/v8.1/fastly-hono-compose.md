# Fastly Hono Compose

Status: all items decided on 2026-11-20. Nothing is built yet. Two small details are decided while it is built (see "Details to decide while building").

The Hono extensions of part 6 (a folder of modules, each with `defineExtension()`) move out of this package into `@fastly/hono-fastly-compute`. There, they become **Compose**, a plugin system for any Hono app on Compute. This package becomes one **Compose host**: it adds the step that serves the published files. The `hono` template is an app that uses Compose.

8.1.0 waits for this work, so that the API that 8.1.0 releases does not change right after.

## Decided (2026-11-20)

- Compose goes into `@fastly/hono-fastly-compute`. The same person maintains both packages.
- Plugin authors import from `@fastly/hono-fastly-compute/compose`, not from this package.
- Order: build and release it in `@fastly/hono-fastly-compute` first, then 8.1 uses it (option B).
- The app runs a list of steps that the host gives: phases (where plugins add code) and host steps. `middleware` and `routes` are in every app. There is no `handler` phase: the `middleware` onion already wraps the full request, from the request to the response. (See "The list of steps".)
- Compose is for Fastly Compute only. It does not try to run on other platforms. Thus it can use the Compute parts directly: the `fastly:*` types, the bindings of `buildFire()`, and the checks at build time (Wizer runs the top level of the app once, so a bad plugin stops the build).
- The plugin system is **Fastly Hono Compose**, short **Compose** (`@fastly/hono-fastly-compute/compose`). Each module is a **plugin**, and the folder is `hono-compose/`. This package is a **Compose host** (see item 1).
- 8.1.0-beta.8 is released with the current API (with the names of #184). The move comes in a later beta.

## The model

Two axes, the same as in beta.8:

| | Processing | Routing |
|---|---|---|
| Question | What wraps each request? | Who answers this request? |
| Phase | `middleware` | `routes`, and the route phases of the host |
| Hono tool | The onion: the code before `await next()`, then the code after it, in reverse order | Routes: the first route that answers wins |

### The list of steps

The app runs a list of **steps**, in order. There are two kinds:

- A **phase** (a string): the plugins add their code here. In each phase, the plugins run in file-name order.
- A **host step** (a pair `[name, fn]`): the host runs its own code here. `fn` gets `(app, helpers)`, the same helpers that the plugins get (decided 2026-11-20, for consistency with the phase functions of plugins, and so that an app that replaces a host step can use them).

`CORE_PHASES` stands for the two phases that every app has: `middleware`, then `routes`. With no host, the list is only `CORE_PHASES`.

A host gives its own list. The list of this package (the app adds `logFastlyServiceVersion()` and `selectCollection()` with `app.use()` before it calls `compose()`, so they run before all plugins):

```ts
import { defineComposeHost, CORE_PHASES } from '@fastly/hono-fastly-compute/compose';

const host = defineComposeHost({
  steps: [
    CORE_PHASES,                                 // middleware, routes
    [ 'files', (app) => app.use('*', serveStatic()) ],
    'afterFilesRoutes',
    [ 'fallback', (app) => app.notFound(serveFallback()) ],
  ],
  helpers: { … },
});
```

Thus a request goes through:

```
logFastlyServiceVersion()  app, before compose(): logs the version of the service
selectCollection()         app, before compose(): the collection of the request
middleware         plugins: on the way in (and on the way out, in reverse order)
routes             plugins: routes that win over the files
files              host: serveStatic()
afterFilesRoutes   plugins: routes where a file wins
fallback           host: the SPA file or the 404 page (app.notFound())
```

Rules (Compose checks them when the app starts, so a bad list stops the build):

- The list has `CORE_PHASES` exactly once. Thus `middleware` and `routes` are in every app, one after the other, in this order. A plugin that uses only these two phases works with every host. All middleware is added before any route, so each middleware wraps each route.
- The names in the list are all different.
- The host can put steps and phases before `CORE_PHASES` (decided 2026-11-20: Compose checks only that `CORE_PHASES` is in the list, not that it is first). A phase there runs before the middleware of all plugins, so a plugin must add only middleware to it. This package has none.
- After `CORE_PHASES`, the host chooses freely.

`fallback` is only a name in the list of this package. Compose does not treat it in a special way. (`app.notFound()` runs when nothing answered, at any place in the list.)

## What moves, and what stays

| Part | Where | Today |
|---|---|---|
| Folder of modules: file-name order, `_` files and subfolders are not modules, `.d.ts` files are skipped | Compose | `listHonoExtensionModules()` in `src/cli/hono/build.ts` |
| Bundler: esbuild, externals, the generated manifest, watch, the version check of the folder's `package.json` | Compose | `bundleHonoExtensions()`, `watchHonoExtensions()`, `honoExtensionsExternals()`, `checkProvidedVersions()` |
| `defineExtension()`, the checks of the phases (errors name the file) | Compose | `src/hono/extensions.ts` |
| Bindings: merge for `buildFire()`, the types on `c.env` | Compose, next to `buildFire()` | `mergeBindings()`, `BindingResource` (a copy of types that `@fastly/compute-js-context` has) |
| The phase runner | Compose | the loops in the template's `src/index.ts` |
| The step `files`, its helpers (`serveStatic`, `staticResponse`, `serveFallback`, `fallbackResponse`, `isCollectionAvailable`, `publisherServer`) | this package | `src/hono/index.ts` |
| `selectCollection()`, `StaticPublisherVariables`, the fallback | this package | `src/hono/index.ts` |
| Where the options of a module come from (`templateOptions.hono.extensions`) and where the folder is (`build.hono.extensionsDir`) | this package; it gives them to Compose | `static-publish.rc.js` |
| Template hooks, managed projects, eject | this package | `src/cli` |

"Compose" in this table is the subpath `/compose` of `@fastly/hono-fastly-compute`.

## Typing: declaration merging

A plugin imports `definePlugin()` from `@fastly/hono-fastly-compute/compose`, but it must see the phases and the helpers of its host. Compose has an empty interface, and the host adds to it. Compose gets the phase names from the list of the host (with a `const` type parameter), so the names in the types and the names in the list are the same.

Compose:

```ts
// @fastly/hono-fastly-compute/compose
export interface ComposeHostRegistry {}

// The phases of the registered host, or 'middleware' | 'routes' with no host.
export type PhaseName = …;
export type PluginHelpers = …;
```

The app registers its host (see item 3 for where):

```ts
declare module '@fastly/hono-fastly-compute/compose' {
  interface ComposeHostRegistry {
    host: typeof host;   // the value of defineComposeHost() in src/index.ts (see item 3)
  }
}
```

The registration applies to all plugins in the folder, if the tsconfig of the app has the file that registers it.

A plugin:

```ts
// hono-compose/20-old-urls.ts
import { definePlugin } from '@fastly/hono-fastly-compute/compose';

export default definePlugin({
  afterFilesRoutes(app, options, helpers) {   // the name is known, and helpers has a type
    app.get('/old/*', c => c.redirect('/new/'));
  },
});
```

A wrong phase name (for example `afterFileRoutes`) is a type error, and also a build error with the file name (the runtime check stays).

Limit: one host for each app. Each app has one template, so this is enough.

## Decisions by item

### 1. The names

**Decided (2026-11-20):** the plugin system is **Fastly Hono Compose**: the full name in docs and announcements, because the name needs both Fastly and Hono. In code and in short text it is **Compose**, and it is the export `@fastly/hono-fastly-compute/compose`. Each module in it is a **plugin** ("a Compose plugin"). This package is a **Compose host**. Hono does not export `compose` (it is only the name of its internal function that chains middleware), and Hono does not use the word "plugin". Other names that were considered: Plugins (as the system name), Patchbay, Switchboard, Onion, Assembly (sounds like WebAssembly), Kit, and Recipes (sounds like code to copy). Hono already exports `mount`, `combine`, `factory`, `router`, and `dev`.

The names that follow from it:

| Piece | Now (beta.8) | New |
|---|---|---|
| Runtime export | `@fastly/compute-js-static-publish/hono` | `@fastly/hono-fastly-compute/compose` |
| Build export (Node) | `@fastly/compute-js-static-publish/hono/build` | `@fastly/hono-fastly-compute/compose/build` |
| One file in the folder | extension module | plugin |
| The default export of the file | `defineExtension()` | `definePlugin()` |
| The function for one phase | `ExtensionPhaseFunction` | `PluginPhaseFunction` |
| Bindings and env types | `ExtensionBindings`, `ExtensionEnv` | `PluginBindings`, `PluginEnv` (`BindingResource` stays) |
| The helpers type | `ExtensionHelpers` | `PluginHelpers` |
| The type registry of a host | (new) | `ComposeHostRegistry` |
| Runs the phases in order | loops in the template | `compose(app, plugins, host)` |
| Merge of bindings | `mergeBindings()` | `mergeBindings()` (no change) |
| The generated list | `src/hono-extensions.generated.js`, `ExtensionEntry` | `src/hono-compose.generated.js`, `PluginEntry` |
| Bundle and watch | `bundleHonoExtensions()`, `watchHonoExtensions()` | `bundlePlugins()`, `watchPlugins()` |
| Options of a plugin (this package) | `templateOptions.hono.extensions[<name>]` | `templateOptions.hono.compose.plugins[<name>]` |
| The folder setting (this package) | `build.hono.extensionsDir` | `build.hono.composeDir` |

The concept words stay: **phase**, **step**, **host**, **helpers**, **bindings**.

The default folder of this package is `hono-compose/`, and the keys in `static-publish.rc.js` are `templateOptions.hono.compose.plugins[<name>]` (the options of each plugin, by name; `templateOptions.hono.compose` is the place for settings of Compose itself, now and later) and `build.hono.composeDir` (decided 2026-11-20).

### Examples and tests

**Decided (2026-11-20):**

- The examples move to `@fastly/hono-fastly-compute` (`examples/compose/<name>/`), with their own e2e tests there. Today they are `examples/hono/grip/` and `examples/hono/oauth/` in this package. They need nothing from this package after the move: they use only `defineExtension()` and `ExtensionEnv`. OAuth uses only `middleware`. GRIP also uses `beforeFilesRoutes`, which becomes `routes` (item 3). Then both examples work with every host.
- This package keeps its own e2e tests for the `hono` template and its plugins. Their scope can be smaller, because the tests of `@fastly/hono-fastly-compute` cover Compose itself.
- An example that needs this package (for example, one that uses the helpers of the `files` step) stays in this package, in `examples/hono/compose/<name>/`.

### 2. Package layout

**Decided (2026-11-20):** Compose is a subpath of `@fastly/hono-fastly-compute`, not a separate package. The named export (`/compose`) makes it a separate part of the package. The other options were a new package on top of the adapter (as HonoX is on top of Hono), or a second package in the same repo. The subpath gives one package to release, next to `buildFire()`.

- The runtime part: `./compose`, Compute types only, as the rest of the package.
- The bundler: `./compose/build`, Node only, in its own directory with its own tsconfig. The `typecheck` script of the package checks `src/` with Compute types only.

A subpath cannot declare its own dependencies, but it needs none:

- The runtime part imports only types, from `hono` and `fastly:*`. The package has both as peer dependencies.
- The bundler imports only Node built-ins. The app passes its own esbuild, as now. For the types of esbuild, use a small structural type (or a dev dependency).
- The bundler of this package uses two of its helpers: `compareVersions()` and `cliCommand()` (the command in a message). In Compose, the host gives the command text, or the message names no command.

### 3. The host API

**Decided (2026-11-20):** the host gives its list of steps (see "The list of steps"). The marker is `CORE_PHASES`: it is required, so it is not "default". `'...'` (as in webpack) was not used, because in docs it looks like omitted code. The phases are `middleware` and `routes` (`CORE_PHASES`, in every app), and the phases that the host adds. There is no `before<Step>Routes` phase: a plugin that wants routes that win uses `routes`. Thus GRIP changes `beforeFilesRoutes` to `routes` and works with every host. A host that needs a phase between two of its steps adds it to its list.

The template's `src/index.ts` writes the list out (decided 2026-11-20, see below):

```ts
// in the app's src/index.ts
import { compose, defineComposeHost, CORE_PHASES } from '@fastly/hono-fastly-compute/compose';
import { fromStaticPublishRc } from '@fastly/compute-js-static-publish/hono';
import { plugins } from './hono-compose.generated.js';

const sp = fromStaticPublishRc(rc);
const host = defineComposeHost({
  steps: [
    CORE_PHASES,
    // Add your own routes here (they win over the files), or use a plugin.
    [ 'files', (app) => app.use('*', sp.serveStatic()) ],
    'afterFilesRoutes',
    [ 'fallback', (app) => app.notFound(sp.serveFallback()) ],
  ],
  helpers: sp,
});
const fire = buildFire(host.bindings(plugins));
const app = new Hono<…>();

// Before compose(), so before all plugins.
app.use('*', logFastlyServiceVersion());
app.use('*', sp.selectCollection());

compose(app, plugins, host);                   // runs the list of steps
fire(app);
```

**Decided (2026-11-20): the list is in the template's `src/index.ts`**, not hidden in this package. An ejected app sees the real order, and it can add, remove, or replace steps by editing the list, with no new API. A managed app gets the same file, generated. Ejected apps do not get changes to the list automatically (for example a new phase in a later version): `MIGRATING.md` describes each change, as for the other lines of `src/index.ts`. The other option was `staticPublisherHost(rc)`, which hides the list: shorter, but an ejected app could not see or change the order.

### 4. Collection selection

**Decided (2026-11-20):** the template adds `logFastlyServiceVersion()` and `selectCollection()` with `app.use()` before it calls `compose()`. They are plain Hono, not host steps, so they run before all plugins. This is the same order as in beta.7 and beta.8. The list of steps has only what Compose must put in order: the phases and the host steps between them (`files`, `fallback`). A managed app has no way to run code before `selectCollection()`, and this is intended. An ejected app can change `src/index.ts` at its own risk. `fallback` stays in the list: it is host behavior that a later "replace a host step" feature (see "Not in this work") could offer to managed apps.

### 5. Folder rules and reserved names

The bundler takes every file `*.js`, `*.mjs`, `*.ts`, or `*.mts` as a plugin, except files that start with `_` or `.`, `.d.ts` files, and files in subfolders. Thus `index.ts` in the folder is a plugin named `index` today.

**Decided (2026-11-20):** Compose reserves `index.js`, `index.mjs`, `index.ts`, and `index.mts` in the folder, so that a later config module for the folder can use the name without a break. The build stops with a message that names the file, for example: "`hono-compose/index.ts`: `index` is a reserved name in this folder. Rename the file, for example to `10-index.ts`." One check in the list of files, one unit test, and one line in the README. No other names are reserved: a `_` name would conflict with the helpers of customers, and there is no other planned name.

### 6. Migration of beta customers

A beta customer must change:

| Change | Managed | Ejected |
|---|---|---|
| The folder: `hono-extensions/` becomes `hono-compose/` | yes | yes |
| The phase `beforeFilesRoutes` becomes `routes` (`middleware` and `afterFilesRoutes` keep their names) | yes | yes |
| The import: `defineExtension` from `@fastly/compute-js-static-publish/hono` becomes `definePlugin` from `@fastly/hono-fastly-compute/compose` | yes | yes |
| The types: `ExtensionEnv` becomes `PluginEnv` (both examples use it), and the other `Extension*` types (item 1) | yes | yes |
| `static-publish.rc.js`: `templateOptions.hono.extensions` becomes `templateOptions.hono.compose.plugins`, and `build.hono.extensionsDir` becomes `build.hono.composeDir` | yes | yes |
| `src/index.ts`: the list of steps and `compose()` | generated again | by hand, or `template init` |
| `scripts/template_prebuild.js` and `scripts/template_watch.js`: the import `…/hono/build` becomes `@fastly/hono-fastly-compute/compose/build` | generated again | by hand |
| `.gitignore`: `src/hono-extensions.generated.js` becomes `src/hono-compose.generated.js` | generated again | by hand |
| `package.json`: `@fastly/hono-fastly-compute` `^0.4.0` becomes `^0.5.0` | generated again | by hand |

**Decided (2026-11-20):** each old name stops the build with a message that gives the new name, and these checks stay for all of 8.1.x. They are removed in v9. If they were removed in 8.1.0, a customer who goes from a beta directly to 8.1.0 could deploy a site without its plugins and not know it. If one of the plugins is a login check (for example the OAuth example), the site would be public. The checks:

- The folder: if `hono-extensions/` has files and `hono-compose/` does not exist, the build stops. The build never skips the old folder silently.
- The old keys in `static-publish.rc.js`.
- The old phase names: `beforeFiles`, `afterFiles` (as in #184), and `beforeFilesRoutes`.
- The old import: `defineExtension()` stays in this package only as a function that throws, with a message that gives the new import.

`MIGRATING.md` gets a section for beta customers with the table above. The beta announcement gets a note, as for #184.

### 7. Versions and release order

**Decided (2026-11-20):**

- `@fastly/hono-fastly-compute` 0.5.0 (a 0.x minor can break, so Compose can still change if the betas of 8.1 show a problem; 1.0 later, when Compose has been out for some time). Prereleases first: `0.5.0-beta.N`. Its release workflow is the same as the one of this package, so the tag `v0.5.0-beta.1` gets the dist-tag `beta`, and `latest` stays at 0.4.0.
- Only the `hono` template depends on it (today `^0.4.0`). This package does not: `/hono` keeps `fromStaticPublishRc()` and the helpers, and the old `defineExtension()` throws with no import.
- A caret range does not match a prerelease (`^0.5.0` does not match `0.5.0-beta.1`). Thus during the betas of 8.1, the template has the exact prerelease (for example `"0.5.0-beta.1"`), and the lockfiles of the templates follow. At the preparation of 8.1.0, after 0.5.0 is released, the template gets `^0.5.0`.
- Order: `@fastly/hono-fastly-compute` 0.5.0-beta.1 → a beta of 8.1 with it → more betas of both, if necessary → 0.5.0 → 8.1.0.

## Work

0. Decide the items of this note (done 2026-11-20).
1. `@fastly/hono-fastly-compute`: the runtime part, with unit tests and type tests (`test/types/api.ts`); the bundler; an integration-test app with a folder of plugins; the examples from this package (`examples/compose/<name>/`) with their e2e tests; the README. Release `0.5.0-beta.1`.
2. This package, a PR to `dev/8.1`: the `hono` template depends on it (item 7); remove `src/hono/extensions.ts` and most of `src/cli/hono/build.ts`; add the host; change the template and the golden files; the README, the CHANGELOG, and the hint for the old import; remove `examples/hono/grip/` and `examples/hono/oauth/` (they move), and make the e2e tests of the examples smaller.
3. A beta of 8.1 with it. Then `@fastly/hono-fastly-compute` 0.5.0 and 8.1.0.

## Details to decide while building

- Where the app registers its host for the types (`interface ComposeHostRegistry { host: typeof host }`): in `src/index.ts`, or in the generated `.d.ts`. The result must work in an editor for the files in `hono-compose/`.
- "Helpers" is also a category in the docs of Hono. Keep the word `helpers` for the third argument, unless it confuses in the README.

## Not in this work

- Hooks after the response is sent. A middleware can use `c.executionCtx.waitUntil()` today. A hook can come later as an addition.
- A config module in the folder (`index.ts`) that sets the order of the steps.
- An app (not only the host) that adds, removes, or replaces a host step (decided 2026-11-20: not in the first release). Possible shape: `compose(app, plugins, host, { steps: { files: (app, { serveStatic }) => …, fallback: null } })`, only host steps, by name, an unknown name is an error. For a managed project, the same through `templateOptions.hono.compose.steps`. It is an addition, so it can come later. Today an ejected app can change the list of its host in `src/index.ts` (item 3), and a catch-all route in `afterFilesRoutes` replaces the fallback.
- More than one host in an app.
