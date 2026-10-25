import { assert, test } from './harness.js';
import * as Outline from '../site/src/domain/outline.js';
import { formatMarks, holdArea, litHoldsLargestFirst, nearestHold, parseMarks } from '../site/src/domain/holds.js';
import { Viewport } from '../site/src/domain/viewport.js';
import {
  MAX_GRADE, applyQuery, browseIds, cleanWallName, defaultQuery, filterCount, gradeLabel, gradeToStop, stopToGrade,
} from '../site/src/domain/climbs.js';
import { WallPackError, parseHoldsJson } from '../site/src/domain/wallpack.js';
import { findFile, readZip } from '../site/src/domain/zip.js';

const box = (l, t, r, b) => [[l, t], [r, t], [r, b], [l, b]];

// ---- marks ----

test('marks: format and parse round trip, in hold-number order', () => {
  const marks = { 22: 'finish', 3: 'start', 15: 'hand', 9: 'foot' };
  const text = formatMarks(marks);
  assert.eq(text, '3:start,9:foot,15:hand,22:finish');
  assert.eq(parseMarks(text), marks);
});

test('marks: entries that cannot be read are skipped', () => {
  assert.eq(parseMarks('3:start, x:hand, 7:wobble, 8, 9:foot,,'), { 3: 'start', 9: 'foot' });
  assert.eq(parseMarks(''), {});
  assert.eq(parseMarks(null), {});
});

// ---- outline geometry ----

const square = box(0.2, 0.2, 0.4, 0.4);

test('outline: contains tells inside from outside', () => {
  assert.ok(Outline.contains(square, 0.3, 0.3, 1));
  assert.ok(!Outline.contains(square, 0.5, 0.3, 1));
  assert.ok(!Outline.contains(square, 0.3, 0.1, 1));
});

test('outline: contains works for an L shape', () => {
  const l = [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2], [0.3, 0.2], [0.3, 0.3], [0.1, 0.3]];
  assert.ok(Outline.contains(l, 0.15, 0.15, 1));
  assert.ok(Outline.contains(l, 0.25, 0.25, 1));
  assert.ok(!Outline.contains(l, 0.25, 0.15, 1));
});

test('outline: distance is 0 inside and measured to the nearest edge outside', () => {
  assert.near(Outline.distance(square, 0.3, 0.3, 1), 0);
  assert.near(Outline.distance(square, 0.45, 0.3, 1), 0.05);
  assert.near(Outline.distance(square, 0.3, 0.15, 1), 0.05);
  assert.near(Outline.distance(square, 0.44, 0.43, 1), 0.05);
});

test('outline: a tall photo makes vertical fractions longer on screen', () => {
  const small = box(0.4, 0.4, 0.5, 0.5);
  assert.near(Outline.area(small, 0.5), 0.02);
  assert.near(Outline.area(small, 1), 0.01);
  assert.near(Outline.distance(small, 0.45, 0.6, 0.5), 0.2);
});

test('outline: area ignores which way round the corners go', () => {
  assert.near(Outline.area(square, 1), Outline.area([...square].reverse(), 1));
  assert.near(Outline.area(square, 1), 0.04);
});

// ---- tapping holds ----

test('tap: circles, with slack', () => {
  const holds = [{ id: 1, x: 0.3, y: 0.3, r: 0.03 }, { id: 2, x: 0.34, y: 0.3, r: 0.03 }, { id: 3, x: 0.8, y: 0.8, r: 0.04 }];
  assert.eq(nearestHold(holds, 0.8, 0.8, 0.75, 0).id, 3);
  assert.eq(nearestHold(holds, 0.55, 0.55, 0.75, 0.01), null);
  assert.eq(nearestHold(holds, 0.31, 0.3, 0.75, 0.05).id, 1);
  assert.eq(nearestHold(holds, 0.33, 0.3, 0.75, 0.05).id, 2);
  assert.eq(nearestHold(holds, 0.86, 0.8, 0.75, 0), null);
  assert.eq(nearestHold(holds, 0.86, 0.8, 0.75, 0.07).id, 3);
});

