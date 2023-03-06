import * as brotli from './brotli.js';
import * as gzip from './gzip.js';

import { compressionTypes, ContentCompressionTypes } from "../../constants/compression.js";

export type CompressAlg = (src: string, dest: string, text: boolean) => Promise<boolean>;

export type AlgLib = {
  key: string,
  compressTo: CompressAlg,
};

const libs: AlgLib[] = [ brotli, gzip ];

const algs = compressionTypes.reduce<Partial<Record<ContentCompressionTypes, CompressAlg>>>((obj, alg) => {
  const lib = libs.find((lib: AlgLib) => lib.key === alg);
  if (lib != null) {
    obj[alg] = lib.compressTo;
  }
  return obj;
}, {});

export { algs };
