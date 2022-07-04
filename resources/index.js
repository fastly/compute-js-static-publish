/// <reference types="@fastly/js-compute" />

import { Router } from '@fastly/expressly';
import { assets, spaFile, autoIndex, autoExt } from './statics';

const router = new Router();

function getMatchingRequestPath(path) {
  // If the path being looked up does not end in a slash, it has to
  // match exactly one of the assets
  if(!path.endsWith('/')) {

    if(path in assets) {
      return path;
    }

    // try auto-ext
    if(autoExt != null) {
      for (const extEntry of autoExt) {
        let pathWithExt = path + extEntry;
        if(pathWithExt in assets) {
          return pathWithExt;
        }
      }
    }

    return null;

  }

  // try auto-index
  if(autoIndex != null) {
    for (const indexEntry of autoIndex) {
      let indexPath = path + indexEntry;
      if(indexPath in assets) {
        return indexPath;
      }
    }
  }

  return null;
}

router.get("*", (req, res) => {
  const assetPath = getMatchingRequestPath(req.urlObj.pathname);
  if(assetPath == null) {
    return;
  }
  const staticFile = assets[assetPath];

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
  if(!spaFile) {
    return;
  }
  const accept = (req.headers.get('Accept') ?? '')
    .split(',')
    .map(x => x.split(';')[0]);
  if(!accept.includes('text/html') && !accept.includes('*/*') && accept.includes('*')) {
    return;
  }

  const staticFile = assets[spaFile];
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
