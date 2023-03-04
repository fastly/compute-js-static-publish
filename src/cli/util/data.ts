export type NormalizeAction<T> = (value: any, errors: string[]) => T | null;

export function buildNormalizeFunctionForObject<TObject>(action: NormalizeAction<TObject>) {

  return (obj: any, errCtx: string[] = []): TObject | null => {

    if (obj == null) {
      errCtx.push('obj cannot be null.');
      return null;
    }

    const errors: string[] = [];

    const normalizedObj = action(obj, errors);

    for (const error of errors) {
      errCtx.push(error);
    }

    return normalizedObj;

  };

}

export function buildNormalizeFunctionForArray<TEntry>(action: NormalizeAction<TEntry>) {

  return (obj: any, errCtx: string[] = []): TEntry[] | null => {

    if (!Array.isArray(obj)) {
      errCtx.push('obj must be array.');
      return null;
    }

    const errors: string[] = [];

    let normalizedEntries: TEntry[] | null = [];
    for (const [index, entry] of obj.entries()) {
      const innerErrors: string[] = [];
      const normalizedEntry = action(entry, innerErrors);
      if (normalizedEntry != null) {
        normalizedEntries.push(normalizedEntry);
      } else {
        errors.push(`Item [${index + 1}]:`);
        errors.push(...innerErrors);
      }
    }
    if (errors.length > 0) {
      normalizedEntries = null;
    }

    for (const error of errors) {
      errCtx.push(error);
    }

    return normalizedEntries;

  };

}

export function isStringAndNotEmpty(str: unknown): str is string {
  return typeof str === 'string' && str !== '';
}

export function isSpecified(obj:any, key: string) {
  return key in obj;
}

export function applyDefaults<T extends Record<string, unknown>>(data: Partial<T> | null, defaults: T) {

  // Remove undefined values
  const temp = Object.assign({}, data);
  for (const [key, value] of Object.entries(temp)) {
    if (value === undefined) {
      delete temp[key];
    }
  }

  return Object.assign({}, defaults, temp);

}
