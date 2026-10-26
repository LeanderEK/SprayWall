// The `holds.json` file inside a wall pack (a .zip with this file and the wall photo):
//
//   { "version": 1,
//     "key": "av-wall",          optional; importing the same key again updates that wall in place
//     "name": "AV wall",
//     "image": "wall.jpg",       the photo's file name inside the zip
//     "angle": 35,               optional, degrees of overhang
//     "holds": [ { "id": 1, "x": 0.231, "y": 0.412, "r": 0.021,
//                  "outline": [[0.22, 0.40], [0.24, 0.40], [0.25, 0.43]] }, ... ] }
//
// x and y are fractions of the photo's width and height from the top-left; r is the hold's radius as a fraction of the
// photo's width. outline is optional: the corners of a polygon around the hold. Hold ids must stay the same when a wall
// is updated, because climbs point at holds by id. This is the same format the Android app reads.

export const PACK_FILE_NAME = 'holds.json';

// A wall that was given a new key. Only the one wall is moved: a "home-wall" that somebody else made is a different wall
// that happens to have the same key, so it is told apart by its holds (`isTheSameWall`) and left alone.
//   - a phone that saved the wall under the old key moves it to the new key (Repo.upgradeData);
//   - a board that was made under the old key can still be joined for the renamed wall (boardFits).
export const RENAMED_WALLS = [
  {
    from: 'home-wall',
    to: 'av-wall',
    fromName: 'Home wall',
    toName: 'AV wall',
    // 524 holds, numbered up to 602, whose numbers add up to 161422
    isTheSameWall: (wall) => wall.holds.length === 524 && Math.max(...wall.holds.map((hold) => hold.id)) === 602 && wall.holds.reduce((sum, hold) => sum + hold.id, 0) === 161422,
  },
];

/** Whether a board made for the wall `boardKey` can be used for the wall `wallKey`: the same key, or the key it had before it was renamed. */
export const boardFits = (boardKey, wallKey) => boardKey === wallKey || RENAMED_WALLS.some((renamed) => renamed.to === wallKey && renamed.from === boardKey);
const DEFAULT_RADIUS = 0.02;

export class WallPackError extends Error {}

export const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const inUnit = (value) => isNumber(value) && value >= 0 && value <= 1;

export function parseHoldsJson(text) {
  let root;
  try {
    root = JSON.parse(text);
  } catch {
    throw new WallPackError('holds.json is not valid JSON.');
  }
  if (root === null || typeof root !== 'object' || Array.isArray(root)) throw new WallPackError('holds.json is not valid JSON.');
  const name = typeof root.name === 'string' ? root.name.trim() : '';
  const key = (typeof root.key === 'string' ? root.key.trim() : '') || slug(name);
  if (name === '') throw new WallPackError('holds.json needs a "name".');
  if (key === '') throw new WallPackError('holds.json needs a "key" or a name with letters or digits in it.');
  const image = typeof root.image === 'string' ? root.image.trim() : '';
  if (image === '') throw new WallPackError('holds.json needs an "image" (the photo\'s file name inside the zip).');
  if (!Array.isArray(root.holds)) throw new WallPackError('holds.json needs a "holds" list.');
  const holds = parseHolds(root.holds);
  if (holds.length === 0) throw new WallPackError('The "holds" list is empty.');
  const angle = isNumber(root.angle) ? Math.round(root.angle) : null;
  return { key, name, imageName: image, angle, holds };
}

export function parseHolds(list) {
  const holds = [];
  const seen = new Set();
  list.forEach((item, index) => {
    const number = index + 1;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new WallPackError(`Hold number ${number} is not an object.`);
    if (!('id' in item)) throw new WallPackError(`Hold number ${number} has no "id".`);
    if (!Number.isInteger(item.id)) throw new WallPackError(`Hold number ${number} has an "id" that is not a whole number.`);
    if (seen.has(item.id)) throw new WallPackError(`Hold id ${item.id} appears more than once.`);
    seen.add(item.id);
    if (!inUnit(item.x) || !inUnit(item.y)) throw new WallPackError(`Hold ${item.id} needs "x" and "y" between 0 and 1.`);
    const r = 'r' in item ? item.r : DEFAULT_RADIUS;
    if (!isNumber(r) || r <= 0 || r > 0.5) throw new WallPackError(`Hold ${item.id} has a radius "r" outside 0 to 0.5.`);
    holds.push({ id: item.id, x: item.x, y: item.y, r, outline: 'outline' in item ? parseOutline(item.outline, item.id) : null });
  });
  return holds;
}

function parseOutline(list, id) {
  if (!Array.isArray(list)) throw new WallPackError(`Hold ${id} has an "outline" that is not a list.`);
  if (list.length < 3) throw new WallPackError(`Hold ${id} has an "outline" with fewer than 3 points.`);
  return list.map((point) => {
    if (!Array.isArray(point) || point.length !== 2 || !inUnit(point[0]) || !inUnit(point[1])) {
      throw new WallPackError(`Hold ${id} has an outline point that is not [x, y] between 0 and 1.`);
    }
    return [point[0], point[1]];
  });
}