test('tap: anywhere inside an outline hits, slack reaches past the edge', () => {
  const rail = { id: 1, x: 0.5, y: 0.5, r: 0.01, outline: box(0.4, 0.495, 0.6, 0.505) };
  assert.eq(nearestHold([rail], 0.58, 0.5, 1, 0).id, 1);
  assert.eq(nearestHold([{ ...rail, outline: null }], 0.58, 0.5, 1, 0), null);
  assert.eq(nearestHold([rail], 0.5, 0.52, 1, 0.01), null);
  assert.eq(nearestHold([rail], 0.5, 0.52, 1, 0.02).id, 1);
});

test('tap: the smaller hold wins where outlines overlap', () => {
  const big = { id: 1, x: 0.5, y: 0.5, r: 0.2, outline: box(0.3, 0.3, 0.7, 0.7) };
  const small = { id: 2, x: 0.5, y: 0.5, r: 0.02, outline: box(0.48, 0.48, 0.52, 0.52) };
  assert.eq(nearestHold([big, small], 0.5, 0.5, 1, 0.01).id, 2);
  assert.eq(nearestHold([small, big], 0.5, 0.5, 1, 0.01).id, 2);
  assert.eq(nearestHold([big, small], 0.35, 0.35, 1, 0.01).id, 1);
});

test('tap: outside every outline the nearest edge wins', () => {
  const left = { id: 1, x: 0.2, y: 0.5, r: 0.05, outline: box(0.15, 0.45, 0.25, 0.55) };
  const right = { id: 2, x: 0.6, y: 0.5, r: 0.05, outline: box(0.55, 0.45, 0.65, 0.55) };
  assert.eq(nearestHold([left, right], 0.35, 0.5, 1, 0.25).id, 1);
  assert.eq(nearestHold([left, right], 0.48, 0.5, 1, 0.25).id, 2);
});

// ---- painting order (the Swoobap bug) ----

test('paint order: a small hold inside a big one is painted after it', () => {
  const small = { id: 159, x: 0.5, y: 0.5, r: 0.01, outline: box(0.49, 0.49, 0.51, 0.51) };
  const big = { id: 160, x: 0.5, y: 0.5, r: 0.1, outline: box(0.4, 0.4, 0.6, 0.6) };
  const other = { id: 5, x: 0.1, y: 0.1, r: 0.03, outline: box(0.07, 0.07, 0.13, 0.13) };
  const marks = { 159: 'start', 160: 'foot', 5: 'hand' };
  assert.eq(litHoldsLargestFirst([small, big, other], marks, 1).map((h) => h.id), [160, 5, 159]);
  assert.eq(litHoldsLargestFirst([other, big, small], marks, 1).map((h) => h.id), [160, 5, 159]);
  assert.eq(litHoldsLargestFirst([small, big], {}, 1), []);
  assert.eq(litHoldsLargestFirst([small, big, other], { 5: 'finish' }, 1).map((h) => h.id), [5]);
});

test('paint order: holds with no outline are measured by their radius', () => {
  const circle = { id: 1, x: 0.2, y: 0.2, r: 0.05 };
  const outlined = { id: 2, x: 0.7, y: 0.7, r: 0.05, outline: box(0.5, 0.5, 0.9, 0.9) };
  assert.ok(holdArea(outlined, 1) > holdArea(circle, 1));
});

// ---- viewport ----

const vp = new Viewport(1000, 1000, 0.75);

test('viewport: fits the photo inside the box', () => {
  assert.near(vp.contentW, 750, 0.01);
  assert.near(vp.contentH, 1000, 0.01);
  const wide = new Viewport(1000, 1000, 2);
  assert.near(wide.contentW, 1000, 0.01);
  assert.near(wide.contentH, 500, 0.01);
});

test('viewport: photo corners and centre map to the right screen spots at zoom 1', () => {
  const topLeft = vp.toPhoto({ x: 125, y: 0 }, { x: 0, y: 0 }, 1);
  assert.near(topLeft.x, 0, 1e-4);
  assert.near(topLeft.y, 0, 1e-4);
  const centre = vp.toPhoto({ x: 500, y: 500 }, { x: 0, y: 0 }, 1);
  assert.near(centre.x, 0.5, 1e-4);
  assert.near(centre.y, 0.5, 1e-4);
});

test('viewport: an unzoomed photo cannot be dragged away; a zoomed one only to its edge', () => {
  assert.eq(vp.clamp({ x: 300, y: -200 }, 1), { x: 0, y: 0 });
  assert.eq(vp.clamp({ x: 900, y: -900 }, 2), { x: 250, y: -500 });
  assert.eq(vp.clamp({ x: 100, y: 40 }, 2), { x: 100, y: 40 });
});

