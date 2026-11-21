/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

/// <reference types="@fastly/js-compute" />

// Plugin modules of the hono template, in the hono-compose/ folder. Each plugin
// default-exports definePlugin(…). This module imports only types (from hono,
// from fastly:*, and from ./index.js), and nothing that needs Compute, so that
// the unit tests can import it.

import type { Acl } from 'fastly:acl';
import type { Backend } from 'fastly:backend';
import type { ConfigStore } from 'fastly:config-store';
import type { KVStore } from 'fastly:kv-store';
import type { Logger } from 'fastly:logger';
import type { SecretStore } from 'fastly:secret-store';
import type { Hono } from 'hono';
import type { PublisherServerMiddleware } from './index.js';

// Bindings for buildFire() of @fastly/hono-fastly-compute: the name on c.env,
// and the resource, for example { config: 'ConfigStore:site_config' }.
export type PluginBindings = Record<string, string>;

type ResourceTypes = {
  Acl: Acl,
  Backend: Backend,
  ConfigStore: ConfigStore,
  env: string,
  KVStore: KVStore,
  Logger: Logger,
  SecretStore: SecretStore,
};

// The type on c.env of a binding, for example SecretStore for
// 'SecretStore:oauth'. It is undefined if the resource does not exist, or is
// not linked to the service.
export type BindingResource<R> =
  R extends `${infer T}:${string}` ? (T extends keyof ResourceTypes ? ResourceTypes[T] | undefined : unknown) :
  R extends keyof ResourceTypes ? ResourceTypes[R] | undefined :
  unknown;

// The Env of the app that a plugin gets: its bindings on c.env. c.var is not
// typed, so that a plugin can set its own variables.
export type PluginEnv<B extends PluginBindings> = {
  Bindings: { [K in keyof B]: BindingResource<B[K]> },
  Variables: Record<string, any>,
};

// The phases of the app, in the order that the app adds them. They are on two
// axes:
// - Processing: middleware wraps each request, for example a login check, or
//   the time of a request. The code before await next() runs before the routes,
//   and the code after it runs after the response is made, in the reverse order.
// - Routing: the routes that can answer a request, in this order:
//   - routes: before the published files. These routes win over a file.
//   - (the published files, with serveStatic())
//   - afterFilesRoutes: only for the requests that no published file matches,
//     before the fallback (the SPA file or the 404 page).
export const PLUGIN_PHASES = [ 'middleware', 'routes', 'afterFilesRoutes' ] as const;
export type PluginPhase = typeof PLUGIN_PHASES[number];

// The names of the phases in earlier betas of 8.1, and the phase that has
// each one now. mergeBindings() names the new phase in its error.
const RENAMED_PHASES: Readonly<Record<string, PluginPhase>> = {
  beforeFiles: 'routes',
  beforeFilesRoutes: 'routes',
  afterFiles: 'afterFilesRoutes',
};

// The helpers of the app that each phase function gets: the same
// serveStatic(), staticResponse(), serveFallback(), fallbackResponse(),
// isCollectionAvailable(), and PublisherServer that the app uses, made once
// when the app starts, with the same defaults and the same collectionSelection.
// staticResponse() and fallbackResponse() are for a handler that decides itself
// whether to serve a published file.
export type PluginHelpers = Pick<
  PublisherServerMiddleware,
  'publisherServer' | 'serveStatic' | 'staticResponse' | 'serveFallback' | 'fallbackResponse' | 'isCollectionAvailable'
>;

// A function that adds the handlers of a plugin to the app, in one phase.
// options is templateOptions.hono.compose.plugins[<name>].
export type PluginPhaseFunction<B extends PluginBindings = PluginBindings, O = any> =
  (app: Hono<PluginEnv<B>, any, any>, options: O | undefined, helpers: PluginHelpers) => void;

export type PluginPhases<B extends PluginBindings = PluginBindings, O = any> = {
  [P in PluginPhase]?: PluginPhaseFunction<B, O>
};

export type DefinePluginOptions<B extends PluginBindings = PluginBindings> = {
  // The bindings that the plugin uses on c.env.
  bindings?: B,
};

export type Plugin = {
  kind: 'plugin',
  bindings: PluginBindings,
  // The functions of each phase. mergeBindings() checks them.
  phases: PluginPhases<any>,
};

