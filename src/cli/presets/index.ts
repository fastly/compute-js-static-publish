import { IPresetBase } from './preset-base.js';
import { CreateReactAppPreset, CreateReactAppEjectedPreset } from './implementations/create-react-app.js';
import { VitePreset } from './implementations/vite.js';
import { SvelteKitPreset } from './implementations/sveltekit.js';
import { VuePreset } from './implementations/vue.js';
import { NextJsPreset } from './implementations/next.js';
import { GatsbyPreset } from './implementations/gatsby.js';
import { DocusaurusPreset } from './implementations/docusaurus.js';

export const presets: Record<string, new() => IPresetBase> = {
  'cra': CreateReactAppPreset,
  'create-react-app': CreateReactAppPreset,
  'cra-eject': CreateReactAppEjectedPreset,
  'vite': VitePreset,
  'sveltekit': SvelteKitPreset,
  'vue': VuePreset,
  'next': NextJsPreset,
  'gatsby': GatsbyPreset,
  'docusaurus': DocusaurusPreset,
};
