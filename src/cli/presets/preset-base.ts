export type AppOptions = {
  rootDir: string | undefined,
  publicDir: string | undefined,
  staticDirs: string[],
  staticContentRootDir: string | undefined,
  spa: string | undefined,
  notFoundPage: string | undefined,
  autoIndex: string[],
  autoExt: string[],
  name: string | undefined,
  author: string | undefined,
  description: string | undefined,
  serviceId: string | undefined,
  kvStoreName: string | undefined,
};

export interface IPresetBase {
  name: string;
  defaultOptions: Partial<AppOptions>;
  check(packageJson: any | null, options: AppOptions): boolean;
}
