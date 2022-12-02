type TestFn = (name: string) => boolean;

export type ContentTypeDef = {
  test: RegExp | TestFn,
  type: string,
  binary?: boolean,
};

export type ContentTypeMatch = {
  type: string,
  binary: boolean,
};

export type DefaultContentTypesModule = {
  mergeContentTypes: (contentTypes: ContentTypeDef[]) => ContentTypeDef[],
  testFileContentType: (contentTypes: ContentTypeDef[], file: string) => ContentTypeMatch,
};

export type Asset = {
  contentType: string,
  content: ArrayBuffer | string,
  module: unknown | null,
  isStatic: boolean,
};

export type AssetsMap = {
  [filePath: string]: Asset,
};
