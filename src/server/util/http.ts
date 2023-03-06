export function buildHeadersSubset(responseHeaders: Record<string, string>, keys: Readonly<string[]>) {
  const resultHeaders: Record<string, string> = {};
  for (const value of keys) {
    if (value in responseHeaders) {
      resultHeaders[value] = responseHeaders[value];
    }
  }
  return resultHeaders;
}
