// Geometry for hold outlines. Points are [x, y] as fractions of the photo's width and height, which are not the same
// length on screen, so everything here converts y to "fractions of the width" first (divide by the photo's `aspect`, its
// width over its height). That keeps distances and areas true to the picture.

/** Whether the point is inside the polygon. */
export function contains(points, x, y, aspect) {
  const py = y / aspect;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][0];
    const yi = points[i][1] / aspect;
    const xj = points[j][0];
    const yj = points[j][1] / aspect;
    if (yi > py !== yj > py && x < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** How far the point is from the polygon: 0 inside it, otherwise the distance to its nearest edge. */
export function distance(points, x, y, aspect) {
  if (contains(points, x, y, aspect)) return 0;
  const py = y / aspect;
  let best = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const d = segmentDistance(x, py, points[j][0], points[j][1] / aspect, points[i][0], points[i][1] / aspect);
    if (d < best) best = d;
  }
  return best;
}

/** The polygon's area, in photo-width-squared units. */
export function area(points, aspect) {
  let twice = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    twice += points[j][0] * (points[i][1] / aspect) - points[i][0] * (points[j][1] / aspect);
  }
  return Math.abs(twice) / 2;
}
