// A wall can be made of several faces (a U-shaped wall: left wall, doors, overhang, ...) laid side by side in one long picture.
// The wall pack lists them as `sections`: { name, angle (degrees of overhang, optional), x0, x1 } where x0 and x1 are where the face
// starts and ends along the picture, as fractions of its width. A wall with no faces is just one picture, as before, and none of
// the things below happen for it.

export const MAX_FACES = 24;

export const facesOf = (wall) => (Array.isArray(wall?.sections) ? wall.sections : []);
export const hasFaces = (wall) => facesOf(wall).length > 0;

/** The face a position along the picture (a fraction of its width) belongs to; the nearest one if it falls between two. */
export function faceIndexAt(faces, x) {
  let best = -1;
  let bestDistance = Infinity;
  faces.forEach((face, index) => {
    const distance = x < face.x0 ? face.x0 - x : x > face.x1 ? x - face.x1 : 0;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/** How a face is named in chips and labels: "Overhang 35°" (the angle only when it is known). */
export const faceLabel = (face, index) => `${face.name || `Face ${index + 1}`}${Number.isFinite(face.angle) ? ` ${face.angle}°` : ''}`;

/** The whole height of a face, as a rectangle of the picture. */
export const faceRect = (face) => ({ x0: face.x0, y0: 0, x1: face.x1, y1: 1 });

/** The rectangle (fractions of the picture) round one hold, using its outline if it has one. */
export function holdBounds(hold, aspect) {
  if (Array.isArray(hold.outline) && hold.outline.length >= 3) {
    const xs = hold.outline.map((point) => point[0]);
    const ys = hold.outline.map((point) => point[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }
  const r = hold.r ?? 0.02; // a fraction of the width, so a fraction of the height is bigger by the aspect
  return { x0: hold.x - r, y0: hold.y - r * aspect, x1: hold.x + r, y1: hold.y + r * aspect };
}

/** The smallest rectangle (fractions of the picture) holding every hold a climb lights, or null if it lights none. */
export function marksBounds(wall, marks) {
  const aspect = wall.imageWidth / wall.imageHeight;
  let bounds = null;
  for (const hold of wall.holds) {
    if (marks[hold.id] === undefined) continue;
    const box = holdBounds(hold, aspect);
    bounds = bounds
      ? { x0: Math.min(bounds.x0, box.x0), y0: Math.min(bounds.y0, box.y0), x1: Math.max(bounds.x1, box.x1), y1: Math.max(bounds.y1, box.y1) }
      : box;
  }
  return bounds;
}

/** The shape (width divided by height) of a climb's thumbnail on a long wall: portrait, however wide the wall is. */
export const LONG_THUMB_ASPECT = 0.8;

/**
 * Which part of a long wall a climb's thumbnail shows: the part round its holds, in the shape of the thumbnail. A wall without
 * faces has none (null): its thumbnail shows the whole wall, as it always did.
 */
export function thumbCrop(wall, marks, windowAspect) {
  if (!hasFaces(wall)) return null;
  const bounds = marksBounds(wall, marks) ?? faceRect(facesOf(wall)[0]);
  return cropAround(bounds, windowAspect, wall.imageWidth / wall.imageHeight);
}

/**
 * A window with the shape of a small picture (`windowAspect`, its width divided by its height) round `bounds`, kept inside the
 * wall picture. Used to crop a climb's thumbnail on a wall too wide to show whole in a small box.
 */
export function cropAround(bounds, windowAspect, photoAspect, margin = 0.3) {
  // In fractions: width = height * windowAspect / photoAspect.
  const ratio = windowAspect / photoAspect;
  let w = Math.max((bounds.x1 - bounds.x0) * (1 + 2 * margin), 0.02);
  let h = Math.max((bounds.y1 - bounds.y0) * (1 + 2 * margin), 0.02);
  if (w / h < ratio) w = h * ratio;
  else h = w / ratio;
  if (h > 1) {
    h = 1;
    w = h * ratio;
  }
  if (w > 1) {
    w = 1;
    h = w / ratio;
  }
  const cx = (bounds.x0 + bounds.x1) / 2;
  const cy = (bounds.y0 + bounds.y1) / 2;
  const x0 = Math.min(Math.max(cx - w / 2, 0), 1 - w);
  const y0 = Math.min(Math.max(cy - h / 2, 0), 1 - h);
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}
