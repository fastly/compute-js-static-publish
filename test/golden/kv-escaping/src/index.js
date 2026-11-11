/// <reference types="@fastly/js-compute" />
import { env } from 'fastly:env';
import { PublisherServer } from '@fastly/compute-js-static-publish';
import rc from '../static-publish.rc.js';
const publisherServer = PublisherServer.fromStaticPublishRc(rc);

// eslint-disable-next-line no-restricted-globals
addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));
async function handleRequest(event) {

  console.log('FASTLY_SERVICE_VERSION', env('FASTLY_SERVICE_VERSION'));

  const request = event.request;

  // Do custom things here!
  // Handle API requests, serve non-static responses, etc.
  // serveRequest() serves the 404 page or the SPA file for each path that
  // has no file, so code after it does not run for those requests.

  const response = await publisherServer.serveRequest(request);
  if (response != null) {
    return response;
  }

  return new Response('Not found', { status: 404 });
}
