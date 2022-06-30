// This program builds static resources out of the files in the
// public folder to be served. It reads the name of the public
// folder from the static-publish.json file.

// With create-react-app, this would be the ./build directory.

// This also reexports the "spa" value in the static-publish.json
// file so that the C@E handler knows what file to serve up if
// the resource doesn't map to a file.

import * as fs from "fs";
import * as path from "path";

const contentTypes = [
  // Text formats
  { test: /.txt$/, type: 'text/plain', binary: false },
  { test: /.htm(l)?$/, type: 'text/html', binary: false },
  { test: /.xml$/, type: 'application/xml', binary: false },
  { test: /.json$/, type: 'application/json', binary: false },
  { test: /.map$/, type: 'application/json', binary: false },
  { test: /.js$/, type: 'application/javascript', binary: false },
  { test: /.css$/, type: 'text/css', binary: false },
  { test: /.svg$/, type: 'image/svg+xml', binary: false },

  // Binary formats
  { test: /.bmp$/, type: 'image/bmp', binary: true },
  { test: /.png$/, type: 'image/png', binary: true },
  { test: /.gif$/, type: 'image/gif', binary: true },
  { test: /.jp(e)?g$/, type: 'image/jpeg', binary: true },
  { test: /.ico$/, type: 'image/vnd.microsoft.icon', binary: true },
  { test: /.tif(f)?$/, type: 'image/png', binary: true },
  { test: /.aac$/, type: 'audio/aac', binary: true },
  { test: /.mp3$/, type: 'audio/mpeg', binary: true },
  { test: /.avi$/, type: 'video/x-msvideo', binary: true },
  { test: /.mp4$/, type: 'video/mp4', binary: true },
  { test: /.mpeg$/, type: 'video/mpeg', binary: true },
  { test: /.webm$/, type: 'video/webm', binary: true },
  { test: /.pdf$/, type: 'application/pdf', binary: true },
  { test: /.tar$/, type: 'application/x-tar', binary: true },
  { test: /.zip$/, type: 'application/zip', binary: true },
  { test: /.eot$/, type: 'application/vnd.ms-fontobject', binary: true },
  { test: /.otf$/, type: 'font/otf', binary: true },
  { test: /.ttf$/, type: 'font/ttf', binary: true },
];

function getFiles(results: string[], dir: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const name = path.resolve(dir, entry.name);
    if (entry.isDirectory()) {
      getFiles(results, name);
    } else {
      results.push(name);
    }
  }
}

export function buildStaticLoader() {

  console.log("Building loader...");

  let configFileText;
  try {
    configFileText = fs.readFileSync("./static-publish.json", "utf-8");
  } catch {
    console.error("❌ Can't read static-publish.json");
    console.error("Run this from a compute-js-static-publish compute-js directory.");
    process.exit(1);
  }

  let config: any;
  try {
    config = JSON.parse(configFileText);
  } catch {
    console.error("❌ Can't parse static-publish.json");
    console.error("Run this from a compute-js-static-publish compute-js directory.");
    process.exit(1);
  }

  const results: string[] = [];
  getFiles(results, config.buildDir);

  const outputDir = path.resolve();

  const root = path.resolve(config.buildDir);

  // Exclude dirs are relative to the build directory

  const excludeDirs = [
    './node_modules',
    './.idea',
  ];

  const excludeDirsResolved = excludeDirs.map(
    dir => path.resolve(config.buildDir, dir)
  );

  const staticRoot = config.staticDir != null ? path.resolve(config.staticDir) : null;
  console.log(`Build directory '${root}'.`);
  if (staticRoot != null) {
    console.log(`Using static root directory '${staticRoot}'.`);
  } else {
    console.log(`No static root defined.`);
  }

  const files = results
    .filter(file => {
      if(file.startsWith(outputDir)) {
        return false;
      }
      if(excludeDirsResolved.some(dir => file.startsWith(dir))) {
        return false;
      }
      return true;
    });

  let fileContents = '';

  for (const [index, file] of files.entries()) {
    const relativeFilePath = path.relative('./src', file);
    fileContents += `import file${index} from "${relativeFilePath}";\n`;
  }

  fileContents += `\nexport const assets = {\n`;

  for (const [index, file] of files.entries()) {
    const contentDef = contentTypes.find(type => type.test.test(file));
    const filePath = JSON.stringify(file.slice(root.length));
    const type = JSON.stringify(contentDef?.type);
    const isStatic = JSON.stringify(staticRoot ? file.startsWith(staticRoot) : false);

    if (contentDef != null) {
      console.log(filePath + ': ' + type + (isStatic === 'true' ? ' [STATIC]' : ''));
    } else {
      console.warn('Warning: Unknown file type ' + filePath + '...');
    }

    let content;
    if (contentDef == null || contentDef.binary) {
      content = 'Buffer.from(file' + index + ', "base64")';
    } else {
      content = 'file' + index;
    }

    fileContents += `  ${filePath}: { contentType: ${type}, content: ${content}, isStatic: ${isStatic} },\n`;
  }

  fileContents += '};\n';

  const isSpa = config.spa ?? false;
  console.log(`Application ${isSpa ? 'IS' : 'IS NOT'} a SPA.`);

  fileContents += `\nexport const isSpa = ${isSpa};\n`;

  fs.writeFileSync('./src/statics.js', fileContents);

  console.log("🚀 Wrote static file loader for " + files.length + " file(s).");

}
