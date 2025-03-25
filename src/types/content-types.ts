export type ContentTypeTest = (name: string) => boolean;

// Content Type definition
export type ContentTypeDef = {
  // A test on the asset key to perform on this content type.
  test: RegExp | ContentTypeTest,

  // The Content-Type header value to provide for this content type.
  contentType: string,

  // Whether this content type represents a text value encoded in utf-8.
  // If so, conveniences can be provided.
  text?: boolean,

  // Binary formats are usually not candidates for compression, but certain
  // types can benefit from it.
  precompressAsset?: boolean,
};

export type ContentTypeTestResult = {
  contentType: string,
  text: boolean,
  precompressAsset: boolean,
};
