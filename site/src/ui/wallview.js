import { facesOf, faceRect, hasFaces, marksBounds } from '../domain/faces.js';
import { hasOutline, litHoldsLargestFirst, nearestHold } from '../domain/holds.js';
import { roleByCode } from '../domain/roles.js';
import { Viewport, ZOOM_MAX, ZOOM_MIN, zoomMaxFor } from '../domain/viewport.js';
import { h } from './dom.js';

// How the wall is painted. dim: how much of the photo is darkened so lit holds stand out. spotlight: show lit holds at
// full brightness through the dimming. ring: thickness of a lit hold's outline. outlineOthers: a thin outline round
// every other hold too (the editor, so you can see what to tap). tint: how strongly the inside of a lit hold is washed with
// its colour (0 = not at all, 0.16 = the wash the app always had). Viewing a climb has none (`climb`, `climbBright`): to put the
// wash back there, set their `tint` to 0.16.
export const PAINT = {
  climb: { dim: 0.4, spotlight: true, ring: 3.5, outlineOthers: false, tint: 0 },
  climbBright: { dim: 0, spotlight: false, ring: 3.5, outlineOthers: false, tint: 0 },
  editor: { dim: 0.18, spotlight: false, ring: 3.5, outlineOthers: true, tint: 0.16 },
  editorClean: { dim: 0.18, spotlight: false, ring: 3.5, outlineOthers: false, tint: 0.16 },
  thumb: { dim: 0.55, spotlight: true, ring: 1.6, outlineOthers: false, tint: 0.16 },
  thumbPlain: { dim: 0, spotlight: false, ring: 1.6, outlineOthers: false, tint: 0.16 },
  minimap: { dim: 0.25, spotlight: true, ring: 2.2, outlineOthers: false, tint: 0.16 },
};

// How far an outline is pushed out beyond the hold, besides a tenth of the hold's size: a fixed number of pixels of the picture as laid out
// at zoom 1. 1.5 suits a wall shown about 450 pixels wide with holds 30 to 60 pixels across (the AV wall). A long wall (a row of faces) is
// laid out just as wide on the screen but its holds are several times smaller there, so a fixed 1.5 pixels would make every ring far too
// big: its pad is a small share of the picture's width instead.
const OUTLINE_PAD = 1.5;
const LONG_WALL_PAD_SHARE = 0.00045;
export const outlinePad = (wall, width) => (hasFaces(wall) ? LONG_WALL_PAD_SHARE * width : OUTLINE_PAD);

/**
 * The outline of each hold as a drawable path, in the pixels of a w x h picture. A hold's outline is its polygon pushed
 * slightly outwards (so the line sits just outside the hold instead of on its edge), then smoothed so the corners are
 * not sharp. A hold with no outline is a circle. Paths are made once per size and kept.
 */
export class HoldPaths {
  constructor(w, h, pad = OUTLINE_PAD) {
    this.w = w;
    this.h = h;
    this.pad = pad;
    this.paths = new Map();
    this.everyHold = null;
  }

  get(hold) {
    let path = this.paths.get(hold.id);
    if (!path) {
      path = this.#build(hold);
      this.paths.set(hold.id, path);
    }
    return path;
  }

  /** Every hold's outline in one path, so the editor can draw them all with a single stroke. */
  all(holds) {
    if (!this.everyHold) {
      this.everyHold = new Path2D();
      for (const hold of holds) this.everyHold.addPath(this.get(hold));
    }
    return this.everyHold;
  }

