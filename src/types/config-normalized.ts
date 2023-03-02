import type { ContentAssetInclusionTest, ExcludeDirTest, ModuleAssetInclusionTest } from "./config.js";
import type { ContentTypeDef } from "./content-types.js";

export type ContentAssetInclusionResultNormalized = {
  includeContent: boolean,
  inline: boolean,
  extendedCache: boolean,
};

export type ModuleAssetInclusionResultNormalized = {
  includeModule: boolean,
  useStaticImport: boolean,
};

export type StaticPublisherConfigNormalized = {
  rootDir: string,
  objectStore: string | null,
  excludeDirs: ExcludeDirTest[],
  excludeDotFiles: boolean,
  includeWellKnown: boolean,
  contentAssetInclusionTest: ContentAssetInclusionTest | null;
  moduleAssetInclusionTest: ModuleAssetInclusionTest | null;
  contentTypes: ContentTypeDef[],
  server: PublisherServerConfigNormalized | null,
};

export type PublisherServerConfigNormalized = {
  publicDirPrefix: string,
  spaFile: string | null,
  notFoundPageFile: string | null,
  autoExt: string[],
  autoIndex: string[],
  // modifyResponse: ModifyResponseFunction | null,
};
