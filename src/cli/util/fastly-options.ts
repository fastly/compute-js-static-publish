/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// The options after -- of deploy, which go to 'fastly compute deploy' (or
// 'fastly compute publish' in an ejected app). deploy refuses the options that
// it sets itself, and the options that make the Fastly CLI deploy another
// package, from another directory, or with another manifest or token.

const REFUSED = new Map<string, string>([
  [ 'comment', `deploy sets the comment of the service version. Use the --comment option of deploy (before --).` ],
  [ 'service-id', `Use --fastly-service-id or FASTLY_SERVICE_ID.` ],
  [ 'token', `Use --fastly-api-token or FASTLY_API_TOKEN.` ],
  [ 'package', `deploy deploys the package that it builds.` ],
  [ 'dir', `deploy deploys the app of the project.` ],
  [ 'env', `deploy uses the fastly.toml of the app.` ],
]);

// The short forms of the refused options. In 'fastly compute deploy' and
// 'fastly compute publish', these are the only short options that take a
// value. The other short options (-i, -y, -d, -v, -q, -h) take no value, so a
// group such as -is is -i and then -s.
const REFUSED_SHORT = new Map<string, string>([
  [ 's', 'service-id' ],
  [ 't', 'token' ],
  [ 'p', 'package' ],
  [ 'C', 'dir' ],
]);

// Returns the error message for the first refused option in args, or null if
// args has none. A value that starts with '-' (for example --service-name -s)
// looks like an option, so it can also be refused.
export function findRefusedFastlyOption(args: string[]): string | null {
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const name = arg.slice(2).split('=')[0];
      const reason = REFUSED.get(name);
      if (reason != null) {
        return `--${name} cannot be given to the Fastly CLI. ${reason}`;
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      for (const letter of arg.slice(1)) {
        if (letter === '=') {
          break;
        }
        const name = REFUSED_SHORT.get(letter);
        if (name != null) {
          return `-${letter} (--${name}) cannot be given to the Fastly CLI. ${REFUSED.get(name)}`;
        }
      }
    }
  }
  return null;
}
