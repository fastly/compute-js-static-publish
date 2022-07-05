import { IPresetBase } from '../preset-base.js';

export class VitePreset implements IPresetBase {
  name = 'Vite';
  defaultOptions = {
    'public-dir': './dist',
    'static-dir': undefined,
    spa: undefined,
    name: 'my-vite-app',
    description: 'Compute@Edge static site from Vite',
  };
  check() {
    return true;
  }
}
