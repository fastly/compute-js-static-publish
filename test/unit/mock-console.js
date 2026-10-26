/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 */

// The CLI reports to the user with console.log(). Capture it for the rest of
// test t, so that the test can check the messages, and so that they are not
// printed. Returns a function that gives the messages logged so far.
export function mockConsoleLog(t) {
  const log = t.mock.method(console, 'log', () => {});
  return () => log.mock.calls.map(call => call.arguments.join(' '));
}

// The server reports problems with console.error(). Capture it for the rest of
// test t. Returns a function that gives the messages logged so far.
export function mockConsoleError(t) {
  const error = t.mock.method(console, 'error', () => {});
  return () => error.mock.calls.map(call => call.arguments.join(' '));
}
