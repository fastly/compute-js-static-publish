/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

import crypto from 'node:crypto';

// The fingerprint of a managed app: a SHA-256 over the generated files and the
// version of this package. If it is the same as the fingerprint of the active
// service version, a deploy is not necessary. It does not depend on:
// - the service ID (fastly.toml gets it after the first deploy),
// - generatedFrom (a date),
// - the path of this package on the machine (the `file:` link),
// - the publishContent section (the app does not have publish-content.config.js),
// - the content.

// The files of a managed app: generateApp() makes them, without
// publish-content.config.js. A managed app publishes from the project file.
export function managedAppFiles(files: Record<string, string>): Record<string, string> {
  const result = { ...files };
  delete result['publish-content.config.js'];
  return result;
}

export type FingerprintOptions = {
  staticPublishVersion: string,
  template: string,
  // The values to replace with a fixed placeholder, for example the absolute
  // path of the CLI's package dir and its path relative to the app dir.
  machinePaths: string[],
};

export function computeFingerprint(files: Record<string, string>, options: FingerprintOptions): string {
  // The longest first, so that a path that contains another path is replaced whole.
  const machinePaths = [ ...options.machinePaths ].filter(x => x !== '').sort((a, b) => b.length - a.length);
  const normalized = Object.entries(files)
    .map(([ file, content ]): [ string, string ] => {
      let text = content;
      for (const machinePath of machinePaths) {
        text = text.split(machinePath).join('<compute-js-static-publish>');
      }
      if (file === 'fastly.toml') {
        text = text.replace(/^service_id = .*\n/m, '');
      }
      // A managed app has no generatedFrom, but it must never count.
      if (file === 'static-publish.rc.js') {
        text = text.replace(/^ {2}generatedFrom: \{\n[\s\S]*?^ {2}\},\n/m, '');
      }
      return [ file, text ];
    })
    .sort(([ a ], [ b ]) => a < b ? -1 : a > b ? 1 : 0);
  return crypto.createHash('sha256')
    .update(JSON.stringify({
      staticPublishVersion: options.staticPublishVersion,
      template: options.template,
      files: normalized,
    }))
    .digest('hex');
}

// The comment of the service version that deploy makes. status reads it back.
export function formatVersionComment(staticPublishVersion: string, fingerprint: string, userComment?: string): string {
  const comment = `static-publish ${staticPublishVersion} fp:${fingerprint}`;
  return userComment != null && userComment.trim() !== '' ? `${comment} | ${userComment.trim()}` : comment;
}

export function parseVersionComment(comment: string | null | undefined): { staticPublishVersion: string, fingerprint: string } | null {
  const match = /(?:^|\s)static-publish (\S+) fp:([0-9a-f]{64})(?:\s|$)/.exec(comment ?? '');
  if (match == null) {
    return null;
  }
  return { staticPublishVersion: match[1], fingerprint: match[2] };
}
