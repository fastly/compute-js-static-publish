import { IPresetBase } from '../preset-base.js';

export class DocusaurusPreset implements IPresetBase {
  name = 'Docusaurus';
  defaultOptions = {
    'public-dir': './build',
    name: 'my-docusaurus-app',
    description: 'Compute@Edge static site from docusaurus',
  };
  check() {
    return true;
  }
}
