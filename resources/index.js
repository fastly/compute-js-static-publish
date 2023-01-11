/// <reference types="@fastly/js-compute" />

import { Router } from '@fastly/expressly';
import { staticAssets, spaFile, notFoundPageFile, autoIndex, autoExt } from './statics';

const router = new Router();

function getMatchingRequestPath(path) {

  if(!path.endsWith('/')) {
    // A path that does not end in a slash can match an asset directly
    if (staticAssets.getAsset(path) != null) {
      return path;
    }

    // ... or, we can try auto-ext:
    // looks for an asset that has the specified suffix (usually extension, such as .html)
    if(Array.isArray(autoExt)) {
      for (const extEntry of autoExt) {
        let pathWithExt = path + extEntry;
        if (staticAssets.getAsset(pathWithExt) != null) {
          return pathWithExt;
        }
      }
    }
  }

  // try auto-index:
  // treats the path as a directory, and looks for an asset with the specified
  // suffix (usually an index file, such as index.html)
  let dir = path;
  // remove all slashes from end, and add one trailing slash
  while(dir.endsWith('/')) {
    dir = dir.slice(0, -1);
  }
  dir = dir + '/';
  if(Array.isArray(autoIndex)) {
    for (const indexEntry of autoIndex) {
      let indexPath = dir + indexEntry;
      if (staticAssets.getAsset(indexPath) != null) {
        return indexPath;
      }
    }
  }

  return null;
}

function requestAcceptsTextHtml(req) {
  const accept = (req.headers.get('Accept') ?? '')
    .split(',')
    .map(x => x.split(';')[0]);
  if(!accept.includes('text/html') && !accept.includes('*/*') && accept.includes('*')) {
    return false;
  }
  return true;
}

router.get("*", (req, res) => {
  const assetPath = getMatchingRequestPath(req.urlObj.pathname);
  const asset = staticAssets.getAsset(assetPath);
  if(asset == null) {
    return;
  }

  const response = staticAssets.serveAsset(asset);
  res.send(response);
});

// TODO: If you need to handle any API routes, add them here.
// router.get("/api/endpoint", (req, res) => {
//   res.send("foo");
// });

// If this is a SPA, then return index.html for HTML requests
router.get("*", (req, res) => {
  if(!spaFile) {
    return;
  }
  if(!requestAcceptsTextHtml(req)) {
    return;
  }
  const asset = staticAssets.getAsset(spaFile);
  if(asset == null) {
    return;
  }

  const response = new Response(asset.content, {
    status: 200,
    headers: {
      'Cache-Control': 'no-cache',
      'Content-Type': 'text/html',
    }
  });
  res.send(response);
});

router.all("*", (req, res) => {
  if(notFoundPageFile && requestAcceptsTextHtml(req)) {
    const asset = staticAssets.getAsset(notFoundPageFile);
    if(asset != null) {
      const response = new Response(asset.content, {
        status: 404,
        headers: {
          'Cache-Control': 'no-cache',
          'Content-Type': 'text/html',
        }
      });
      res.send(response);
      return;
    }
  }

  res.send(new Response("404 Not Found", {
    status: 404,
    headers: {
      'Content-Type': 'text/plain',
    },
  }));
});

router.listen();