// An entry of the generated manifest (src/hono-compose.generated.js).
export type PluginEntry = {
  // The name of the plugin: the file name without the order prefix and the
  // extension. It is the key in templateOptions.hono.compose.plugins.
  name: string,
  // The file, relative to the folder of the plugins, for messages.
  file: string,
  // The default export of the file.
  plugin: Plugin,
};

// A function adds handlers in the middleware phase. An object has a function
// for each phase that the plugin uses.
export function definePlugin<O = any>(phases: PluginPhaseFunction<{}, O> | PluginPhases<{}, O>): Plugin;
export function definePlugin<const B extends PluginBindings, O = any>(options: DefinePluginOptions<B>, phases: PluginPhaseFunction<B, O> | PluginPhases<B, O>): Plugin;
export function definePlugin(
  optionsOrPhases: DefinePluginOptions | PluginPhaseFunction | PluginPhases,
  phases?: PluginPhaseFunction | PluginPhases,
): Plugin {
  const [ options, value ] = phases === undefined ?
    [ {}, optionsOrPhases as PluginPhaseFunction | PluginPhases ] :
    [ optionsOrPhases as DefinePluginOptions, phases ];
  return {
    kind: 'plugin',
    bindings: { ...options.bindings },
    phases: typeof value === 'function' ? { middleware: value } : value,
  };
}

// The name of definePlugin() in earlier betas of 8.1. It throws, so that a
// plugin with the old name stops the build with a message that gives the new
// name. Removed in v9.
export function defineExtension(..._args: unknown[]): never {
  throw new Error(
    "defineExtension() is now definePlugin(), from the same import: " +
    "import { definePlugin } from '@fastly/compute-js-static-publish/hono'.",
  );
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null && !Array.isArray(value);

// Checks the plugins of the manifest, and merges their bindings with the
// bindings of the app (templateOptions.hono.bindings), for buildFire(). The
// same name with the same resource is allowed. Throws for a file that does not
// default-export definePlugin(…), for phases that are not correct, or for
// one name with two different resources; the message names the file. Call it at
// the top level of the app, so that an error stops the build.
export function mergeBindings(appBindings: PluginBindings | undefined, entries: PluginEntry[]): PluginBindings {
  // Maps, so that a binding name such as 'toString' is not found on
  // Object.prototype.
  const merged = new Map<string, string>();
  const sourceOf = new Map<string, string>();

  const add = (bindings: PluginBindings, source: string) => {
    for (const [ name, resource ] of Object.entries(bindings)) {
      const existing = merged.get(name);
      if (existing != null && existing !== resource) {
        throw new Error(
          `The binding '${name}' is '${existing}' in ${sourceOf.get(name)}, ` +
          `but '${resource}' in ${source}. Use the same resource, or another name.`,
        );
      }
      merged.set(name, resource);
      if (!sourceOf.has(name)) {
        sourceOf.set(name, source);
      }
    }
  };

  add(appBindings ?? {}, 'templateOptions.hono.bindings');
  for (const entry of entries) {
    const source = `hono-compose/${entry.file}`;
    const plugin = entry.plugin as Partial<Plugin> | undefined;
    if (plugin == null || plugin.kind !== 'plugin') {
      throw new Error(`${source}: the default export must be definePlugin(…).`);
    }
    const phases = plugin.phases as unknown;
    const keys = isPlainObject(phases) ? Object.keys(phases) : [];
    const unknown = keys.filter(key => !(PLUGIN_PHASES as readonly string[]).includes(key));
    if (!isPlainObject(phases) || keys.length === 0 || unknown.length > 0) {
      throw new Error(
        `${source}: definePlugin() needs a function, or an object with a function ` +
        `for one or more of the phases ${PLUGIN_PHASES.join(', ')}.` +
        (unknown.length === 1 ? ` '${unknown[0]}' is not a phase.` : '') +
        (unknown.length > 1 ? ` ${unknown.map(x => `'${x}'`).join(', ')} are not phases.` : '') +
        unknown
          .filter(x => Object.prototype.hasOwnProperty.call(RENAMED_PHASES, x))
          .map(x => ` Rename '${x}' to '${RENAMED_PHASES[x]}'.`)
          .join(''),
      );
    }
    for (const key of keys) {
      if (typeof phases[key] !== 'function') {
        throw new Error(`${source}: the phase ${key} must be a function.`);
      }
    }
    add(plugin.bindings ?? {}, source);
  }
  return Object.fromEntries(merged);
}
