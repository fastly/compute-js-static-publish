import { IPresetBase } from '../preset-base.js';

export class NextJsPreset implements IPresetBase {
  name = 'Next.js';
  defaultOptions = {
    'public-dir': './out',
    'static-dir': undefined,
    spa: undefined,
  };
  check() {
    return true;
  }
}
