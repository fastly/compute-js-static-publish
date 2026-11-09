/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// A list of items that select paths, as in server.staticItems and hiddenItems.
// The config loader changes glob patterns into 're:' items. Each item is one of:
// - 're:/<regex>/<flags>': a regular expression, tested against the path.
// - a string that ends with '/': a directory. It selects the paths that start with it.
// - any other string: it selects exactly that path.
export type ItemPattern = string | RegExp;

// Parse normalized items. An item that cannot be parsed is skipped, and
// onError is called for it.
export function parseItemPatterns(
  items: readonly string[],
  onError?: (index: number, item: string) => void,
): ItemPattern[] {
  const result: ItemPattern[] = [];
  items.forEach((x, i) => {
    if (x.startsWith('re:')) {
      const fragments = x.slice(3).match(/\/(.*?)\/([a-z]*)?$/i);
      let re: RegExp | null = null;
      if (fragments != null) {
        try {
          re = new RegExp(fragments[1], fragments[2] || '');
        } catch {
        }
      }
      if (re == null) {
        onError?.(i, x);
        return;
      }
      result.push(re);
      return;
    }
    if (x !== '') {
      result.push(x);
    }
  });
  return result;
}

export function testItemPatterns(patterns: readonly ItemPattern[], path: string): boolean {
  return patterns.some(x => {
    if (x instanceof RegExp) {
      return x.test(path);
    }
    if (x.endsWith('/')) {
      return path.startsWith(x);
    }
    return x === path;
  });
}
