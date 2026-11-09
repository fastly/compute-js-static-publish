# GRIP example: realtime streams with Fastly Fanout

This example adds realtime endpoints to a static site that uses the `hono` template of `@fastly/compute-js-static-publish`. A visitor opens a stream, and your backend or your CI publishes messages to it through [Fastly Fanout](https://www.fastly.com/documentation/guides/concepts/real-time-messaging/fanout/). It uses [`@fanoutio/serve-grip`](https://github.com/fanout/js-serve-grip).

## This is an example, not a template

You cannot scaffold an app "with this example". There is no flag or command that adds it. To use it, copy its `hono-extensions/` folder into your project, and set it up as this README shows. After you copy it, the code is yours: read it, and change it for your site. It is a starting point, not a supported feature of this package.

The steps:

1. Make a new managed project with the `hono` template. Run this command in the directory of your project. In this example, the files of your site are in `./public`:

   ```sh
   npx @fastly/compute-js-static-publish@beta --managed --template hono --root-dir=./public --kv-store-name=site-content
   ```

   This writes `static-publish.project.js` and the folder `hono-extensions/`. To add the example to a project that exists, see [Adding to an existing project](#adding-to-an-existing-project).
2. Replace the `hono-extensions/` folder of your project with the `hono-extensions/` folder of this example (`examples/hono/grip/hono-extensions/` in this repository). Then update the folder for your project, and install its packages:

   ```sh
   rm -rf hono-extensions
   cp -R <this repository>/examples/hono/grip/hono-extensions hono-extensions
   npx @fastly/compute-js-static-publish template init
   cd hono-extensions
   npm install
   ```

   `template init` adds the packages that the template provides to `package.json` (as peer dependencies), and the starter files (`tsconfig.json`, and `_example.ts`, which the build does not load). `npm install` installs the packages of the example.
3. Set up the example in `static-publish.project.js` (a managed project):
   - the options in `templateOptions.hono.extensions.grip` (see [Options](#options));
   - for local development, the sections of `managed.fastlyToml` in [Local development](#local-development);
   - for Fastly, the steps in [On Fastly](#on-fastly).

   In an ejected app, put `templateOptions` in `static-publish.rc.js`, and the `fastlyToml` sections in `compute-js/fastly.toml`.

## What it does

```
GET  /events/stream/:channel   An HTTP stream. Each message is one line.
GET  /events/sse/:channel      Server-Sent Events, for EventSource in a browser.
POST /publish/:channel         Sends the request body to both endpoints of the channel.
                               Needs the header 'Authorization: Bearer <PUBLISH_KEY>'.
```

The flow of a stream request:

```
GET /events/stream/news  (from the visitor)
  → grip.ts, middleware phase: no Grip-Sig header → hand off to Fanout ─┐
                                                                       │
  ┌────────────────────────────────────────────────────────────────────┘
  ▼
GET /events/stream/news  (from Fanout, with Grip-Sig, through the backend 'self')
  → grip.ts, middleware phase: the signature is correct → c.var.grip
  → grip.ts, beforeFiles phase: hold a stream on the channel 'stream:news'
      Fanout keeps the connection to the visitor open, and sends each message.
```

- **One module, two phases.** `grip.ts` adds the Fanout handoff and `serveGrip()` in the `middleware` phase, and the three endpoints in the `beforeFiles` phase.
- **Only `/events/*` goes through Fanout.** The middleware phase adds the handoff with `app.use('/events/*', …)`, so the published files and other routes do not go through Fanout, and keep the cache. This is the pattern of the Fastly starter kit [`fanout`](https://github.com/fastly/compute-starter-kits/tree/main/starter-kits/javascript/fanout): the app hands off one path, and answers the requests that come back from Fanout itself.
- **The publish endpoint** sends each message two times: to `stream:<channel>` as a line, and to `sse:<channel>` as an SSE event. A request without the correct key gets `401`. If the Secret Store has no `PUBLISH_KEY`, the endpoint gives `503`. You can also publish without this endpoint, with the publish API of Fastly (`POST https://api.fastly.com/service/<service ID>/publish/`, see the [Fanout guide](https://www.fastly.com/documentation/guides/concepts/real-time-messaging/fanout/)).

## Options

In `templateOptions.hono.extensions.grip`:

```js
templateOptions: {
  hono: {
    extensions: { grip: { path: '/events', publishPath: '/publish' } },
  },
},
```

| Option | Default | |
| --- | --- | --- |
| `path` | `/events` | The path of the stream endpoints. |
| `publishPath` | `/publish` | The path of the publish endpoint. |

## Secrets

The modules read the Secret Store `grip` (the binding `grip: 'SecretStore:grip'`):

| Key | On Fastly | Locally |
| --- | --- | --- |
| `PUBLISH_KEY` | A long random value. Callers of the publish endpoint send it. | Any value. |
| `FANOUT_API_TOKEN` | A Fastly API token that can publish to this service, for the publish endpoint. | Not used. |
| `GRIP_URL` | Not set. The app then uses the publish API of this service, and the public key of Fastly Fanout. | `http://localhost:5561/?verify-iss=viceroy` (Pushpin). |
| `GRIP_VERIFY_KEY` | Not set. | `viceroy_dev_signing_key_dont_use_in_production` |

## Local development

The Fastly CLI can run [Pushpin](https://pushpin.org/), the open-source GRIP proxy that Fanout is based on, next to the local server. Install Pushpin, so that `pushpin` is on your `PATH`. Then add to `static-publish.project.js`:

```js
managed: {
  // …
  fastlyToml: {
    local_server: {
      pushpin: { enable: true },
      backends: { self: { url: 'http://localhost:7676/', override_host: 'localhost:7676' } },
      secret_stores: {
        grip: [
          { key: 'GRIP_URL', env: 'GRIP_URL' },
          { key: 'GRIP_VERIFY_KEY', env: 'GRIP_VERIFY_KEY' },
          { key: 'PUBLISH_KEY', env: 'PUBLISH_KEY' },
        ],
      },
    },
  },
},
```

The values come from environment variables, so that no secret is in the project file:

```sh
export GRIP_URL='http://localhost:5561/?verify-iss=viceroy'
export GRIP_VERIFY_KEY=viceroy_dev_signing_key_dont_use_in_production
export PUBLISH_KEY=local-publish-key
npx @fastly/compute-js-static-publish dev
```

The backend `self` must point at the address of the local server (`localhost:7676` by default). Then, in one terminal:

```sh
curl -N http://localhost:7676/events/stream/test
```

And in another terminal:

```sh
curl -X POST http://localhost:7676/publish/test -H 'Authorization: Bearer local-publish-key' -d 'hello'
```

The first terminal shows `hello`.

In a browser, SSE works with `EventSource`:

```js
const events = new EventSource('/events/sse/test');
events.onmessage = (event) => console.log(event.data);
```

## On Fastly

1. **Turn on Fanout** for the service. For a new service, add `setup.products.fanout` to `fastlyToml` before the first `deploy`:

   ```js
   fastlyToml: {
     setup: {
       products: { fanout: { enable: true } },
       backends: { self: { address: 'www.example.com', port: 443 } },
       secret_stores: { grip: { entries: {
         PUBLISH_KEY: { description: 'The key for the publish endpoint' },
         FANOUT_API_TOKEN: { description: 'A Fastly API token that can publish' },
       } } },
     },
   },
   ```

   For a service that exists, run `fastly products --enable=fanout`. This does not need a new version of the service.
2. **Add the backend `self`**, with the domain of the service as the address, port `443`, and TLS. For a service that exists, add it in a new version of the service, and activate that version.
3. **Make the Secret Store `grip`** with `PUBLISH_KEY` and `FANOUT_API_TOKEN`, and link it to the service with the name `grip`.

Then open `https://<your domain>/events/stream/test`, and publish with `POST https://<your domain>/publish/test`.

## Adding to an existing project

The project must use the `hono` template. For a managed project, this is `managed.template: 'hono'` in `static-publish.project.js`. If the project has no `hono-extensions/` folder, make it:

```sh
npx @fastly/compute-js-static-publish template init
```

Make sure that `hono-extensions/` does not already have files with the same names (`grip.ts` and `lib/grip.ts`). The name of a module is its file name without the number prefix, and two modules with the same name stop the build. If the name `grip` is already used, rename the module of the example, and use the new name in `templateOptions.hono.extensions`.

Then copy `grip.ts` and `lib/grip.ts` from the `hono-extensions/` folder of this example into your `hono-extensions/` folder, in the same places, and install the packages of the example:

```sh
cd hono-extensions
npm install @fanoutio/grip@^4.4.0 @fanoutio/serve-grip@^4.3.0
```

Then do step 3 above.
