import { faceIndexAt, faceLabel, facesOf, faceRect } from '../domain/faces.js';
import { h, iconButton } from './dom.js';
import { PAINT, drawThumb } from './wallview.js';

const MINIMAP_MAX_HEIGHT = 72;
const CLOSE_ENOUGH = 2; // a jump on the minimap keeps the zoom you are at if it is at least this far in

/**
 * The strip above a long wall (one whose pack lists faces): a small map of the whole wall with a frame showing the part on
 * screen, one chip for each face, and, in the viewer, buttons for the previous and next climb (a drag on a zoomed-in wall
 * moves about on it, so swiping cannot also change the climb). Tap or drag on the map to go there; tap a chip to go to that face.
 * A wall without faces never gets one.
 */
export class FaceBar {
  constructor({ wall, picture, view, onPrev = null, onNext = null }) {
    this.wall = wall;
    this.picture = picture;
    this.view = view;
    this.faces = facesOf(wall);
    this.marks = {};
    this.current = -1;
    this.aspect = wall.imageWidth / wall.imageHeight;

    this.canvas = h('canvas', { class: 'minimap-canvas' });
    this.frame = h('div', { class: 'minimap-view' });
    const dividers = this.faces.slice(1).map((face) => h('div', { class: 'minimap-divider', style: { left: `${face.x0 * 100}%` } }));
    this.map = h('div', { class: 'minimap', role: 'img', 'aria-label': 'Map of the whole wall' }, this.canvas, dividers, this.frame);
    this.prev = onPrev ? iconButton('back', 'Previous climb', onPrev) : null;
    this.next = onNext ? iconButton('forward', 'Next climb', onNext) : null;
    this.top = h('div', { class: 'facebar-top' }, this.prev, this.map, this.next);
    this.chips = this.faces.map((face, index) => h('button', { type: 'button', class: 'chip face-chip', onclick: () => this.go(index) }, faceLabel(face, index)));
    this.row = h('div', { class: 'face-chips' }, this.chips);
    this.el = h('div', { class: 'facebar' }, this.top, this.row);
    this.el.faceBar = this; // lets tests and the developer console look inside

    this.#listen();
    view.onView = () => this.update();
    this.observer = new ResizeObserver(() => this.layout());
    this.observer.observe(this.top);
  }

  /** The climb on screen, so the map shows which holds it uses. */
  setMarks(marks) {
    this.marks = marks;
    this.#paint();
  }

  /** Whether there is a climb before and after this one (the buttons only matter in the viewer). */
  setNav({ prev, next }) {
    if (this.prev) this.prev.disabled = !prev;
    if (this.next) this.next.disabled = !next;
  }

  /** Goes to a face: zoomed in as far as its whole height fits. */
  go(index) {
    this.view.focusFace(index);
  }

  /** Moves the frame on the map and lights the chip of the face in the middle of the screen. Called after the wall is drawn. */
  update() {
    const seen = this.view.visibleRect();
    const style = this.frame.style;
    style.left = `${seen.x0 * 100}%`;
    style.top = `${seen.y0 * 100}%`;
    style.width = `${(seen.x1 - seen.x0) * 100}%`;
    style.height = `${(seen.y1 - seen.y0) * 100}%`;
    const middle = faceIndexAt(this.faces, (seen.x0 + seen.x1) / 2);
    if (middle === this.current) return;
    this.current = middle;
    this.el.dataset.face = String(middle);
    this.chips.forEach((chip, index) => chip.classList.toggle('selected', index === middle));
    const chip = this.chips[middle];
    if (chip && this.row.clientWidth > 0) this.row.scrollTo?.({ left: chip.offsetLeft - (this.row.clientWidth - chip.offsetWidth) / 2, behavior: 'smooth' });
  }

  destroy() {
    this.observer.disconnect();
    if (this.view.onView) this.view.onView = null;
  }

  /** Tapping or dragging on the map centres the wall view on that spot. */
  #listen() {
    let dragging = false;
    const jump = (event) => {
      const box = this.map.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return;
      const nx = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
      const ny = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
      const face = this.faces[faceIndexAt(this.faces, nx)];
      const zoom = this.view.zoom >= CLOSE_ENOUGH ? this.view.zoom : this.view.zoomToFit(face ? faceRect(face) : { x0: 0, y0: 0, x1: 1, y1: 1 }, { margin: 0.03 });
      this.view.goTo(nx, ny, zoom);
    };
    this.map.addEventListener('pointerdown', (event) => {
      dragging = true;
      try {
        this.map.setPointerCapture(event.pointerId); // keep hearing this finger even if it slides off the map
      } catch {
        // a finger that is already gone: nothing to keep
      }
      jump(event);
    });
    this.map.addEventListener('pointermove', (event) => {
      if (dragging) jump(event);
    });
    const stop = () => {
      dragging = false;
    };
    this.map.addEventListener('pointerup', stop);
    this.map.addEventListener('pointercancel', stop);
  }

  /** Sizes the map: as big as the space allows, up to a fixed height, always in the shape of the wall. (Also done on every resize.) */
  layout() {
    const buttons = [this.prev, this.next].reduce((sum, button) => sum + (button ? button.offsetWidth : 0), 0);
    const room = this.top.clientWidth - buttons - 8;
    if (room <= 0) return;
    const height = Math.min(MINIMAP_MAX_HEIGHT, room / this.aspect);
    const width = height * this.aspect;
    if (Math.abs(this.map.offsetWidth - width) < 0.5 && Math.abs(this.map.offsetHeight - height) < 0.5) return;
    this.map.style.width = `${width}px`;
    this.map.style.height = `${height}px`;
    this.#paint();
    this.update();
  }

  #paint() {
    if (this.map.offsetWidth > 0) drawThumb(this.canvas, this.wall, this.picture, this.marks, PAINT.minimap);
  }
}