test('viewport: zooming keeps the point under the finger still', () => {
  for (const [focus, start, from, to] of [[{ x: 300, y: 700 }, { x: 0, y: 0 }, 1, 3], [{ x: 820, y: 130 }, { x: -120, y: 60 }, 2, 4.5]]) {
    const before = vp.toPhoto(focus, start, from);
    const offset = vp.zoomAround(focus, start, from, to);
    const after = vp.toPhoto(focus, offset, to);
    assert.near(before.x, after.x, 1e-4);
    assert.near(before.y, after.y, 1e-4);
  }
});

test('viewport: an unknown focus or a broken offset can never blank the picture', () => {
  const offset = { x: 40, y: -25 };
  assert.eq(vp.zoomAround({ x: NaN, y: NaN }, offset, 2, 3), offset);
  assert.eq(vp.zoomAround({ x: NaN, y: 300 }, offset, 2, 3), offset);
  assert.eq(vp.zoomAround({ x: 300, y: 300 }, offset, 2, NaN), offset);
  assert.eq(vp.zoomAround({ x: 300, y: 300 }, offset, 0, 3), offset);
  assert.eq(vp.clamp({ x: NaN, y: NaN }, 3), { x: 0, y: 0 });
  assert.eq(vp.clamp({ x: NaN, y: -900 }, 2), { x: 0, y: -500 });
  assert.eq(vp.clamp({ x: Infinity, y: 0 }, 1), { x: 0, y: 0 });
});

// ---- list: search, filters, sorting, swiping order ----

const climb = (id, name, grade, stars, comment = '', createdAt = 0) => ({ id, name, grade, stars, comment, createdAt: createdAt || Number(id), updatedAt: Number(id), holds: '1:hand', author: '' });
const climbs = () => [climb('1', 'Warm up', 1, 2, '', 100), climb('2', 'Crimpy corner', 4, 4, 'Small crimps, stay low', 200), climb('3', 'Big dyno', 5, 5, 'Throw for the sloper', 300), climb('4', 'Sketchy slab', null, 0, '', 400), climb('5', 'Another four', 4, 3, '', 500)];
const names = (query) => applyQuery(climbs(), { ...defaultQuery(), ...query }).map((c) => c.name);

test('list: newest first by default, oldest first on request', () => {
  assert.eq(names({}), ['Another four', 'Sketchy slab', 'Big dyno', 'Crimpy corner', 'Warm up']);
  assert.eq(names({ sort: 'oldest' })[0], 'Warm up');
});

test('list: hardest and easiest put ungraded last and break ties by newest', () => {
  assert.eq(names({ sort: 'hardest' }), ['Big dyno', 'Another four', 'Crimpy corner', 'Warm up', 'Sketchy slab']);
  assert.eq(names({ sort: 'easiest' }), ['Warm up', 'Another four', 'Crimpy corner', 'Big dyno', 'Sketchy slab']);
});

test('list: top rated and name', () => {
  assert.eq(names({ sort: 'top' })[0], 'Big dyno');
  assert.eq(names({ sort: 'name' }), ['Another four', 'Big dyno', 'Crimpy corner', 'Sketchy slab', 'Warm up']);
});

test('list: search matches names, comments and every word', () => {
  assert.eq(names({ text: 'crimp' }), ['Crimpy corner']);
  assert.eq(names({ text: 'sloper' }), ['Big dyno']);
  assert.eq(names({ text: 'corner low' }), ['Crimpy corner']);
  assert.eq(names({ text: 'corner dyno' }), []);
});

test('list: a grade range hides ungraded climbs; minimum stars', () => {
  assert.eq(names({ minGrade: 4, maxGrade: 6 }), ['Another four', 'Big dyno', 'Crimpy corner']);
  assert.eq(names({ minGrade: 4, maxGrade: 4 }), ['Another four', 'Crimpy corner']);
  assert.eq(names({ minStars: 4, sort: 'name' }), ['Big dyno', 'Crimpy corner']);
  assert.eq(filterCount({ ...defaultQuery(), text: 'x', sort: 'name' }), 0);
  assert.eq(filterCount({ ...defaultQuery(), minGrade: 2, minStars: 3 }), 2);
});

