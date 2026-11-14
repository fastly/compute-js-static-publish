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

  // Select the collection with collectionSelection in static-publish.rc.js, for
  // example for previews. Without it, this selects the default collection.
  const selection = publisherServer.resolveCollection(request);
  if (selection.response != null) {
    return selection.response;
  }

  // Code that must run before the published files goes here.

  // Serve the published file for the request. With fallback: false, a path
  // that has no file does not get the SPA file or the 404 page here.
  const response = await publisherServer.serveRequest(request, {
    collectionName: selection.collectionName,
    pathname: selection.pathname,
    fallback: false,
  });
  if (response != null) {
    return response;
  }

  // Do custom things here!
  // Handle API requests, serve non-static responses, etc. This code runs only
  // for the requests that no published file matches.

  // When nothing else matches, serve the SPA file or the 404 page.
  const fallback = await publisherServer.serveFallback(request, {
    collectionName: selection.collectionName,
  });
  return fallback ?? new Response('Not found', { status: 404 });
}
