// Content Type test

import {
  ContentTypeDef,
  ContentTypeTestResult,
} from '@fastly/compute-js-static-publish';

declare const defaultContentTypes: ContentTypeDef[];
declare function mergeContentTypes(entries?: ContentTypeDef[]): ContentTypeDef[];
declare function testFileContentType(entries: ContentTypeDef[] | null | undefined, assetKey: string): ContentTypeTestResult | null;
