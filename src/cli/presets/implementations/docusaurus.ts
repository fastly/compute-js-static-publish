import { AppOptions, IPresetBase } from '../preset-base.js';

export class DocusaurusPreset implements IPresetBase {
  name = 'Docusaurus';
  defaultOptions: Partial<AppOptions> = {
    rootDir: './build',
    name: 'my-docusaurus-app',
    description: 'Compute@Edge static site from docusaurus',
  };
  check() {
    return true;
  }
}
