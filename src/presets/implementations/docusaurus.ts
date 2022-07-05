import { IPresetBase } from '../preset-base.js';

export class DocusaurusPreset implements IPresetBase {
  name = 'Docusaurus';
  defaultOptions = {
    'public-dir': './build',
    'static-dir': undefined,
    spa: undefined,
  };
  check() {
    return true;
  }
}
