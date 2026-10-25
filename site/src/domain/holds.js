import { roleByCode } from './roles.js';
import * as Outline from './outline.js';

// A hold is { id, x, y, r, outline }: x and y are fractions of the photo's width and height from the top-left, r is its
// radius as a fraction of the photo's width, and outline is the corners of a polygon round it ([x, y] pairs, same
// fractions) or null. The marks of a climb are an object { holdId: roleCode }.

export const hasOutline = (hold) => Array.isArray(hold.outline) && hold.outline.length >= 3;

/** The holds of a climb as text like `12:start,15:hand,22:finish`, in hold-number order. */
export function formatMarks(marks) {
  return Object.keys(marks)
    .map(Number)
    .sort((a, b) => a - b)
    .map((id) => `${id}:${marks[id]}`)
    .join(',');
}

/** Reads what formatMarks wrote. Entries it cannot read are skipped rather than failing the whole climb. */
export function parseMarks(text) {
  const marks = {};
  if (typeof text !== 'string') return marks;
  for (const part of text.split(',')) {
    const pieces = part.trim().split(':');
    if (pieces.length !== 2) continue;
    const idText = pieces[0].trim();
    if (!/^\d+$/.test(idText)) continue;
    const code = pieces[1].trim();
    if (!roleByCode.has(code)) continue;
    marks[Number(idText)] = code;
  }
  return marks;
}

/**
 * The hold closest to a tap, or null if the tap landed on bare wall. The tap is given as a fraction of the photo
 * (nx, ny) and `aspect` is the photo's width divided by its height.
 *
 * A hold with an outline is hit by tapping inside it, or within `slack` (a fraction of the photo's width) of its edge,
 * so small holds stay easy to tap when the wall is zoomed out. Where outlines overlap, the smaller hold wins, since it is
 * the one that would otherwise be impossible to hit. A hold without an outline is a circle that can be hit a little
 * outside its own edge.
 */
export function nearestHold(holds, nx, ny, aspect, slack) {
  let best = null;
  let bestDistance = Infinity;
  let bestArea = Infinity;
  for (const hold of holds) {
    let distance;
    if (hasOutline(hold)) {
      distance = Outline.distance(hold.outline, nx, ny, aspect);
      if (distance > slack) continue;
    } else {
      distance = Math.hypot(hold.x - nx, (hold.y - ny) / aspect);
      if (distance > Math.max(hold.r * 1.3, slack)) continue;
    }
    // Only a tap inside an outline (distance 0) can be inside several; the smallest of them wins.
    const area = distance === 0 && hasOutline(hold) ? Outline.area(hold.outline, aspect) : Infinity;
    if (distance < bestDistance || (distance === bestDistance && area < bestArea)) {
      best = hold;
      bestDistance = distance;
      bestArea = area;
    }
  }
  return best;
}

/** A hold's area in photo-width-squared units: from its outline, or from its radius if it has none. */
export function holdArea(hold, aspect) {
  return hasOutline(hold) ? Outline.area(hold.outline, aspect) : Math.PI * hold.r * hold.r;
}

/**
 * The holds a climb lights, in the order they should be painted: biggest first. A small hold can lie on top of, or
 * inside, a bigger one (a hold on a volume). Painting the big one last would cover the small one's outline, so the
 * small one goes last and always stays visible.
 */
export function litHoldsLargestFirst(holds, marks, aspect) {
  return holds.filter((hold) => marks[hold.id] !== undefined).sort((a, b) => holdArea(b, aspect) - holdArea(a, aspect));
}
