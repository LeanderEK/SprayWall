// A very small test runner that runs in the browser (there is no Node here). Open /tests/ to run everything.

const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

export class AssertionFailed extends Error {}

const show = (value) => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const assert = {
  ok(condition, message = 'expected something true') {
    if (!condition) throw new AssertionFailed(message);
  },
  eq(actual, expected, message = '') {
    if (show(actual) !== show(expected)) throw new AssertionFailed(`${message} expected ${show(expected)} but got ${show(actual)}`.trim());
  },
  near(actual, expected, epsilon = 1e-5, message = '') {
    if (!(Math.abs(actual - expected) <= epsilon)) throw new AssertionFailed(`${message} expected ${expected} (+/- ${epsilon}) but got ${actual}`.trim());
  },
  async rejects(promiseOrFn, messagePart) {
    try {
      await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn);
    } catch (error) {
      if (messagePart && !String(error.message).includes(messagePart)) {
        throw new AssertionFailed(`expected an error containing "${messagePart}" but got "${error.message}"`);
      }
      return;
    }
    throw new AssertionFailed('expected an error but there was none');
  },
  throws(fn, messagePart) {
    try {
      fn();
    } catch (error) {
      if (messagePart && !String(error.message).includes(messagePart)) {
        throw new AssertionFailed(`expected an error containing "${messagePart}" but got "${error.message}"`);
      }
      return;
    }
    throw new AssertionFailed('expected an error but there was none');
  },
};

export async function runAll() {
  const results = { total: tests.length, passed: 0, failed: 0, failures: [] };
  const list = document.getElementById('results');
  for (const { name, fn } of tests) {
    const row = document.createElement('div');
    try {
      await fn();
      results.passed++;
      row.textContent = `PASS  ${name}`;
      row.style.color = '#2bd84b';
    } catch (error) {
      results.failed++;
      results.failures.push({ name, error: String(error && error.message ? error.message : error) });
      row.textContent = `FAIL  ${name}: ${error && error.message ? error.message : error}`;
      row.style.color = '#ff6b6b';
    }
    list.append(row);
  }
  document.getElementById('summary').textContent = `${results.passed} of ${results.total} passed${results.failed ? `, ${results.failed} FAILED` : ''}`;
  window.__results = results;
  return results;
}
