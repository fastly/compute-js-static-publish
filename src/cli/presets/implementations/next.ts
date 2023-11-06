import { AppOptions, IPresetBase } from '../preset-base.js';

export class NextJsPreset implements IPresetBase {
  name = 'Next.js';
  defaultOptions: Partial<AppOptions> = {
    rootDir: './out',
    name: 'my-next-app',
    description: 'Fastly Compute static site from Next.js',
  };
  check() {
    return true;
  }
}
