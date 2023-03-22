import { AppOptions, IPresetBase } from '../preset-base.js';

export class AstroPreset implements IPresetBase {
  name = 'Astro';
  defaultOptions: Partial<AppOptions> = {
    rootDir: './dist',
    name: 'my-astro-app',
    description: 'Compute@Edge static site from Astro',
  };
  check(packageJson: any) {
    if(packageJson == null) {
      console.error("❌ Can't read/parse package.json");
      console.error("Run this from a Astro project directory.");
      return false;
    }
    if(packageJson?.dependencies?.['astro'] == null) {
      console.error("❌ Can't find astro in dependencies");
      console.error("Run this from a Astro project directory.");
      return false;
    }
    return true;
  }
}
