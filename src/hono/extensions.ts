/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

/// <reference types="@fastly/js-compute" />

// Hono extensions: modules in the hono-extensions/ folder. Each module
// default-exports defineExtension(…). This module imports only types, from hono
// and from fastly:*, and nothing that needs Compute, so that the unit tests can
// import it.

import type { Acl } from 'fastly:acl';
import type { Backend } from 'fastly:backend';
import type { ConfigStore } from 'fastly:config-store';
import type { KVStore } from 'fastly:kv-store';
import type { Logger } from 'fastly:logger';
import type { SecretStore } from 'fastly:secret-store';
import type { Hono } from 'hono';

// Bindings for buildFire() of @fastly/hono-fastly-compute: the name on c.env,
// and the resource, for example { config: 'ConfigStore:site_config' }.
export type ExtensionBindings = Record<string, string>;

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

// The Env of the app that a module gets: its bindings on c.env. c.var is not
// typed, so that a module can set its own variables.
export type ExtensionEnv<B extends ExtensionBindings> = {
  Bindings: { [K in keyof B]: BindingResource<B[K]> },
  Variables: Record<string, any>,
};

// The phases of the app, in the order that the app runs them:
// - middleware: before all other phases, for example a login check.
// - beforeFiles: before the published files.
// - afterFiles: after the published files, only for the requests that no
//   published file matches.
export const EXTENSION_PHASES = [ 'middleware', 'beforeFiles', 'afterFiles' ] as const;
export type ExtensionPhase = typeof EXTENSION_PHASES[number];

// A function that adds the handlers of a module to the app, in one phase.
// options is templateOptions.hono.extensions[<name>].
export type ExtensionPhaseFunction<B extends ExtensionBindings = ExtensionBindings, O = any> =
  (app: Hono<ExtensionEnv<B>, any, any>, options: O | undefined) => void;

export type ExtensionPhases<B extends ExtensionBindings = ExtensionBindings, O = any> = {
  [P in ExtensionPhase]?: ExtensionPhaseFunction<B, O>
};

export type DefineExtensionOptions<B extends ExtensionBindings = ExtensionBindings> = {
  // The bindings that the module uses on c.env.
  bindings?: B,
};

export type Extension = {
  kind: 'extension',
  bindings: ExtensionBindings,
  // The functions of each phase. mergeBindings() checks them.
  phases: ExtensionPhases<any>,
};

// An entry of the generated manifest (src/hono-extensions.generated.js).
export type ExtensionEntry = {
  // The name of the module: the file name without the order prefix and the
  // extension. It is the key in templateOptions.hono.extensions.
  name: string,
  // The file, relative to the extensions folder, for messages.
  file: string,
  // The default export of the file.
  module: Extension,
};

// A function adds handlers in the middleware phase. An object has a function
// for each phase that the module uses.
export function defineExtension<O = any>(phases: ExtensionPhaseFunction<{}, O> | ExtensionPhases<{}, O>): Extension;
export function defineExtension<const B extends ExtensionBindings, O = any>(options: DefineExtensionOptions<B>, phases: ExtensionPhaseFunction<B, O> | ExtensionPhases<B, O>): Extension;
export function defineExtension(
  optionsOrPhases: DefineExtensionOptions | ExtensionPhaseFunction | ExtensionPhases,
  phases?: ExtensionPhaseFunction | ExtensionPhases,
): Extension {
  const [ options, value ] = phases === undefined ?
    [ {}, optionsOrPhases as ExtensionPhaseFunction | ExtensionPhases ] :
    [ optionsOrPhases as DefineExtensionOptions, phases ];
  return {
    kind: 'extension',
    bindings: { ...options.bindings },
    phases: typeof value === 'function' ? { middleware: value } : value,
  };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null && !Array.isArray(value);

// Checks the modules of the manifest, and merges their bindings with the
// bindings of the app (templateOptions.hono.bindings), for buildFire(). The
// same name with the same resource is allowed. Throws for a module that does not
// default-export defineExtension(…), for phases that are not correct, or for
// one name with two different resources; the message names the file. Call it at
// the top level of the app, so that an error stops the build.
export function mergeBindings(appBindings: ExtensionBindings | undefined, entries: ExtensionEntry[]): ExtensionBindings {
  const merged: ExtensionBindings = {};
  const sourceOf: Record<string, string> = {};

  const add = (bindings: ExtensionBindings, source: string) => {
    for (const [ name, resource ] of Object.entries(bindings)) {
      if (name in merged && merged[name] !== resource) {
        throw new Error(
          `The binding '${name}' is '${merged[name]}' in ${sourceOf[name]}, ` +
          `but '${resource}' in ${source}. Use the same resource, or another name.`,
        );
      }
      merged[name] = resource;
      sourceOf[name] ??= source;
    }
  };

  add(appBindings ?? {}, 'templateOptions.hono.bindings');
  for (const entry of entries) {
    const source = `hono-extensions/${entry.file}`;
    const module = entry.module as Partial<Extension> | undefined;
    if (module == null || module.kind !== 'extension') {
      throw new Error(`${source}: the default export must be defineExtension(…).`);
    }
    const phases = module.phases as unknown;
    const keys = isPlainObject(phases) ? Object.keys(phases) : [];
    const unknown = keys.filter(key => !(EXTENSION_PHASES as readonly string[]).includes(key));
    if (!isPlainObject(phases) || keys.length === 0 || unknown.length > 0) {
      throw new Error(
        `${source}: defineExtension() needs a function, or an object with a function ` +
        `for one or more of the phases ${EXTENSION_PHASES.join(', ')}.` +
        (unknown.length === 1 ? ` '${unknown[0]}' is not a phase.` : '') +
        (unknown.length > 1 ? ` ${unknown.map(x => `'${x}'`).join(', ')} are not phases.` : ''),
      );
    }
    for (const key of keys) {
      if (typeof phases[key] !== 'function') {
        throw new Error(`${source}: the phase ${key} must be a function.`);
      }
    }
    add(module.bindings ?? {}, source);
  }
  return merged;
}
