// The GRIP example: realtime streams with Fastly Fanout.
//
// The middleware phase, on the stream endpoints only (the path option, default
// /events/*), so that the published files do not go through Fanout:
// 1. A request without a Grip-Sig header comes from a visitor: hand it off to
//    Fanout. Fanout sends it again to this service, through the backend 'self'.
// 2. The request from Fanout has Grip-Sig: serveGrip() checks it, and sets
//    c.var.grip for the stream endpoints.
//
// The beforeFiles phase:
// - GET /events/stream/:channel: an HTTP stream. Each message is one line.
// - GET /events/sse/:channel: Server-Sent Events, for EventSource in a browser.
// - POST /publish/:channel: sends the request body to both endpoints of the
//   channel. It needs the header 'Authorization: Bearer <PUBLISH_KEY>'.
import { defineExtension } from '@fastly/compute-js-static-publish/hono';
import { Publisher } from '@fanoutio/grip';
import { fanoutSelfHandoffMiddleware, serveGrip } from '@fanoutio/serve-grip/hono';
import { type Context } from 'hono';
import { GRIP_BINDINGS, type GripEnv, type GripOptions, eventsPath, gripConfig, gripSecret, publishPath, safeEqual } from './lib/grip';

// Fanout must have sent the request, and the signature must be correct.
function checkGrip(c: Context): Response | null {
  const grip = c.get('grip');
  if (grip == null || !grip.isProxied) {
    return c.text('This endpoint works only through Fanout.\n', 400);
  }
  if (grip.needsSigned && !grip.isSigned) {
    return c.text('The Grip-Sig signature is not correct.\n', 403);
  }
  return null;
}

// Each line of an SSE message needs the 'data: ' prefix.
const sseEvent = (text: string) => text.split('\n').map(line => `data: ${line}\n`).join('') + '\n';

export default defineExtension({ bindings: GRIP_BINDINGS }, {
  middleware: (app, options?: GripOptions) => {
    app.use(`${eventsPath(options)}/*`, fanoutSelfHandoffMiddleware('self'), serveGrip<GripEnv>((c) => gripConfig(c)));
  },

  beforeFiles: (app, options?: GripOptions) => {
    app.get(`${eventsPath(options)}/stream/:channel`, (c) => {
      const error = checkGrip(c);
      if (error != null) {
        return error;
      }
      const instruct = c.get('grip').startInstruct();
      instruct.addChannel(`stream:${c.req.param('channel')}`);
      instruct.setHoldStream();
      return c.text('[stream open]\n');
    });

    app.get(`${eventsPath(options)}/sse/:channel`, (c) => {
      const error = checkGrip(c);
      if (error != null) {
        return error;
      }
      const instruct = c.get('grip').startInstruct();
      instruct.addChannel(`sse:${c.req.param('channel')}`);
      instruct.setHoldStream();
      instruct.setKeepAlive(':\n\n', 20);
      return c.body(':open\n\n', 200, { 'content-type': 'text/event-stream' });
    });

    app.post(`${publishPath(options)}/:channel`, async (c) => {
      const publishKey = await gripSecret(c, 'PUBLISH_KEY');
      if (publishKey == null || publishKey === '') {
        return c.text('Publishing is not set up: the Secret Store grip has no PUBLISH_KEY.\n', 503);
      }
      if (!safeEqual(c.req.header('authorization') ?? '', `Bearer ${publishKey}`)) {
        return c.text('Unauthorized\n', 401);
      }
      const channel = c.req.param('channel');
      const text = (await c.req.text()).replace(/\n$/, '');
      const publisher = new Publisher((await gripConfig(c)).grip);
      await publisher.publishHttpStream(`stream:${channel}`, `${text}\n`);
      await publisher.publishHttpStream(`sse:${channel}`, sseEvent(text));
      return c.text('Published\n');
    });
  },
});
