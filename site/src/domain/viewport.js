// How the wall photo sits in its box. At zoom 1 the photo is scaled to fit the box and centred. `offset` is how far the
// photo's centre has been dragged from the box's centre, in screen pixels: { x, y }.

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 6;

/** How far in a wall of this shape can be zoomed. A long wall (several faces side by side) needs to go in further to see a single hold. */
export const zoomMaxFor = (aspect) => (aspect > 1.5 ? Math.min(14, Math.max(ZOOM_MAX, aspect * 3)) : ZOOM_MAX);

export class Viewport {
  constructor(boxW, boxH, aspect) {
    this.boxW = boxW;
    this.boxH = boxH;
    this.aspect = aspect;
    this.contentW = aspect > boxW / boxH ? boxW : boxH * aspect;
    this.contentH = this.contentW / aspect;
  }

  /** Keeps a dragged photo from leaving the box: it can be moved only as far as its zoomed edge. */
  clamp(offset, zoom) {
    return {
      x: clampAxis(offset.x, this.contentW * zoom, this.boxW),
      y: clampAxis(offset.y, this.contentH * zoom, this.boxH),
    };
  }

  /**
   * The offset that keeps the spot under `focus` (screen pixels) where it is while the zoom changes. If the focus is not
   * a real position, the offset is left as it is.
   */
  zoomAround(focus, offset, zoom, newZoom) {
    if (!Number.isFinite(focus.x) || !Number.isFinite(focus.y) || !Number.isFinite(newZoom) || !(zoom > 0)) return offset;
    const fx = focus.x - this.boxW / 2;
    const fy = focus.y - this.boxH / 2;
    const ratio = newZoom / zoom;
    return { x: fx - (fx - offset.x) * ratio, y: fy - (fy - offset.y) * ratio };
  }

  /**
   * The zoom and offset that show a part of the photo (`rect`, fractions: { x0, y0, x1, y1 }) as large as fits, with a margin of
   * `margin` (a fraction of that part) round it. The zoom never goes below 1 or above `maxZoom`.
   */
  fitRect(rect, { margin = 0.12, maxZoom = ZOOM_MAX } = {}) {
    const w = Math.max((rect.x1 - rect.x0) * this.contentW, 1);
    const h = Math.max((rect.y1 - rect.y0) * this.contentH, 1);
    const wanted = Math.min(this.boxW / (w * (1 + 2 * margin)), this.boxH / (h * (1 + 2 * margin)));
    const zoom = Math.min(maxZoom, Math.max(ZOOM_MIN, Number.isFinite(wanted) ? wanted : ZOOM_MIN));
    return { zoom, offset: this.centerOn((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2, zoom) };
  }

  /** The offset that puts the photo position (fractions) in the middle of the box at this zoom (as near as the photo's edges allow). */
  centerOn(nx, ny, zoom) {
    return this.clamp({ x: -zoom * (nx - 0.5) * this.contentW, y: -zoom * (ny - 0.5) * this.contentH }, zoom);
  }

  /** The part of the photo that shows in the box, as fractions: { x0, y0, x1, y1 }. */
  visibleRect(offset, zoom) {
    const a = this.toPhoto({ x: 0, y: 0 }, offset, zoom);
    const b = this.toPhoto({ x: this.boxW, y: this.boxH }, offset, zoom);
    const unit = (v) => Math.min(1, Math.max(0, v));
    return { x0: unit(a.x), y0: unit(a.y), x1: unit(b.x), y1: unit(b.y) };
  }

  /** A screen position as fractions of the photo's width and height (0..1 inside the photo). */
  toPhoto(screen, offset, zoom) {
    return {
      x: ((screen.x - this.boxW / 2 - offset.x) / zoom + this.contentW / 2) / this.contentW,
      y: ((screen.y - this.boxH / 2 - offset.y) / zoom + this.contentH / 2) / this.contentH,
    };
  }
}

function clampAxis(offset, content, box) {
  // A bad number must never blank the picture: start from the middle instead.
  if (!Number.isFinite(offset)) return 0;
  const extra = Math.max(0, (content - box) / 2);
  return extra === 0 ? 0 : Math.min(extra, Math.max(-extra, offset));
}
