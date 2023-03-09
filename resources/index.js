/// <reference types="@fastly/js-compute" />

import { getServer } from './statics.js';

// eslint-disable-next-line no-restricted-globals
addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));
async function handleRequest(event) {

  const server = getServer();
  const response = await server.serveRequest(event.request);

  if (response != null) {
    return response;
  }

  return new Response('Not found', { status: 404 });
}
