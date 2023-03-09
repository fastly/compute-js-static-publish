import { AppOptions, IPresetBase } from '../preset-base.js';

export class VitePreset implements IPresetBase {
  name = 'Vite';
  defaultOptions: Partial<AppOptions> = {
    rootDir: './dist',
    name: 'my-vite-app',
    description: 'Compute@Edge static site from Vite',
  };
  check() {
    return true;
  }
}
