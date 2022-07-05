import { IPresetBase } from '../preset-base.js';

export class GatsbyPreset implements IPresetBase {
  name = 'Gatsby';
  defaultOptions = {
    'public-dir': './public',
    name: 'my-gatsby-app',
    description: 'Compute@Edge static site from Gatsby',
  };
  check() {
    return true;
  }
}
