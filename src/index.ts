#!/usr/bin/env node

import commandLineArgs, { OptionDefinition } from "command-line-args";

import { initApp } from "./init-app.js";
import { buildStaticLoader } from "./build-static.js";

const optionDefinitions: OptionDefinition[] = [
  { name: 'build-static', type: Boolean },
  { name: 'output', alias: 'o', type: String, defaultValue: './compute-js', },
  { name: 'public-dir', type: String, },
  { name: 'static-dir', type: String, },
  { name: 'spa', type: Boolean, defaultValue: false, },
  { name: 'cra-eject', type: Boolean, defaultValue: false },
  { name: 'name', type: String, },
  { name: 'author', type: String, },
  { name: 'description', type: String, },
];

const commandLineValues = commandLineArgs(optionDefinitions);

console.log("Fastly Compute@Edge JavaScript Static Publisher");

if (commandLineValues['build-static']) {
  buildStaticLoader();
  process.exit();
}

initApp(commandLineValues);
