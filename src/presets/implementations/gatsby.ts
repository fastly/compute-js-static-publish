import { IPresetBase } from '../preset-base.js';

export class GatsbyPreset implements IPresetBase {
  name = 'Gatsby';
  defaultOptions = {
    'public-dir': './public',
    'static-dir': undefined,
    spa: undefined,
  };
  check() {
    return true;
  }
}
