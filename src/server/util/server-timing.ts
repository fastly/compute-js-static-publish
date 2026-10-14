/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

type ServerTimingEntry = {
  name: string,
  dur: number,
  desc?: string,
};

// Collects durations for one request and formats them as a Server-Timing
// header value (https://www.w3.org/TR/server-timing/).
export class ServerTiming {
  private entries: ServerTimingEntry[] = [];

  add(name: string, dur: number, desc?: string) {
    this.entries.push({ name, dur, desc });
  }

  async measure<T>(name: string, fn: () => Promise<T>, desc?: string): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      this.add(name, performance.now() - start, desc);
    }
  }

  toHeaderValue(): string {
    return this.entries
      .map(({ name, dur, desc }) => {
        let value = `${name};dur=${dur.toFixed(1)}`;
        if (desc != null) {
          value += `;desc=${JSON.stringify(desc)}`;
        }
        return value;
      })
      .join(', ');
  }
}
