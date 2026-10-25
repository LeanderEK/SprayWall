// How the wall photo sits in its box. At zoom 1 the photo is scaled to fit the box and centred. `offset` is how far the
// photo's centre has been dragged from the box's centre, in screen pixels: { x, y }.

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 6;

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
