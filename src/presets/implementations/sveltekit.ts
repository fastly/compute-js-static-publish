import { IPresetBase } from '../preset-base.js';

export class SvelteKitPreset implements IPresetBase {
  name = 'SvelteKit';
  defaultOptions = {
    'public-dir': './dist',
    'static-dir': undefined,
    spa: undefined,
  };
  check() {
    return true;
  }
}