test('swipe order follows the list, and the start climb is always there', () => {
  assert.eq(browseIds(climbs(), defaultQuery(), '3'), ['5', '4', '3', '2', '1']);
  assert.eq(browseIds(climbs(), { ...defaultQuery(), sort: 'hardest' }, '3'), ['3', '5', '2', '1', '4']);
  assert.eq(browseIds(climbs(), { ...defaultQuery(), minGrade: 4, maxGrade: 4 }, '2'), ['5', '2']);
  assert.eq(browseIds(climbs(), { ...defaultQuery(), minGrade: 4, maxGrade: 17 }, '1'), ['1']);
  for (const c of climbs()) assert.ok(browseIds(climbs(), { ...defaultQuery(), text: 'zzz' }, c.id).includes(c.id));
});

// ---- grades and names ----

test('grade labels and the slider mapping', () => {
  assert.eq(gradeLabel(0), 'V0');
  assert.eq(gradeLabel(12), 'V12');
  assert.eq(gradeLabel(null), '—');
  assert.eq(stopToGrade(0), null);
  assert.eq(stopToGrade(1), 0);
  assert.eq(stopToGrade(5), 4);
  assert.eq(stopToGrade(MAX_GRADE + 1), MAX_GRADE);
  assert.eq(stopToGrade(gradeToStop(null)), null);
  for (let grade = 0; grade <= MAX_GRADE; grade++) assert.eq(stopToGrade(gradeToStop(grade)), grade);
  assert.eq(stopToGrade(3.4), 2);
  assert.eq(stopToGrade(3.6), 3);
  assert.eq(stopToGrade(40), MAX_GRADE);
  assert.eq(stopToGrade(-3), null);
});

test('wall names are trimmed and capped; empty is refused', () => {
  assert.eq(cleanWallName('  Home wall \n'), 'Home wall');
  assert.eq(cleanWallName('x'.repeat(100)).length, 40);
  assert.eq(cleanWallName('A' + ' '.repeat(60) + 'B'), 'A');
  assert.eq(cleanWallName(''), null);
  assert.eq(cleanWallName('   \n\t'), null);
});

// ---- wall pack file (holds.json) ----

const pack = (over = {}) => JSON.stringify({ version: 1, key: 'home', name: 'Home wall', image: 'wall.jpg', holds: [{ id: 1, x: 0.25, y: 0.5, r: 0.02 }, { id: 2, x: 0.75, y: 0.1 }], ...over });
const packRejected = (text, part) => assert.throws(() => parseHoldsJson(text), part);

test('wall pack: reads a good pack, with defaults', () => {
  const parsed = parseHoldsJson(pack({ angle: 35 }));
  assert.eq(parsed.key, 'home');
  assert.eq(parsed.name, 'Home wall');
  assert.eq(parsed.imageName, 'wall.jpg');
  assert.eq(parsed.angle, 35);
  assert.eq(parsed.holds.length, 2);
  assert.eq(parsed.holds[1].r, 0.02);
  assert.eq(parsed.holds[1].outline, null);
  assert.eq(parseHoldsJson(pack()).angle, null);
  assert.eq(parseHoldsJson(pack({ key: undefined, name: 'My Home Wall #2' })).key, 'my-home-wall-2');
});

test('wall pack: reads outlines and rejects bad ones', () => {
  const ok = parseHoldsJson(pack({ holds: [{ id: 1, x: 0.3, y: 0.3, r: 0.02, outline: box(0.2, 0.2, 0.4, 0.4) }, { id: 2, x: 0.7, y: 0.7 }] }));
  assert.eq(ok.holds[0].outline.length, 4);
  assert.eq(ok.holds[1].outline, null);
  packRejected(pack({ holds: [{ id: 1, x: 0.3, y: 0.3, outline: [[0.2, 0.2], [0.4, 0.2]] }] }), 'fewer than 3');
  packRejected(pack({ holds: [{ id: 1, x: 0.3, y: 0.3, outline: [[0.2, 0.2], [0.4, 0.2], [0.4, 1.4]] }] }), 'between 0 and 1');
  packRejected(pack({ holds: [{ id: 1, x: 0.3, y: 0.3, outline: [[0.2, 0.2], [0.4], [0.4, 0.4]] }] }), '[x, y]');
  packRejected(pack({ holds: [{ id: 1, x: 0.3, y: 0.3, outline: 'round' }] }), 'not a list');
});

