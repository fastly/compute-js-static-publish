import type { ContentAssetInclusionTest, ExcludeDirTest, ModuleAssetInclusionTest } from "./config.js";
import type { ContentTypeDef } from "./content-types.js";
import type { ContentCompressionTypes } from "../constants/compression.js";

export type ContentAssetInclusionResultNormalized = {
  includeContent: boolean,
  inline: boolean,
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
  contentCompression: ContentCompressionTypes[],
  moduleAssetInclusionTest: ModuleAssetInclusionTest | null;
  contentTypes: ContentTypeDef[],
  server: PublisherServerConfigNormalized | null,
};

export type PublisherServerConfigNormalized = {
  publicDirPrefix: string,
  staticItems: string[],
  compression: ContentCompressionTypes[],
  spaFile: string | null,
  notFoundPageFile: string | null,
  autoExt: string[],
  autoIndex: string[],
  // modifyResponse: ModifyResponseFunction | null,
};
