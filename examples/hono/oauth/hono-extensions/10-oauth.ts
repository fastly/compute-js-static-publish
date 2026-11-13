// The OAuth example: a login with GitHub or Google, with @hono/oauth-providers.
// The 10- prefix puts this module before other modules in each phase.
//
// All of it is in the middleware phase, which comes before the routes of all
// modules:
// - The login check, on the paths of the protect option (default: all paths).
//   It runs on each request, and checks the path of the request, and also the
//   path without the prefix of a path source of collection selection (for
//   example /docs/ of /_preview/staging/docs/), so that a preview URL needs
//   the same login. A visitor without a valid session goes to the login path.
//   With allowedUsers, other users get 403. The responses get
//   'Cache-Control: private', so that a shared cache does not keep them. The
//   paths under /auth/, and the login path, do not need a session.
// - GET /auth/github, GET /auth/google: start the login. The provider then
//   sends the visitor back to the same path with a code. The route gets the
//   user from the provider, sets the session cookie, and goes back to the path
//   that the visitor opened.
// - GET /auth/logout: deletes the session cookie.
//
// The client secrets are in the Secret Store, and the app can read a secret
// only while it handles a request. Thus each request makes the middleware of
// the provider again, with the secret.
import { defineExtension } from '@fastly/compute-js-static-publish/hono';
import { githubAuth } from '@hono/oauth-providers/github';
import { googleAuth } from '@hono/oauth-providers/google';
import { type Context, type MiddlewareHandler } from 'hono';
import {
  AUTH_PATH,
  OAUTH_BINDINGS,
  type OAuthOptions,
  type OAuthUser,
  deleteSession,
  isUnderPrefix,
  oauthSecret,
  protectPrefixes,
  readSession,
  setReturnTo,
  takeReturnTo,
  writeSession,
} from './lib/session';

const DEFAULT_SESSION_MAX_AGE = 24 * 60 * 60;

// Runs the middleware of a provider with the client secret from the Secret
// Store.
function withSecret(secretKey: string, make: (clientSecret: string) => MiddlewareHandler): MiddlewareHandler {
  return async (c, next) => {
    const clientSecret = await oauthSecret(c, secretKey);
    if (clientSecret == null || clientSecret === '') {
      return c.text(`The login is not set up: the Secret Store oauth has no ${secretKey}.\n`, 503);
    }
    return make(clientSecret)(c, next);
  };
}

export default defineExtension({ bindings: OAUTH_BINDINGS }, (app, options?: OAuthOptions) => {
  const prefixes = protectPrefixes(options?.protect);
  const login = options?.login ?? `${AUTH_PATH}/github`;
  const loginPath = new URL(login, 'https://localhost').pathname;

  app.use('*', async (c, next) => {
    if (c.req.path === AUTH_PATH || c.req.path.startsWith(`${AUTH_PATH}/`) || c.req.path === loginPath) {
      return next();
    }
    // selectCollection() sets this path for a path source.
    const pathInCollection: string | undefined = c.get('staticPublisher')?.pathname;
    if (!isUnderPrefix(c.req.path, prefixes) && (pathInCollection == null || !isUnderPrefix(pathInCollection, prefixes))) {
      return next();
    }
    const sessionKey = await oauthSecret(c, 'SESSION_KEY');
    if (sessionKey == null || sessionKey === '') {
      return c.text('The login is not set up: the Secret Store oauth has no SESSION_KEY.\n', 503);
    }
    const user = await readSession(c, sessionKey);
    if (user == null) {
      const url = new URL(c.req.url);
      setReturnTo(c, url.pathname + url.search);
      return c.redirect(login);
    }
    if (options?.allowedUsers != null && !options.allowedUsers.includes(user.id) && !options.allowedUsers.includes(user.accountId)) {
      return c.text('Forbidden\n', 403);
    }
    c.set('user', user);
    await next();
    c.header('Cache-Control', 'private');
  });

  const maxAge = options?.sessionMaxAge ?? DEFAULT_SESSION_MAX_AGE;

  // Sets the session of the user, and goes back to the path that the visitor
  // opened.
  const finishLogin = async (c: Context, user: OAuthUser | null) => {
    const sessionKey = await oauthSecret(c, 'SESSION_KEY');
    if (sessionKey == null || sessionKey === '') {
      return c.text('The login is not set up: the Secret Store oauth has no SESSION_KEY.\n', 503);
    }
    if (user == null) {
      return c.text('The provider did not give a user.\n', 400);
    }
    await writeSession(c, sessionKey, user, maxAge);
    return c.redirect(takeReturnTo(c));
  };

  const github = options?.github;
  if (github?.clientId != null) {
    app.get(
      `${AUTH_PATH}/github`,
      withSecret('GITHUB_CLIENT_SECRET', (clientSecret) =>
        githubAuth({ client_id: github.clientId, client_secret: clientSecret, oauthApp: true, scope: [ 'read:user', 'user:email' ] })),
      (c) => {
        const user = c.get('user-github');
        return finishLogin(c, user?.login == null ? null : {
          id: `github:${user.login}`,
          accountId: `github-id:${user.id}`,
          name: user.name ?? user.login,
        });
      },
    );
  }

  const google = options?.google;
  if (google?.clientId != null) {
    app.get(
      `${AUTH_PATH}/google`,
      withSecret('GOOGLE_CLIENT_SECRET', (clientSecret) =>
        googleAuth({ client_id: google.clientId, client_secret: clientSecret, scope: [ 'openid', 'email', 'profile' ] })),
      (c) => {
        const user = c.get('user-google');
        // Only an email address that Google verified identifies the user.
        return finishLogin(c, user?.email == null || !user.verified_email ? null : {
          id: `google:${user.email}`,
          accountId: `google-id:${user.id}`,
          name: user.name ?? user.email,
        });
      },
    );
  }

  app.get(`${AUTH_PATH}/logout`, (c) => {
    deleteSession(c);
    return c.redirect('/');
  });
});
