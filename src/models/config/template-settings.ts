/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// The settings that each template reads: build.<template> (read by the build of
// the app) and templateOptions.<template> (read by the code of the app at
// runtime). A setting that no template declares gives a warning, not an error,
// so that an older version of this package can read a newer file.
export const TEMPLATE_SETTINGS: Record<string, { build: string[], templateOptions: string[] }> = {
  hono: {
    build: [ 'extensionsDir' ],
    templateOptions: [ 'bindings', 'extensions' ],
  },
};

export type TemplateSettingsCheck = {
  errors: string[],
  warnings: string[],
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null && !Array.isArray(value);

// Checks the build and templateOptions fields of static-publish.rc.js or of
// static-publish.project.js.
export function checkTemplateSettings(build: unknown, templateOptions: unknown): TemplateSettingsCheck {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const [ field, value ] of [ [ 'build', build ], [ 'templateOptions', templateOptions ] ] as const) {
    if (value === undefined) {
      continue;
    }
    if (!isPlainObject(value)) {
      errors.push(`${field} must be an object.`);
      continue;
    }
    for (const [ templateName, settings ] of Object.entries(value)) {
      const declared = TEMPLATE_SETTINGS[templateName]?.[field];
      if (declared == null) {
        warnings.push(`${field}.${templateName}: no template '${templateName}' has these settings. They are ignored.`);
        continue;
      }
      if (!isPlainObject(settings)) {
        errors.push(`${field}.${templateName} must be an object.`);
        continue;
      }
      for (const key of Object.keys(settings)) {
        if (!declared.includes(key)) {
          warnings.push(`${field}.${templateName}.${key} is not a setting of the template '${templateName}'. It is ignored.`);
        }
      }
    }
  }

  // The settings of the hono template.
  if (isPlainObject(build) && isPlainObject(build.hono) && build.hono.extensionsDir !== undefined) {
    const extensionsDir = build.hono.extensionsDir;
    if (typeof extensionsDir !== 'string' || !/^\.\.?\//.test(extensionsDir)) {
      errors.push(`build.hono.extensionsDir must be a relative path that starts with './' or '../'.`);
    }
  }
  if (isPlainObject(templateOptions) && isPlainObject(templateOptions.hono)) {
    const hono = templateOptions.hono;
    if (hono.bindings !== undefined) {
      if (!isPlainObject(hono.bindings)) {
        errors.push('templateOptions.hono.bindings must be an object.');
      } else {
        for (const [ name, resource ] of Object.entries(hono.bindings)) {
          if (typeof resource !== 'string' || resource === '') {
            errors.push(`templateOptions.hono.bindings.${name} must be a non-empty string, for example 'ConfigStore:site_config'.`);
          }
        }
      }
    }
    if (hono.extensions !== undefined && !isPlainObject(hono.extensions)) {
      errors.push('templateOptions.hono.extensions must be an object, with the options of each module by module name.');
    }
  }

  return { errors, warnings };
}
