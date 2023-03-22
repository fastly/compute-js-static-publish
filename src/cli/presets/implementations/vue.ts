import { AppOptions, IPresetBase } from '../preset-base.js';

export class VuePreset implements IPresetBase {
  name = 'Vue';
  defaultOptions: Partial<AppOptions> = {
    rootDir: './dist',
    name: 'my-vue-app',
    description: 'Compute@Edge static site from Vue (create-vue)',
  };
  check(packageJson: any) {
    if(packageJson == null) {
      console.error("❌ Can't read/parse package.json");
      console.error("Run this from a Vue project directory created by create-vue.");
      return false;
    }
    if(packageJson?.devDependencies?.['vite'] == null) {
      console.error("❌ Can't find vite in dependencies");
      console.error("Run this from a Vue project directory created by create-vue.");
      console.log("If this is a project created with the Vue CLI, migrate it to use Vite first. Refer to the create-vue documentation at https://www.npmjs.com/package/create-vue (not authored or maintained by Fastly) for details on this process.");
      return false;
    }
    return true;
  }
}
