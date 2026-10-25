// Helpers for the browser tests that act out finger gestures on an element, by sending the same pointer events a real
// touch screen would (pointerdown, pointermove, pointerup), one or two fingers at a time.

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fire(target, type, id, x, y) {
  target.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true }));
}

/** One finger drags from (x0, y0) to (x1, y1) in `steps` moves taking about `ms` milliseconds. */
export async function drag(target, [x0, y0], [x1, y1], { steps = 8, ms = 160, release = true } = {}) {
  fire(target, 'pointerdown', 1, x0, y0);
  for (let i = 1; i <= steps; i++) {
    await wait(ms / steps);
    fire(target, 'pointermove', 1, x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
  }
  if (release) fire(target, 'pointerup', 1, x1, y1);
}

export function tap(target, x, y) {
  fire(target, 'pointerdown', 1, x, y);
  fire(target, 'pointerup', 1, x, y);
}

/** Two fingers start `gap0` apart (side by side, centred on cx, cy) and end `gap1` apart. Growing gap = zoom in. */
export async function pinch(target, [cx, cy], gap0, gap1, { steps = 8, lift = true } = {}) {
  fire(target, 'pointerdown', 1, cx - gap0 / 2, cy);
  fire(target, 'pointerdown', 2, cx + gap0 / 2, cy);
  for (let i = 1; i <= steps; i++) {
    await wait(16);
    const gap = gap0 + ((gap1 - gap0) * i) / steps;
    fire(target, 'pointermove', 1, cx - gap / 2, cy);
    fire(target, 'pointermove', 2, cx + gap / 2, cy);
  }
  if (lift) {
    fire(target, 'pointerup', 2, cx + gap1 / 2, cy);
    fire(target, 'pointerup', 1, cx - gap1 / 2, cy);
  }
}
