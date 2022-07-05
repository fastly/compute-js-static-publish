import { IPresetBase } from '../preset-base.js';

export class SvelteKitPreset implements IPresetBase {
  name = 'SvelteKit';
  defaultOptions = {
    'public-dir': './dist',
    'static-dir': undefined,
    spa: undefined,
    name: 'my-sveltekit-app',
    description: 'Compute@Edge static site from SvelteKit',
  };
  check() {
    return true;
  }
}
