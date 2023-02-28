export type ContentTypeDef = {
  test: RegExp | ((path: string) => boolean),
  type: string,
  binary?: boolean,
};

export type ContentTypeTestResult = {
  type: string,
  binary: boolean,
};

declare const defaultContentTypes: ContentTypeDef[];

declare function mergeContentTypes(entries?: ContentTypeDef[]): ContentTypeDef[];
declare function testFileContentType(entries: ContentTypeDef[] | null | undefined, path: string): ContentTypeTestResult | null;
