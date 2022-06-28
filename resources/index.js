/// <reference types="@fastly/js-compute" />

import { Router } from '@fastly/expressly';
import { assets, isSpa } from './statics';

const router = new Router();

router.get("*", (req, res) => {
  const path = req.urlObj.pathname !== '/' ? req.urlObj.pathname : '/index.html';
  const staticFile = assets[path];
  if(staticFile == null) {
    return;
  }

  // Aggressive caching for static files, and no caching for everything else.
  // https://create-react-app.dev/docs/production-build/#static-file-caching
  const headers = {
    'Cache-Control': staticFile.isStatic ? 'max-age=31536000' : 'no-cache',
  };
  if(staticFile.contentType != null) {
    headers['Content-Type'] = staticFile.contentType;
  }
  res.send(new Response(staticFile.content, {
    status: 200,
    headers,
  }));
});

// TODO: If you need to handle any API routes, add them here.
// router.get("/api/endpoint", (req, res) => {
//   res.send("foo");
// });

// If this is a SPA, then return index.html for HTML requests
router.get("*", (req, res) => {
  if(!isSpa || !(req.headers.get('Accept') ?? '').split(',').includes('text/html')) {
    return;
  }

  const staticFile = assets['/index.html'];
  res.send(new Response(staticFile.content, {
    status: 200,
    headers: {
      'Cache-Control': 'no-cache',
      'Content-Type': 'text/html',
    }
  }));
});

router.all("*", (req, res) => {
  res.send(new Response("404 Not Found", {
    status: 404,
    headers: {
      'Content-Type': 'text/plain',
    },
  }));
});

router.listen();
