import { AppOptions, IPresetBase } from '../preset-base.js';

export class SvelteKitPreset implements IPresetBase {
  name = 'SvelteKit';
  defaultOptions: Partial<AppOptions> = {
    rootDir: './dist',
    name: 'my-sveltekit-app',
    description: 'Fastly Compute static site from SvelteKit',
  };
  check() {
    return true;
  }
}