  #build(hold) {
    const path = new Path2D();
    const { w, h } = this;
    if (!hasOutline(hold)) {
      path.arc(hold.x * w, hold.y * h, Math.max(hold.r * w * 1.25, w * 0.012), 0, Math.PI * 2);
      return path;
    }
    const xs = hold.outline.map((p) => p[0] * w);
    const ys = hold.outline.map((p) => p[1] * h);
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
    const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
    const grow = 1 + (0.05 * size + this.pad) / (size / 2);
    for (let i = 0; i < xs.length; i++) {
      xs[i] = centerX + (xs[i] - centerX) * grow;
      ys[i] = centerY + (ys[i] - centerY) * grow;
    }
    // Curves that use each corner as a control point and pass through the midpoints between corners.
    const n = xs.length;
    path.moveTo((xs[n - 1] + xs[0]) / 2, (ys[n - 1] + ys[0]) / 2);
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      path.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[next]) / 2, (ys[i] + ys[next]) / 2);
    }
    path.closePath();
    return path;
  }
}

/**
 * Draws the wall in a w x h box with the origin at the top-left. `zoom` only keeps strokes the same thickness on screen
 * while the caller has scaled the canvas up.
 */
export function drawWall(ctx, w, h, image, holds, marks, paint, zoom, paths) {
  if (image) ctx.drawImage(image, 0, 0, w, h);
  else {
    ctx.fillStyle = '#2A2D34';
    ctx.fillRect(0, 0, w, h);
  }
  if (paint.dim > 0) {
    ctx.fillStyle = `rgba(0,0,0,${paint.dim})`;
    ctx.fillRect(0, 0, w, h);
  }
  const px = 1 / zoom;
  ctx.lineJoin = 'round';
  if (paint.outlineOthers) {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.2 * px;
    ctx.stroke(paths.all(holds));
  }
  // A small hold can lie on or inside a bigger one, so the order matters. All the bright patches go down first, then
  // the tints and outlines from the biggest hold to the smallest: nothing painted later can cover a smaller hold.
  const lit = litHoldsLargestFirst(holds, marks, w / h);
  if (paint.spotlight && image) {
    for (const hold of lit) {
      ctx.save();
      ctx.clip(paths.get(hold));
      ctx.drawImage(image, 0, 0, w, h);
      ctx.restore();
    }
  }
  for (const hold of lit) {
    const color = roleByCode.get(marks[hold.id]).color;
    const path = paths.get(hold);
    if (paint.tint > 0) {
      ctx.globalAlpha = paint.tint;
      ctx.fillStyle = color;
      ctx.fill(path);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = paint.ring * px;
    ctx.stroke(path);
  }
}

/**
 * Draws a small, fixed picture of a climb (or of the bare wall) into a canvas, for lists. With `crop` (a part of the wall, as
 * fractions of the picture, with the same shape as the canvas) only that part is shown: a long wall's thumbnail shows where the
 * climb is instead of the whole wall squeezed small.
 */
export function drawThumb(canvas, wall, image, marks, paint = PAINT.thumb, crop = null) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.width / dpr;
  const cssH = canvas.clientHeight || canvas.height / dpr;
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  const ctx = canvas.getContext('2d');
  if (!crop) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawWall(ctx, cssW, cssH, image, wall.holds, marks, paint, 1, new HoldPaths(cssW, cssH, outlinePad(wall, cssW)));
    return;
  }
  // The whole wall is laid out so that the cropped part fills the canvas, and the rest falls outside it.
  const fullW = cssW / (crop.x1 - crop.x0);
  const fullH = cssH / (crop.y1 - crop.y0);
  ctx.setTransform(dpr, 0, 0, dpr, -crop.x0 * fullW * dpr, -crop.y0 * fullH * dpr);
  drawWall(ctx, fullW, fullH, image, wall.holds, marks, paint, 1, new HoldPaths(fullW, fullH, outlinePad(wall, fullW)));
}

const TAP_SLOP = 8; // how far a finger can move and still count as a tap, in pixels
const TAP_MAX_MS = 600;

/**
 * The wall photo with its holds, which can be pinched to zoom and dragged. Tapping a hold calls onTapHold (the editor uses
 * it to light and unlight holds).
 *
 * A one-finger drag on the wall pans it only once it is zoomed in. Until then it is reported to `pager` instead, so a
 * screen holding several of these can swipe between them. `pager` is { onDrag(dx), onEnd(dx, velocity) } or null.
 */
