import { AppOptions, IPresetBase } from '../preset-base.js';

export class DocusaurusPreset implements IPresetBase {
  name = 'Docusaurus';
  defaultOptions: Partial<AppOptions> = {
    rootDir: './build',
    name: 'my-docusaurus-app',
    description: 'Fastly Compute static site from docusaurus',
  };
  check() {
    return true;
  }
}
