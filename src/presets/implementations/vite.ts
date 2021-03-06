import { IPresetBase } from '../preset-base.js';

export class VitePreset implements IPresetBase {
  name = 'Vite';
  defaultOptions = {
    'public-dir': './dist',
    name: 'my-vite-app',
    description: 'Compute@Edge static site from Vite',
  };
  check() {
    return true;
  }
}