test('wall pack: rejects broken packs with a readable message', () => {
  packRejected('{not json', 'not valid JSON');
  packRejected(pack({ name: '', key: 'k' }), 'name');
  packRejected(pack({ image: '' }), 'image');
  packRejected(pack({ holds: [] }), 'empty');
  packRejected(pack({ holds: [{ id: 4, x: 0.1, y: 0.1 }, { id: 4, x: 0.2, y: 0.2 }] }), 'more than once');
  packRejected(pack({ holds: [{ id: 1, x: 1.2, y: 0.5 }] }), 'between 0 and 1');
  packRejected(pack({ holds: [{ id: 1, x: 0.4 }] }), 'between 0 and 1');
  packRejected(pack({ holds: [{ x: 0.4, y: 0.4 }] }), 'no "id"');
  packRejected(pack({ holds: [{ id: 1, x: 0.4, y: 0.4, r: 0.9 }] }), 'radius');
  assert.ok(new WallPackError('x') instanceof Error);
});

// ---- zip reader ----

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Builds a zip file in memory. entries: [{ name, data (string or bytes), deflate }]. */
export async function makeZip(entries, { lieAboutSize = null } = {}) {
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const push = (bytes) => {
    parts.push(bytes);
    offset += bytes.length;
  };
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    const stored = entry.deflate ? await deflate(data) : data;
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(8, entry.deflate ? 8 : 0, true);
    header.setUint32(14, crc32(data), true);
    header.setUint32(18, stored.length, true);
    header.setUint32(22, lieAboutSize ?? data.length, true);
    header.setUint16(26, name.length, true);
    const localOffset = offset;
    push(new Uint8Array(header.buffer));
    push(name);
    push(stored);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(10, entry.deflate ? 8 : 0, true);
    dir.setUint32(16, crc32(data), true);
    dir.setUint32(20, stored.length, true);
    dir.setUint32(24, lieAboutSize ?? data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, localOffset, true);
    central.push(new Uint8Array(dir.buffer), name);
  }
  const centralOffset = offset;
  for (const bytes of central) push(bytes);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, offset - centralOffset, true);
  end.setUint32(16, centralOffset, true);
  push(new Uint8Array(end.buffer));
  return new Blob(parts).arrayBuffer();
}

test('zip: reads stored and deflated files, in folders, ignoring macOS clutter', async () => {
  const text = 'hello hello hello hello hello hello';
  const buffer = await makeZip([
    { name: 'pack/holds.json', data: text, deflate: true },
    { name: 'pack/note.txt', data: 'plain', deflate: false },
    { name: '__MACOSX/pack/._holds.json', data: 'junk' },
    { name: 'pack/', data: '' },
  ]);
  const files = await readZip(buffer);
  assert.eq([...files.keys()].sort(), ['pack/holds.json', 'pack/note.txt']);
  assert.eq(new TextDecoder().decode(files.get('pack/holds.json')), text);
  assert.eq(new TextDecoder().decode(findFile(files, 'HOLDS.JSON')), text);
  assert.eq(findFile(files, 'missing.jpg'), undefined);
});

test('zip: rejects things that are not zips, and damaged or lying zips', async () => {
  await assert.rejects(readZip(new TextEncoder().encode('this is just text').buffer), 'not a zip');
  await assert.rejects(readZip(new ArrayBuffer(0)), 'not a zip');
  const lying = await makeZip([{ name: 'a.txt', data: 'x'.repeat(5000), deflate: true }], { lieAboutSize: 100 });
  await assert.rejects(readZip(lying), 'damaged');
  const big = await makeZip([{ name: 'a.txt', data: 'x'.repeat(5000), deflate: true }]);
  await assert.rejects(readZip(big, { maxBytes: 1000 }), 'bigger than');
});

test('zip: reads the real wall pack when it is available', async () => {
  const response = await fetch('/private/work/home-wall.zip');
  if (!response.ok) return; // only on the machine that has it
  const files = await readZip(await response.arrayBuffer());
  const holds = parseHoldsJson(new TextDecoder().decode(findFile(files, 'holds.json')));
  assert.ok(holds.holds.length > 400, 'expected hundreds of holds');
  assert.ok(findFile(files, holds.imageName).length > 100000, 'expected a real photo');
});