export class WallView {
  constructor({ onTapHold = null, pager = null, interactive = true } = {}) {
    this.onTapHold = onTapHold;
    this.pager = pager;
    this.interactive = interactive;
    this.canvas = h('canvas', { class: 'wall-canvas' });
    this.el = h('div', { class: 'wallview' }, this.canvas);
    this.el.wallView = this; // lets tests and the developer console look inside
    this.wall = null;
    this.image = null;
    this.marks = {};
    this.paint = PAINT.climb;
    this.zoom = 1;
    this.zoomMax = ZOOM_MAX;
    this.offset = { x: 0, y: 0 };
    this.pendingFocus = null; // a part of the wall to zoom in on as soon as the view has a size
    this.autoFocus = null; // the part the view was last asked to show: it is shown again if the view changes size, until you zoom or move it yourself
    this.onView = null; // called after every draw (the minimap listens, to show what part of the wall is on screen)
    this.pointers = new Map();
    this.gesture = null;
    this.frame = 0;
    this.paths = null;
    this.size = { w: 0, h: 0 };
    this.observer = new ResizeObserver(() => this.#resize());
    this.observer.observe(this.el);
    if (interactive) this.#listen();
    else this.el.style.pointerEvents = 'none';
  }

  destroy() {
    this.observer.disconnect();
    cancelAnimationFrame(this.frame);
    this.el.remove();
  }

  setWall(wall, image) {
    this.wall = wall;
    this.image = image;
    this.paths = null;
    this.zoomMax = hasFaces(wall) ? zoomMaxFor(this.aspect) : ZOOM_MAX; // a wall with several faces can be zoomed in further
    this.resetView();
  }

  setMarks(marks) {
    this.marks = marks;
    this.invalidate();
  }

  setPaint(paint) {
    this.paint = paint;
    this.invalidate();
  }

  resetView() {
    this.zoom = 1;
    this.offset = { x: 0, y: 0 };
    this.pendingFocus = null;
    this.autoFocus = null;
    this.invalidate();
  }

  /** Zooms in on a part of the wall (fractions: { x0, y0, x1, y1 }) as far as fits. It happens as soon as the view has a size. */
  focusOn(rect, options = {}) {
    this.pendingFocus = this.autoFocus = { rect, options };
    this.invalidate();
  }

  /** Zooms in on the holds a climb lights (not too far for one hold), or on the first face if it lights none. */
  focusOnMarks(marks) {
    const bounds = this.wall ? marksBounds(this.wall, marks) : null;
    if (bounds) this.focusOn(bounds, { maxZoom: Math.min(this.zoomMax, 7) });
    else if (hasFaces(this.wall)) this.focusFace(0);
    else this.resetView();
  }

  /** Zooms in on one face of a long wall: its whole height, as wide as it fits. */
  focusFace(index) {
    const face = facesOf(this.wall)[index];
    if (face) this.focusOn(faceRect(face), { margin: 0.03, maxZoom: this.zoomMax });
  }

  /** The zoom that showing this part of the wall would take (1 while the view has no size yet). */
  zoomToFit(rect, options = {}) {
    const vp = this.#viewport();
    return vp ? vp.fitRect(rect, { maxZoom: this.zoomMax, ...options }).zoom : 1;
  }

  /** Moves so that this spot of the wall (fractions) is in the middle, zooming in to at least `minZoom` first. */
  goTo(nx, ny, minZoom = 1) {
    const vp = this.#viewport();
    if (!vp) return;
    this.pendingFocus = this.autoFocus = null;
    this.zoom = Math.min(this.zoomMax, Math.max(this.zoom, minZoom));
    this.offset = vp.centerOn(nx, ny, this.zoom);
    this.invalidate();
  }

  /** The part of the wall on screen right now, as fractions of the picture. */
  visibleRect() {
    const vp = this.#viewport();
    return vp ? vp.visibleRect(this.offset, this.zoom) : { x0: 0, y0: 0, x1: 1, y1: 1 };
  }

  get aspect() {
    return this.wall ? this.wall.imageWidth / this.wall.imageHeight : 1;
  }

  /** Asks for a redraw at the next screen refresh. */
  invalidate() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.#draw();
    });
  }

  /** Draws right now, so a change can be shown in the same moment as something else moves (no flicker). */
  renderNow() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.#resize();
    this.#draw();
  }

  #resize() {
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    if (w === this.size.w && h === this.size.h) return;
    this.size = { w, h };
    if (this.autoFocus) this.pendingFocus = this.autoFocus; // the page settled into its final layout, or the phone turned: fit again
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.paths = null;
    this.invalidate();
  }

  #viewport() {
    const { w, h } = this.size;
    return w > 0 && h > 0 && this.wall ? new Viewport(w, h, this.aspect) : null;
  }

  #draw() {
    const vp = this.#viewport();
    if (vp && this.pendingFocus) {
      const { rect, options } = this.pendingFocus;
      this.pendingFocus = null;
      const fit = vp.fitRect(rect, { maxZoom: this.zoomMax, ...options });
      this.zoom = fit.zoom;
      this.offset = fit.offset;
    }
    this.el.dataset.zoom = this.zoom.toFixed(2); // for tests and debugging: how far in this view is
    const ctx = this.canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!vp) return;
    if (!this.paths || this.paths.w !== vp.contentW || this.paths.h !== vp.contentH) this.paths = new HoldPaths(vp.contentW, vp.contentH, outlinePad(this.wall, vp.contentW));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(vp.boxW / 2 + this.offset.x, vp.boxH / 2 + this.offset.y);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-vp.contentW / 2, -vp.contentH / 2);
    drawWall(ctx, vp.contentW, vp.contentH, this.image, this.wall.holds, this.marks, this.paint, this.zoom, this.paths);
    this.onView?.();
  }

  // ---- touch, mouse and pen ----

  #listen() {
    const el = this.canvas;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => this.#down(e));
    el.addEventListener('pointermove', (e) => this.#move(e));
    el.addEventListener('pointerup', (e) => this.#up(e));
    el.addEventListener('pointercancel', (e) => this.#cancel(e));
    el.addEventListener('lostpointercapture', (e) => this.#cancel(e));
    el.addEventListener('wheel', (e) => this.#wheel(e), { passive: false });
    // iPhone Safari has its own two-finger zoom gesture that can fight with ours.
    for (const name of ['gesturestart', 'gesturechange', 'gestureend']) el.addEventListener(name, (e) => e.preventDefault());
  }

  #down(e) {
    try {
      this.canvas.setPointerCapture(e.pointerId); // keep hearing this finger even if it slides off the picture
    } catch {
      /* the browser did not allow it; the gesture still works while the finger stays on the picture */
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.gesture = { kind: 'one', startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, t: performance.now(), moved: false, paging: false, pageDx: 0, samples: [{ t: performance.now(), x: e.clientX }] };
    } else if (this.pointers.size === 2) {
      if (this.gesture?.paging) this.pager?.onEnd(this.gesture.pageDx, 0, true);
      this.gesture = { kind: 'two', ...this.#pair(), moved: true };
    }
  }

  #pair() {
    const [a, b] = [...this.pointers.values()];
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  #move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = this.gesture;
    if (!g) return;
    const vp = this.#viewport();
    if (g.kind === 'two' && this.pointers.size >= 2) {
      const now = this.#pair();
      if (vp && g.dist > 0 && now.dist > 0) {
        const rect = this.canvas.getBoundingClientRect();
        const newZoom = Math.min(this.zoomMax, Math.max(ZOOM_MIN, this.zoom * (now.dist / g.dist)));
        const focus = { x: g.cx - rect.left, y: g.cy - rect.top };
        const zoomed = vp.zoomAround(focus, this.offset, this.zoom, newZoom);
        this.offset = vp.clamp({ x: zoomed.x + (now.cx - g.cx), y: zoomed.y + (now.cy - g.cy) }, newZoom);
        this.zoom = newZoom;
        this.autoFocus = this.pendingFocus = null;
        this.invalidate();
      }
      Object.assign(g, now);
    } else if (g.kind === 'one') {
      const dx = e.clientX - g.lastX;
      const dy = e.clientY - g.lastY;
      const totalX = e.clientX - g.startX;
      const totalY = e.clientY - g.startY;
      if (!g.moved && Math.hypot(totalX, totalY) > TAP_SLOP) {
        g.moved = true;
        g.paging = this.zoom <= 1.001 && Boolean(this.pager) && Math.abs(totalX) > Math.abs(totalY);
      }
      if (g.moved) {
        if (this.zoom > 1.001 && vp) {
          this.offset = vp.clamp({ x: this.offset.x + dx, y: this.offset.y + dy }, this.zoom);
          this.autoFocus = this.pendingFocus = null;
          this.invalidate();
        } else if (g.paging) {
          g.pageDx = totalX;
          g.samples.push({ t: performance.now(), x: e.clientX });
          if (g.samples.length > 6) g.samples.shift();
          this.pager.onDrag(totalX);
        }
      }
      g.lastX = e.clientX;
      g.lastY = e.clientY;
    }
  }

  #up(e) {
    const g = this.gesture;
    const known = this.pointers.has(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!known || !g) return;
    if (g.kind === 'one') {
      if (!g.moved && performance.now() - g.t < TAP_MAX_MS) this.#tap(e);
      else if (g.paging) {
        const first = g.samples[0];
        const last = g.samples[g.samples.length - 1];
        const velocity = last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
        this.pager.onEnd(g.pageDx, velocity, false);
      }
      this.gesture = null;
    } else if (g.kind === 'two') {
      if (this.pointers.size === 1) {
        // One finger is left after a pinch: carry on panning with it, and never count it as a tap.
        const [rest] = [...this.pointers.values()];
        this.gesture = { kind: 'one', startX: rest.x, startY: rest.y, lastX: rest.x, lastY: rest.y, t: 0, moved: true, paging: false, pageDx: 0, samples: [] };
      } else {
        this.gesture = null;
      }
      if (this.zoom < 1.02) this.resetView();
    }
  }

  #cancel(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.gesture?.paging) this.pager.onEnd(this.gesture.pageDx, 0, true);
    if (this.pointers.size === 0) this.gesture = null;
  }

  #tap(e) {
    const vp = this.#viewport();
    if (!vp || !this.onTapHold) return;
    const rect = this.canvas.getBoundingClientRect();
    const spot = vp.toPhoto({ x: e.clientX - rect.left, y: e.clientY - rect.top }, this.offset, this.zoom);
    // Always a fingertip's width to aim with, however far the wall is zoomed out.
    const slack = 18 / this.zoom / vp.contentW;
    const hold = nearestHold(this.wall.holds, spot.x, spot.y, this.aspect, slack);
    if (hold) this.onTapHold(hold);
  }

  #wheel(e) {
    const vp = this.#viewport();
    if (!vp) return;
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const newZoom = Math.min(this.zoomMax, Math.max(ZOOM_MIN, this.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
    const zoomed = vp.zoomAround({ x: e.clientX - rect.left, y: e.clientY - rect.top }, this.offset, this.zoom, newZoom);
    this.offset = vp.clamp(zoomed, newZoom);
    this.zoom = newZoom;
    this.autoFocus = this.pendingFocus = null;
    if (this.zoom < 1.02) this.resetView();
    else this.invalidate();
  }
}
