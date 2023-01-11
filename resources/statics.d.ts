type AssetBase = {
    contentType: string,
    module: any | null,
    isStatic: boolean,
};
type StringAsset = AssetBase & {
    type: 'string',
    content: string,
};
type BinaryAsset = AssetBase & {
    type: 'binary',
    content: Uint8Array,
};
type Asset = StringAsset | BinaryAsset;
import { StaticAssets } from "@fastly/compute-js-static-publish";
export declare const assets: Record<string, Asset>;
export declare const spaFile: string | false;
export declare const notFoundPageFile: string | false;
export declare const autoIndex: string[] | false;
export declare const autoExt: string[] | false;
export declare const staticAssets: StaticAssets;
