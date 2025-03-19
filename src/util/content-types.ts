import {
  ContentTypeDef,
  ContentTypeTestResult,
} from "../types/content-types.js";

const defaultContentTypes: ContentTypeDef[] = [
  // Text formats
  { test: /.txt$/, contentType: 'text/plain', text: true },
  { test: /.htm(l)?$/, contentType: 'text/html', text: true },
  { test: /.xml$/, contentType: 'application/xml', text: true },
  { test: /.json$/, contentType: 'application/json', text: true },
  { test: /.map$/, contentType: 'application/json', text: true },
  { test: /.js$/, contentType: 'application/javascript', text: true },
  { test: /.css$/, contentType: 'text/css', text: true },
  { test: /.svg$/, contentType: 'image/svg+xml', text: true },

  // Binary formats
  { test: /.bmp$/, contentType: 'image/bmp', text: false },
  { test: /.png$/, contentType: 'image/png', text: false },
  { test: /.gif$/, contentType: 'image/gif', text: false },
  { test: /.jp(e)?g$/, contentType: 'image/jpeg', text: false },
  { test: /.ico$/, contentType: 'image/vnd.microsoft.icon', text: false },
  { test: /.tif(f)?$/, contentType: 'image/png', text: false },
  { test: /.webp$/, contentType: 'image/webp', text: false },
  { test: /.aac$/, contentType: 'audio/aac', text: false },
  { test: /.mp3$/, contentType: 'audio/mpeg', text: false },
  { test: /.avi$/, contentType: 'video/x-msvideo', text: false },
  { test: /.mp4$/, contentType: 'video/mp4', text: false },
  { test: /.mpeg$/, contentType: 'video/mpeg', text: false },
  { test: /.webm$/, contentType: 'video/webm', text: false },
  { test: /.pdf$/, contentType: 'application/pdf', text: false },
  { test: /.tar$/, contentType: 'application/x-tar', text: false },
  { test: /.zip$/, contentType: 'application/zip', text: false },
  { test: /.eot$/, contentType: 'application/vnd.ms-fontobject', text: false },
  { test: /.otf$/, contentType: 'font/otf', text: false },
  { test: /.ttf$/, contentType: 'font/ttf', text: false },
  { test: /.woff$/, contentType: 'font/woff', text: false },
  { test: /.woff2$/, contentType: 'font/woff2', text: false },
];

export function getDefaultContentTypes() {
  return defaultContentTypes;
}

export function mergeContentTypes(contentTypes: ContentTypeDef[]) {

  const finalContentTypes: ContentTypeDef[] = [];

  if(!Array.isArray(contentTypes)) {
    console.warn('contentTypes not an array, ignoring.');
  } else {

    for (const [index, contentType] of contentTypes.entries()) {
      let invalid = false;

      if(
        typeof contentType.test !== 'function' &&
        !(contentType.test instanceof RegExp)
      ) {
        console.log(`⚠️ Ignoring contentTypes[${index}]: 'test' must be a function or regular expression.`);
        invalid = true;
      }

      if(typeof contentType.contentType !== 'string' || contentType.contentType.indexOf('/') === -1) {
        console.log(`⚠️ Ignoring contentTypes[${index}]: 'type' must be a string representing a MIME type.`);
        invalid = true;
      }

      if('text' in contentType && typeof contentType.text !== 'boolean') {
        console.log(`⚠️ Ignoring contentTypes[${index}]: optional 'text' must be a boolean value.`);
        invalid = true;
      }

      if(!invalid) {
        const contentTypeDef: ContentTypeDef = {
          test: contentType.test,
          contentType: contentType.contentType,
        };
        if(contentType.text != null) {
          contentTypeDef.text = contentType.text;
        }
        finalContentTypes.push(contentTypeDef);
      }
    }
  }

  console.log('✔️ Applying ' + finalContentTypes.length + ' custom content type(s).');

  // NOTE: these come later because these are tested in order.
  // In other words, the earlier ones have higher precedence.
  for (const contentType of defaultContentTypes) {
    finalContentTypes.push(contentType);
  }

  return finalContentTypes;
}

export function testFileContentType(contentTypes: ContentTypeDef[] | null | undefined, assetKey: string): ContentTypeTestResult | null {
  for (const contentType of contentTypes ?? defaultContentTypes) {
    let matched = false;
    if(contentType.test instanceof RegExp) {
      matched = contentType.test.test(assetKey);
    } else {
      // should be a function
      matched = contentType.test(assetKey);
    }
    if(matched) {
      return { contentType: contentType.contentType, text: Boolean(contentType.text ?? false) };
    }
  }
  return null;
}
