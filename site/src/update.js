// New versions of the app install themselves. A new version is downloaded in the background and then waits; this decides when it takes over:
// as soon as nothing is half done on screen (no climb being set with unsaved changes, no sheet or question open), so it never changes
// under somebody's fingers, and nobody has to tap anything.

/**
 * Calls `run` as soon as `isQuiet()` is true: straight away if it already is, otherwise by looking again every `every` milliseconds.
 * Returns a function that stops looking.
 */
export function whenQuiet(isQuiet, run, { every = 2000, setTimer = setInterval, clearTimer = clearInterval } = {}) {
  if (isQuiet()) {
    run();
    return () => {};
  }
  const timer = setTimer(() => {
    if (!isQuiet()) return;
    clearTimer(timer);
    run();
  }, every);
  return () => clearTimer(timer);
}
