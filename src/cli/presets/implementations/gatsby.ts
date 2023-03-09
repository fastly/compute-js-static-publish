import { AppOptions, IPresetBase } from '../preset-base.js';

export class GatsbyPreset implements IPresetBase {
  name = 'Gatsby';
  defaultOptions: Partial<AppOptions> = {
    rootDir: './public',
    name: 'my-gatsby-app',
    description: 'Compute@Edge static site from Gatsby',
  };
  check() {
    return true;
  }
}
