// Helpers of the OAuth example. Files in lib/ are not modules: 10-oauth.ts
// imports them.
import { type ExtensionEnv } from '@fastly/compute-js-static-publish/hono';
import { type Context } from 'hono';
import { deleteCookie, getCookie, getSignedCookie, setCookie, setSignedCookie } from 'hono/cookie';

// The options of the example, in templateOptions.hono.extensions.oauth. A
// provider without a clientId has no login route.
export type OAuthOptions = {
  // The paths that need a login. The default is '/*', all paths.
  protect?: string | string[],
  // Where a visitor without a session goes. The default is '/auth/github'.
  login?: string,
  // If set, only these users can log in, for example
  // [ 'github:octocat', 'google:someone@example.com' ].
  allowedUsers?: string[],
  github?: { clientId: string },
  google?: { clientId: string },
  // How long a session lasts, in seconds. The default is one day.
  sessionMaxAge?: number,
};

// The visitor of a session, on c.var.user after the login check.
export type OAuthUser = {
  // The provider and the name, for example 'github:octocat' or
  // 'google:someone@example.com'. allowedUsers uses this value.
  id: string,
  name: string,
};

// The login routes start with this path. The login check lets them through
// without a session.
export const AUTH_PATH = '/auth';

// The binding of the Secret Store with the secrets, for defineExtension().
// With 'as const', c.env.oauth has the type SecretStore | undefined.
export const OAUTH_BINDINGS = { oauth: 'SecretStore:oauth' } as const;

const SESSION_COOKIE = 'session';
const RETURN_TO_COOKIE = 'oauth_return_to';

// A value of the Secret Store 'oauth', or undefined if the store or the key is
// missing.
export async function oauthSecret(c: { env: ExtensionEnv<typeof OAUTH_BINDINGS>['Bindings'] }, key: string): Promise<string | undefined> {
  const entry = await c.env.oauth?.get(key);
  return entry?.plaintext();
}

// The user of the session cookie, or null if there is no cookie, or if its
// signature or its time is not valid.
export async function readSession(c: Context, sessionKey: string): Promise<OAuthUser | null> {
  const value = await getSignedCookie(c, sessionKey, SESSION_COOKIE);
  if (typeof value !== 'string') {
    return null;
  }
  try {
    const session = JSON.parse(value);
    if (typeof session.id !== 'string' || typeof session.exp !== 'number' || session.exp < Date.now() / 1000) {
      return null;
    }
    return { id: session.id, name: String(session.name ?? '') };
  } catch {
    return null;
  }
}

export async function writeSession(c: Context, sessionKey: string, user: OAuthUser, maxAge: number) {
  const exp = Math.floor(Date.now() / 1000) + maxAge;
  await setSignedCookie(c, SESSION_COOKIE, JSON.stringify({ ...user, exp }), sessionKey, {
    path: '/', httpOnly: true, secure: true, sameSite: 'Lax', maxAge,
  });
}

export function deleteSession(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
}

// Keeps the path that the visitor opened, to go back to it after the login.
export function setReturnTo(c: Context, path: string) {
  setCookie(c, RETURN_TO_COOKIE, path, { path: AUTH_PATH, httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 600 });
}

// The path to go back to after the login. Only a path on this site, so that
// the cookie cannot send the visitor to another site.
export function takeReturnTo(c: Context): string {
  const path = getCookie(c, RETURN_TO_COOKIE);
  deleteCookie(c, RETURN_TO_COOKIE, { path: AUTH_PATH, secure: true });
  return path != null && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path : '/';
}
