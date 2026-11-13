// Helpers of the GRIP example. Files in lib/ are not modules: grip.ts imports
// them.
import { type ExtensionEnv } from '@fastly/compute-js-static-publish/hono';
import { env } from 'fastly:env';
import { type GripConfig } from '@fanoutio/grip';
import { buildFanoutGripConfig } from '@fanoutio/grip/fastly-fanout';
import { type Env as ServeGripEnv } from '@fanoutio/serve-grip/hono';

// The options of the example, in templateOptions.hono.extensions.grip.
export type GripOptions = {
  // The path of the stream endpoints. The default is '/events'.
  path?: string,
  // The path of the publish endpoint. The default is '/publish'.
  publishPath?: string,
};

// The binding of the Secret Store with the GRIP settings, for defineExtension().
// With 'as const', c.env.grip has the type SecretStore | undefined.
export const GRIP_BINDINGS = { grip: 'SecretStore:grip' } as const;

// The Env of the app in this example, with c.env.grip, and c.var.grip of
// serveGrip().
export type GripEnv = ExtensionEnv<typeof GRIP_BINDINGS> & ServeGripEnv;

// The part of a Context that the helpers use.
type WithGripEnv = { env: GripEnv['Bindings'] };

export const eventsPath = (options: GripOptions | undefined) => options?.path ?? '/events';
export const publishPath = (options: GripOptions | undefined) => options?.publishPath ?? '/publish';

// A value of the Secret Store 'grip', or undefined if the store or the key is
// missing.
export async function gripSecret(c: WithGripEnv, key: string): Promise<string | undefined> {
  const entry = await c.env.grip?.get(key);
  return entry?.plaintext();
}

// The GRIP settings, for serveGrip() and for a Publisher.
// - GRIP_URL set (local development with Pushpin): the URL of the GRIP proxy,
//   for example http://localhost:5561/?verify-iss=viceroy, with
//   GRIP_VERIFY_KEY.
// - Otherwise (Fastly Fanout): the publish API of this service, with the API
//   token in FANOUT_API_TOKEN, and the public key of Fastly Fanout to check the
//   signature.
export async function gripConfig(c: WithGripEnv): Promise<{ grip: GripConfig, gripVerifyKey?: string }> {
  const gripUrl = await gripSecret(c, 'GRIP_URL');
  if (gripUrl != null) {
    return { grip: gripUrl, gripVerifyKey: await gripSecret(c, 'GRIP_VERIFY_KEY') };
  }
  return {
    grip: buildFanoutGripConfig({
      serviceId: env('FASTLY_SERVICE_ID') ?? '',
      apiToken: await gripSecret(c, 'FANOUT_API_TOKEN') ?? '',
    }),
  };
}

// Compares two strings in a time that does not depend on where they differ.
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) {
    diff |= x[i] ^ (y[i % (y.length || 1)] ?? 0);
  }
  return diff === 0;
}
