import { AppOptions, IPresetBase } from '../preset-base.js';

export class CreateReactAppPreset implements IPresetBase {
  name = 'Create React App';
  defaultOptions: Partial<AppOptions> = {
    rootDir: './build',
    staticDirs: [ '[public-dir]/static' ],
    name: 'my-create-react-app',
    description: 'Compute@Edge static site from create-react-app',
  };

  check(packageJson: any): boolean {
    if(packageJson == null) {
      console.error("❌ Can't read/parse package.json");
      console.error("Run this from a create-react-app project directory.");
      return false;
    }
    if(packageJson?.dependencies?.['react-scripts'] == null) {
      console.error("❌ Can't find react-scripts in dependencies");
      console.error("Run this from a create-react-app project directory.");
      console.log("If this is a project created with create-react-app and has since been ejected, specify preset cra-eject to skip this check.");
      return false;
    }
    return true;
  }

}

export class CreateReactAppEjectedPreset extends CreateReactAppPreset {
  name = 'Create React App (Ejected)';
  check() {
    return true;
  }
}
