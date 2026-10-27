/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

export const PROGRESS_INTERVAL = 1000;

// Logs the progress of a loop over many items. With verbose, it logs a line
// for each call. Else, it logs one line each time the count passes another
// PROGRESS_INTERVAL items, so that a large site does not make a large log.
export class ProgressLog {
  private done = 0;
  private nextReport = PROGRESS_INTERVAL;

  constructor(
    private readonly label: string,
    private readonly verbose: boolean,
    private readonly total?: number,
  ) {}

  // Records count items. The message is made only if it is logged.
  add(count: number, message: () => string) {
    this.done += count;
    if (this.verbose) {
      console.log(message());
      return;
    }
    if (this.done < this.nextReport || (this.total != null && this.done >= this.total)) {
      return;
    }
    console.log(`  | ${this.label}: ${this.done}${this.total != null ? ` of ${this.total}` : ''}`);
    while (this.nextReport <= this.done) {
      this.nextReport += PROGRESS_INTERVAL;
    }
  }
}
