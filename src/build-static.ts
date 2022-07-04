// This program builds static resources out of the files in the
// public folder to be served. It reads the name of the public
// folder from the static-publish.rc.js file.

// With create-react-app, this would be the ./build directory.

// This also reexports the "spa" value in the static-publish.rc.js
// file so that the C@E handler knows what file to serve up if
// the resource doesn't map to a file.

import * as fs from "fs";
import * as path from "path";
import * as url from "url";
import { ContentTypeDef } from "./content-types.js";

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

export async function buildStaticLoader() {

  console.log("Building loader...");

  let config: any;
  try {
    const staticPublishRcPath = path.resolve('./static-publish.rc.js');
    config = (await import(staticPublishRcPath)).default;
  } catch(ex) {
    console.error("❌ Can't load static-publish.rc.js");
    console.error("Run this from a compute-js-static-publish compute-js directory.");
    console.error("Error: ", String(ex));
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

  // Load defaultContentTypes module
  const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
  const defaultContentTypesJsSrcPath = path.resolve(__dirname, '../resources/default-content-types.cjs');
  const defaultContentTypes = await import(defaultContentTypesJsSrcPath);

  // Load content types
  const finalContentTypes: ContentTypeDef[] = defaultContentTypes.mergeContentTypes(config.contentTypes ?? []);

  // Update the target file too, so webpack can see it.
  const defaultContentTypesJsPath = path.resolve('./default-content-types.cjs');
  fs.copyFileSync(defaultContentTypesJsSrcPath, defaultContentTypesJsPath);

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

  const knownAssets: Record<string, {contentType: string, isStatic:boolean}> = {};

  fileContents += `\nexport const assets = {\n`;

  for (const [index, file] of files.entries()) {
    const contentDef = defaultContentTypes.testFileContentType(finalContentTypes, file);
    const filePath = JSON.stringify(file.slice(publicDirRoot.length));
    const type = JSON.stringify(contentDef?.type);
    const isStatic = staticRoots.some(root => file.startsWith(root));
    knownAssets[filePath] = { contentType: type, isStatic };

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

  let spaFile: string | false = config.spa ?? false;
  if(spaFile) {
    console.log(`Application SPA file '${spaFile}'.`);
    if(!knownAssets[spaFile] || knownAssets[spaFile].contentType !== 'text/html') {
      console.warn(`'${spaFile}' does not exist or is not of type 'text/html'. Ignoring.`);
      spaFile = false;
    }
  } else {
    console.log(`Application is not a SPA.`);
  }

  fileContents += `\nexport const spaFile = ${JSON.stringify(spaFile)};\n`;

  let autoIndex: string | false = config.autoIndex ?? null;
  fileContents += `\nexport const autoIndex = ${JSON.stringify(autoIndex)};\n`;

  fs.writeFileSync('./src/statics.js', fileContents);

  console.log("🚀 Wrote static file loader for " + files.length + " file(s).");

}
