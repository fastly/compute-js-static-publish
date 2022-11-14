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
import { ContentTypeDef, DefaultContentTypesModule } from "./content-types.js";
import commandLineArgs from "command-line-args";

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

export async function buildStaticLoader(commandLineValues: commandLineArgs.CommandLineOptions) {

  const { 'suppress-framework-warnings': suppressFrameworkWarnings } = commandLineValues;
  const displayFrameworkWarnings = !suppressFrameworkWarnings;

  console.log("🚀 Building loader...");

  let config: any;
  try {
    const staticPublishRcPath = path.resolve('./static-publish.rc.js');
    config = (await import(staticPublishRcPath)).default;
  } catch(ex) {
    console.error("❌ Can't load static-publish.rc.js");
    console.error("Run this from a compute-js-static-publish compute-js directory.");
    console.error("Error: ", String(ex));
    process.exitCode = 1;
    return;
  }

  const results: string[] = [];
  getFiles(results, config.publicDir);

  const outputDir = path.resolve();

  const publicDirRoot = path.resolve(config.publicDir);

  console.log(`✔️ Public directory '${publicDirRoot}'.`);

  const staticDirs: string[] = config.staticDirs ?? [];
  if (staticDirs.length > 0) {
    console.log(`✔️ Using static directories: ${staticDirs.join(', ')}`);
  } else {
    if (displayFrameworkWarnings) {
      console.log(`✔️ No static directories defined.`);
    }
  }
  const staticRoots = staticDirs.map(
    dir => path.resolve(config.publicDir, dir)
  );

  const DEFAULT_EXCLUDE_DIRS = [
    './node_modules'
  ];

  const excludeDirs: string[] = config.excludeDirs ?? DEFAULT_EXCLUDE_DIRS;
  if (excludeDirs.length > 0) {
    console.log(`✔️ Using exclude directories: ${excludeDirs.join(', ')}`);
  } else {
    if (displayFrameworkWarnings) {
      console.log(`✔️ No exclude directories defined.`);
    }
  }
  const excludeRoots = excludeDirs.map(
    dir => path.resolve(config.publicDir, dir)
  );

  // Load defaultContentTypes module
  const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
  const defaultContentTypesJsSrcPath = path.resolve(__dirname, '../resources/default-content-types.cjs');
  const defaultContentTypes: DefaultContentTypesModule = await import(defaultContentTypesJsSrcPath);

  // Load content types
  const finalContentTypes: ContentTypeDef[] = defaultContentTypes.mergeContentTypes(config.contentTypes ?? []);

  const DEFAULT_INCLUDE_DIRS = [
    './.well-known'
  ];

  const includeDirs: string[] = config.includeDirs ?? DEFAULT_INCLUDE_DIRS;
  if (includeDirs.length > 0) {
    console.log(`✔️ Using include directories: ${includeDirs.join(', ')}`);
  } else {
    if (displayFrameworkWarnings) {
      console.log(`✔️ No include directories defined.`);
    }
  }
  const includeRoots = includeDirs.map(
    dir => path.resolve(config.publicDir, dir)
  );

  const excludeTest: ((path: string) => boolean) | undefined = config.excludeTest;

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
    })
    .filter(file => {
      return excludeTest == null || !excludeTest(file);
    });

  const moduleTest: ((path: string) => boolean) | undefined = config.moduleTest;

  const knownAssets: Record<string, {contentType: string, isStatic: boolean, loadModule: boolean}> = {};

  let fileContents = 'import { Buffer } from "buffer";\n';

  for (const [index, file] of files.entries()) {
    const relativeFilePath = path.relative('./src', file);
    const contentDef = defaultContentTypes.testFileContentType(finalContentTypes, file);
    const filePath = file.slice(publicDirRoot.length);
    const type = contentDef?.type;
    const isStatic = staticRoots.some(root => file.startsWith(root));

    let query;
    if (contentDef == null || contentDef.binary) {
      query = '?staticBinary';
    } else {
      query = '?staticText';
    }
    fileContents += `import file${index} from "${relativeFilePath}${query}";\n`;
    let loadModule = false;
    if (moduleTest != null && moduleTest(filePath)) {
      loadModule = true;
      fileContents += `import * as fileModule${index} from "${relativeFilePath}";\n`;
    }
    knownAssets[filePath] = { contentType: type, isStatic, loadModule, };
  }

  fileContents += `\nexport const assets = {\n`;

  for (const [index, file] of files.entries()) {
    const contentDef = defaultContentTypes.testFileContentType(finalContentTypes, file);
    const filePath = file.slice(publicDirRoot.length);
    const { contentType: type, isStatic, loadModule } = knownAssets[filePath];

    if (contentDef != null) {
      console.log('✔️ ' + filePath + ': ' + JSON.stringify(type) + (isStatic ? ' [STATIC]' : ''));
    } else {
      if (displayFrameworkWarnings) {
        console.log('⚠️ Notice: Unknown file type ' + filePath + '. Treating as binary file.');
      }
    }

    let content;
    if (contentDef == null || contentDef.binary) {
      content = 'Buffer.from(file' + index + ', "base64")';
    } else {
      content = 'file' + index;
    }

    let module;
    if (loadModule) {
      module = 'fileModule' + index;
    } else {
      module = 'null';
    }

    fileContents += `  ${JSON.stringify(filePath)}: { contentType: ${JSON.stringify(type)}, content: ${content}, module: ${module}, isStatic: ${JSON.stringify(isStatic)} },\n`;
  }

  fileContents += '};\n';

  let spaFile: string | false = config.spa ?? false;
  if(spaFile) {
    console.log(`✔️ Application SPA file '${spaFile}'.`);
    if(!knownAssets[spaFile] || knownAssets[spaFile].contentType !== 'text/html') {
      if (displayFrameworkWarnings) {
        console.log(`⚠️ Notice: '${spaFile}' does not exist or is not of type 'text/html'. Ignoring.`);
      }
      spaFile = false;
    }
  } else {
    if (displayFrameworkWarnings) {
      console.log(`✔️ Application is not a SPA.`);
    }
  }

  fileContents += `\nexport const spaFile = ${JSON.stringify(spaFile)};\n`;

  let notFoundPageFile: string | false = config.notFoundPage ?? false;
  if(notFoundPageFile) {
    console.log(`✔️ Application 'not found (404)' file '${notFoundPageFile}'.`);
    if(!knownAssets[notFoundPageFile] || knownAssets[notFoundPageFile].contentType !== 'text/html') {
      if (displayFrameworkWarnings) {
        console.log(`⚠️ Notice: '${notFoundPageFile}' does not exist or is not of type 'text/html'. Ignoring.`);
      }
      notFoundPageFile = false;
    }
  } else {
    if (displayFrameworkWarnings) {
      console.log(`✔️ Application specifies no 'not found (404)' page.`);
    }
  }

  fileContents += `\nexport const notFoundPageFile = ${JSON.stringify(notFoundPageFile)};\n`;

  let autoIndex: string | false = config.autoIndex ?? null;
  fileContents += `\nexport const autoIndex = ${JSON.stringify(autoIndex)};\n`;

  let autoExt: string | false = config.autoExt ?? null;
  fileContents += `\nexport const autoExt = ${JSON.stringify(autoExt)};\n`;

  fs.writeFileSync('./src/statics.js', fileContents);

  console.log("✅  Wrote static file loader for " + files.length + " file(s).");

}
