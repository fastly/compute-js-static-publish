/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import {
  type CollectionSelection,
  type CollectionSelectionCookieSource,
  type CollectionSelectionSource,
  validateCollectionSelection,
} from '../../models/config/collection-selection.js';

// The scaffold flags of collection selection. Each field of collectionSelection
// has a flag, so that disposable and CI setups do not need a config file.
//
//   --collection-selection=<type>[:<value>][,<option>]...   (can be repeated, in order)
//     host:<pattern>                  host:{collection}.preview.example.com
//     path:<prefix>[,sticky]          path:/_preview/{collection},sticky
//     query:<param>[,sticky]          query:collection,sticky
//     cookie[:<cookieName>][,maxAge=<seconds>][,activatePath=<path>][,resetPath=<path>]
//     header:<name>                   header:x-publisher-collection
//   --collection-allow=<pattern>[,<pattern>]...              (can be repeated)
//   --collection-on-missing=not-found|default
//   --collection-noindex=true|false
export type CollectionSelectionFlags = {
  sources?: string[],
  allow?: string[],
  onMissing?: string,
  noindex?: string,
};

export const COLLECTION_SELECTION_FLAGS_HELP = `\
  --collection-selection <source>       Select the collection of a request, for example for
                                        previews. Can be repeated; the sources are tried in order.
                                          host:<pattern>             host:{collection}.preview.example.com
                                          path:<prefix>[,sticky]     path:/_preview/{collection},sticky
                                          query:<param>[,sticky]     query:collection,sticky
                                          cookie[:<name>][,maxAge=<seconds>][,activatePath=<path>][,resetPath=<path>]
                                          header:<name>              header:x-publisher-collection
                                        'sticky' sets the cookie of the cookie source, and needs one.
  --collection-allow <patterns>         The collections that can be selected, for example "pr-*,staging".
                                        Default: any collection.
  --collection-on-missing <value>       When the selected collection does not exist: 'not-found'
                                        (default) or 'default' (serve the default collection).
  --collection-noindex <true|false>     Add 'X-Robots-Tag: noindex' to the responses of a collection
                                        that is not the default collection. Default: true.`;

function parseSource(spec: string, errors: string[]): CollectionSelectionSource | null {
  const [ head, ...options ] = spec.split(',').map(x => x.trim());
  const colon = head.indexOf(':');
  const type = colon === -1 ? head : head.slice(0, colon);
  const value = colon === -1 ? undefined : head.slice(colon + 1);

  const needValue = (what: string) => {
    if (value == null || value === '') {
      errors.push(`--collection-selection ${type}: give the ${what}, for example '${type}:<${what}>'.`);
      return false;
    }
    return true;
  };
  const sticky = () => {
    let result: 'cookie' | undefined;
    for (const option of options) {
      if (option === 'sticky') {
        result = 'cookie';
      } else {
        errors.push(`--collection-selection ${type}: unknown option '${option}'.`);
      }
    }
    return result;
  };
  const noOptions = () => {
    for (const option of options) {
      errors.push(`--collection-selection ${type}: unknown option '${option}'.`);
    }
  };

  switch (type) {
  case 'host':
    noOptions();
    return needValue('pattern') ? { type, pattern: value! } : null;
  case 'path': {
    const s = sticky();
    return needValue('prefix') ? { type, prefix: value!, ...(s != null ? { sticky: s } : {}) } : null;
  }
  case 'query': {
    const s = sticky();
    return needValue('param') ? { type, param: value!, ...(s != null ? { sticky: s } : {}) } : null;
  }
  case 'header':
    noOptions();
    return needValue('name') ? { type, name: value! } : null;
  case 'cookie': {
    const source: CollectionSelectionCookieSource = { type };
    if (value != null && value !== '') {
      source.cookieName = value;
    }
    for (const option of options) {
      const eq = option.indexOf('=');
      const key = eq === -1 ? option : option.slice(0, eq);
      const optionValue = eq === -1 ? '' : option.slice(eq + 1);
      if (key === 'maxAge' && /^\d+$/.test(optionValue)) {
        source.maxAge = Number(optionValue);
      } else if (key === 'activatePath' || key === 'resetPath') {
        source[key] = optionValue;
      } else {
        errors.push(`--collection-selection cookie: unknown or invalid option '${option}'.`);
      }
    }
    return source;
  }
  default:
    errors.push(`--collection-selection: unknown source '${type}'. Use host, path, query, cookie, or header.`);
    return null;
  }
}

// Returns the collectionSelection from the flags (undefined if no flag is set),
// and the errors.
export function collectionSelectionFromFlags(flags: CollectionSelectionFlags): {
  collectionSelection: CollectionSelection | undefined,
  errors: string[],
} {
  const errors: string[] = [];
  const sources = flags.sources ?? [];
  if (sources.length === 0) {
    if (flags.allow != null || flags.onMissing != null || flags.noindex != null) {
      errors.push('--collection-allow, --collection-on-missing, and --collection-noindex need --collection-selection.');
    }
    return { collectionSelection: undefined, errors };
  }

  const collectionSelection: CollectionSelection = { sources: [] };
  for (const spec of sources) {
    const source = parseSource(spec, errors);
    if (source != null) {
      collectionSelection.sources.push(source);
    }
  }
  if (flags.allow != null) {
    collectionSelection.allow = flags.allow.flatMap(x => x.split(',')).map(x => x.trim()).filter(x => x !== '');
  }
  if (flags.onMissing != null) {
    collectionSelection.onMissing = flags.onMissing as CollectionSelection['onMissing'];
  }
  if (flags.noindex != null) {
    if (flags.noindex === 'true') {
      collectionSelection.noindex = true;
    } else if (flags.noindex === 'false') {
      collectionSelection.noindex = false;
    } else {
      errors.push(`--collection-noindex must be 'true' or 'false'.`);
    }
  }

  if (errors.length === 0) {
    errors.push(...validateCollectionSelection(collectionSelection));
  }
  return { collectionSelection: errors.length === 0 ? collectionSelection : undefined, errors };
}
