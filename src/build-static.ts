// This program builds static resources out of the files in the
// public folder to be served. It reads the name of the public
// folder from the static-publish.json file.

// With create-react-app, this would be the ./build directory.

// This also reexports the "spa" value in the static-publish.json
// file so that the C@E handler knows what file to serve up if
// the resource doesn't map to a file.

import * as fs from "fs";
import * as path from "path";
import { CONTENT_TYPES } from "./content-types.js";

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
  getFiles(results, config.publicDir);

  const outputDir = path.resolve();

  const publicDirRoot = path.resolve(config.publicDir);

  console.log(`Public directory '${publicDirRoot}'.`);

  const staticDirs: string[] = config.staticDirs ?? [];
  if (staticDirs.length > 0) {
    console.log(`Using static directories: ${staticDirs.join(', ')}`);
  } else {
    console.log(`No static directories defined.`);
  }
  const staticRoots = staticDirs.map(
    dir => path.resolve(config.publicDir, dir)
  );

  const DEFAULT_EXCLUDE_DIRS = [
    './node_modules'
  ];

  const excludeDirs: string[] = config.excludeDirs ?? DEFAULT_EXCLUDE_DIRS;
  if (excludeDirs.length > 0) {
    console.log(`Using exclude directories: ${excludeDirs.join(', ')}`);
  } else {
    console.log(`No exclude directories defined.`);
  }
  const excludeRoots = excludeDirs.map(
    dir => path.resolve(config.publicDir, dir)
  );

  const DEFAULT_INCLUDE_DIRS = [
    './.well-known'
  ];

  const includeDirs: string[] = config.includeDirs ?? DEFAULT_INCLUDE_DIRS;
  if (includeDirs.length > 0) {
    console.log(`Using include directories: ${includeDirs.join(', ')}`);
  } else {
    console.log(`No include directories defined.`);
  }
  const includeRoots = includeDirs.map(
    dir => path.resolve(config.publicDir, dir)
  );

  const files = results
    .filter(file => {
      // Exclude files that come from C@E app dir
      if(file.startsWith(outputDir)) {
        return false;
      }
      // Include files that come from "included roots" dir
      if(includeRoots.some(root => file.startsWith(root))) {
        return true;
      }
      // Exclude files that are in directories that start with "."
      if(file.indexOf('/.') !== -1) {
        return false;
      }
      // Exclude files that come from "excluded roots" dir
      if(excludeRoots.some(root => file.startsWith(root))) {
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
    const contentDef = CONTENT_TYPES.find(type => {
      if(typeof type.test === 'function') {
        return type.test(file);
      }
      // type is RegExp
      return type.test.test(file);
    });
    const filePath = JSON.stringify(file.slice(publicDirRoot.length));
    const type = JSON.stringify(contentDef?.type);
    const isStatic = staticRoots.some(root => file.startsWith(root));

    if (contentDef != null) {
      console.log(filePath + ': ' + type + (isStatic ? ' [STATIC]' : ''));
    } else {
      console.warn('Warning: Unknown file type ' + filePath + '...');
    }

    let content;
    if (contentDef == null || contentDef.binary) {
      content = 'Buffer.from(file' + index + ', "base64")';
    } else {
      content = 'file' + index;
    }

    fileContents += `  ${filePath}: { contentType: ${type}, content: ${content}, isStatic: ${JSON.stringify(isStatic)} },\n`;
  }

  fileContents += '};\n';

  const spaFile: string | false = config.spa ?? false;
  if(spaFile) {
    console.log(`Application SPA file '${spaFile}'.`);
  } else {
    console.log(`Application is not a SPA.`);
  }

  fileContents += `\nexport const spaFile = ${JSON.stringify(spaFile)};\n`;

  fs.writeFileSync('./src/statics.js', fileContents);

  console.log("🚀 Wrote static file loader for " + files.length + " file(s).");

}
