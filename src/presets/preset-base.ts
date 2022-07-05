export type AppOptions = {
  'public-dir': string | undefined,
  'static-dir': string | undefined,
  spa: string | null | undefined,
  'not-found-page': string | null | undefined,
  'auto-index': string[] | null | undefined,
  'auto-ext': string[] | null | undefined,
  name: string,
  author: string,
  description: string,
  'service-id': string | undefined,
};

export interface IPresetBase {
  name: string;
  defaultOptions: Partial<AppOptions>;
  check(packageJson: any | null, options: AppOptions): boolean;
}
