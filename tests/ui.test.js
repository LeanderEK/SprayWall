import { assert, test } from './harness.js';
import { drag, pinch, tap } from './touch.js';
import { app } from '../site/src/app.js';
import { MemoryStore, Repo } from '../site/src/data/repo.js';
import { parseShare } from '../site/src/domain/share.js';
import { Viewport } from '../site/src/domain/viewport.js';
import { mountEditor } from '../site/src/ui/editor.js';
import { mountImporter } from '../site/src/ui/importer.js';
import { mountList } from '../site/src/ui/list.js';
import { mountViewer } from '../site/src/ui/viewer.js';
import { mountWalls } from '../site/src/ui/walls.js';
import { PAINT, WallView } from '../site/src/ui/wallview.js';

// These tests put the real screens on the page and use them the way a person would: tapping, typing, swiping, pinching.
// (Pages that are not being looked at do not get their animation frames, so nothing here waits for one.)

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stage = () => document.getElementById('stage');

/** A 400 x 500 grey wall with a 3 x 3 grid of square holds, numbered 1 to 9 left to right, top to bottom. */
async function testWall() {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 500;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 400, 500);
  const holds = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const id = row * 3 + col + 1;
      const x = 0.2 + col * 0.3;
      const y = 0.2 + row * 0.3;
      ctx.fillStyle = '#fff';
      ctx.fillRect(x * 400 - 20, y * 500 - 20, 40, 40);
      const hw = 0.05;
      const hh = 0.04;
      holds.push({ id, x, y, r: 0.05, outline: [[x - hw, y - hh], [x + hw, y - hh], [x + hw, y + hh], [x - hw, y + hh]] });
    }
  }
  const image = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return { key: 'test-wall', name: 'Test wall', image, imageWidth: 400, imageHeight: 500, holds, angle: null };
}

/** A fresh app with a wall, and a stand-in for navigation that remembers where it was asked to go. */
async function freshApp({ withWall = true } = {}) {
  let clock = 1_000_000; // each save a second later, so "newest first" has an answer
  const repo = new Repo(new MemoryStore(), () => (clock += 1000));
  const wall = await testWall();
  if (withWall) await repo.saveWall(wall);
  const visits = [];
  app.repo = repo;
  app.query = { text: '', minGrade: 0, maxGrade: 17, minStars: 0, sort: 'newest' };
  app.pending = null;
  app.leaveGuard = null;
  app.nav = { go: (path) => visits.push(['go', path]), replace: (path) => visits.push(['replace', path]), back: (path) => visits.push(['back', path]) };
  document.querySelectorAll('.sheet, .dialog, .backdrop, .toast').forEach((el) => el.remove());
  stage().replaceChildren();
  const root = document.createElement('div');
  root.className = 'screen';
  stage().append(root);
  return { repo, wall, root, visits };
}

/** Where on the page a hold sits, given how the wall view is currently zoomed and moved. */
function screenPoint(view, hold) {
  const rect = view.canvas.getBoundingClientRect();
  const vp = new Viewport(view.size.w, view.size.h, view.aspect);
  return [
    rect.left + view.size.w / 2 + view.offset.x + (hold.x * vp.contentW - vp.contentW / 2) * view.zoom,
    rect.top + view.size.h / 2 + view.offset.y + (hold.y * vp.contentH - vp.contentH / 2) * view.zoom,
  ];
}

const climbData = (over = {}) => ({ wallKey: 'test-wall', name: 'First', grade: 4, stars: 3, comment: '', holds: '1:start,5:hand', ...over });
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const buttonWith = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const typeInto = (input, value) => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

/** How much of a canvas is painted, and how much of that is not black: a blank or black picture shows up here. */
function look(canvas) {
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let painted = 0;
  let bright = 0;
  let samples = 0;
  for (let i = 0; i < data.length; i += 4 * 61) {
    samples++;
    if (data[i + 3] > 0) painted++;
    if (data[i] + data[i + 1] + data[i + 2] > 150) bright++;
  }
  return { painted: painted / samples, bright: bright / samples };
}

async function wallViewWith(marks = {}, options = {}) {
  const { wall } = await freshApp();
  const stored = await app.repo.getWall('test-wall');
  const picture = await createImageBitmap(stored.image);
  const view = new WallView(options);
  view.el.style.cssText = 'width:375px;height:600px;position:relative';
  stage().append(view.el);
  view.setWall(stored, picture);
  view.setMarks(marks);
  view.setPaint(PAINT.climbBright);
  view.renderNow();
  return { view, wall: stored };
}

// ---- the wall view: drawing and gestures ----

test('wall view: the wall is drawn, not blank or black', async () => {
  const { view } = await wallViewWith();
  const result = look(view.canvas);
  assert.ok(result.painted > 0.5, `painted ${result.painted}`);
  assert.ok(result.bright > 0.3, `bright ${result.bright}`);
});

test('wall view: pinching in zooms and the wall stays visible; pinching out brings it back', async () => {
  const { view } = await wallViewWith();
  const rect = view.canvas.getBoundingClientRect();
  const mid = [rect.left + rect.width / 2, rect.top + rect.height / 2];
  await pinch(view.canvas, mid, 60, 260);
  assert.ok(view.zoom > 2, `zoom ${view.zoom}`);
  view.renderNow();
  const zoomed = look(view.canvas);
  assert.ok(zoomed.painted > 0.5 && zoomed.bright > 0.2, `blank when zoomed in: ${JSON.stringify(zoomed)}`);
  await pinch(view.canvas, mid, 260, 60);
  assert.near(view.zoom, 1, 0.001);
  assert.eq(view.offset, { x: 0, y: 0 });
  view.renderNow();
  assert.ok(look(view.canvas).painted > 0.5);
});

test('wall view: a pinch that ends with one finger still down keeps the wall visible and is not a tap', async () => {
  const taps = [];
  const { view } = await wallViewWith({}, { onTapHold: (hold) => taps.push(hold.id) });
  const rect = view.canvas.getBoundingClientRect();
  const mid = [rect.left + rect.width / 2, rect.top + rect.height / 2];
  await pinch(view.canvas, mid, 60, 220, { lift: false });
  view.canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, pointerType: 'touch', clientX: mid[0] + 110, clientY: mid[1], bubbles: true }));
  view.canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', clientX: mid[0] - 110, clientY: mid[1], bubbles: true }));
  view.renderNow();
  assert.ok(look(view.canvas).painted > 0.5);
  assert.eq(taps, []);
  assert.ok(Number.isFinite(view.offset.x) && Number.isFinite(view.offset.y));
});

test('wall view: a one-finger drag pans a zoomed wall and does not page; at zoom 1 it pages', async () => {
  const dragged = [];
  const ended = [];
  const { view } = await wallViewWith({}, { pager: { onDrag: (dx) => dragged.push(dx), onEnd: (dx, v, cancelled) => ended.push([Math.round(dx), cancelled]) } });
  const rect = view.canvas.getBoundingClientRect();
  const mid = [rect.left + rect.width / 2, rect.top + rect.height / 2];
  await drag(view.canvas, [mid[0] + 100, mid[1]], [mid[0] - 100, mid[1]]);
  assert.ok(dragged.length > 0, 'at zoom 1 the drag is reported to the pager');
  assert.eq(ended, [[-200, false]]);
  await pinch(view.canvas, mid, 60, 260);
  dragged.length = 0;
  ended.length = 0;
  const before = { ...view.offset };
  await drag(view.canvas, [mid[0] + 60, mid[1]], [mid[0] - 60, mid[1]]);
  assert.eq([dragged.length, ended.length], [0, 0], 'zoomed in, the drag belongs to the wall');
  assert.ok(view.offset.x < before.x, 'and it moved the wall');
});

test('wall view: tapping a hold reports it; tapping bare wall does not; a drag is not a tap', async () => {
  const taps = [];
  const { view, wall } = await wallViewWith({}, { onTapHold: (hold) => taps.push(hold.id) });
  const five = wall.holds[4];
  const [x, y] = screenPoint(view, five);
  tap(view.canvas, x, y);
  assert.eq(taps, [5]);
  const rect = view.canvas.getBoundingClientRect();
  tap(view.canvas, rect.left + 3, rect.top + 3);
  assert.eq(taps, [5]);
  await drag(view.canvas, [x, y], [x + 30, y + 30], { release: true });
  assert.eq(taps, [5]);
});

test('wall view: a small hold inside a big one is drawn with its own ring', async () => {
  const { view, wall } = await wallViewWith();
  const big = { id: 100, x: 0.5, y: 0.5, r: 0.2, outline: [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]] };
  const small = { id: 99, x: 0.5, y: 0.5, r: 0.02, outline: [[0.48, 0.49], [0.52, 0.49], [0.52, 0.51], [0.48, 0.51]] };
  view.setWall({ ...wall, holds: [small, big] }, await createImageBitmap(wall.image));
  view.setPaint(PAINT.climb);
  view.setMarks({ 99: 'hand', 100: 'foot' });
  view.renderNow();
  // the small hold's blue ring must show on top of the big hold's orange tint
  const c = view.canvas;
  const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let blue = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] < 90 && data[i + 1] > 140 && data[i + 2] > 200) blue++;
  assert.ok(blue > 20, `the small hold's ring was covered (found ${blue} blue pixels)`);
});

// ---- the editor ----

test('editor: choose a type, tap holds, undo, erase, save: the climb is stored with those holds', async () => {
  const { repo, root, visits } = await freshApp();
  const screen = await mountEditor(root, { id: 'new' });
  const view = root.querySelector('.wallview').wallView;
  view.renderNow();
  const holds = view.wall.holds;
  const press = (n) => tap(view.canvas, ...screenPoint(view, holds[n - 1]));
  assert.ok(buttonWith(root, 'Save').disabled, 'cannot save an empty climb');
  press(1); // Start is the type to begin with
  click(buttonWith(root, 'Hand'));
  press(2);
  press(3);
  press(4);
  press(4); // tapping a lit hold of the same type again takes it off
  press(6);
  click(root.querySelector('[aria-label="Undo"]')); // undo the last tap (hold 6)
  click(buttonWith(root, 'Erase'));
  press(2); // erase hold 2
  click(buttonWith(root, 'Foot'));
  press(9);
  assert.ok(!buttonWith(root, 'Save').disabled);
  click(buttonWith(root, 'Save'));
  const sheet = document.querySelector('.sheet');
  assert.ok(sheet, 'the save sheet opens');
  assert.ok(sheet.querySelector('button.primary').disabled, 'a name is needed');
  typeInto(sheet.querySelector('input[type=text]'), '  Corner crimp  ');
  const slider = sheet.querySelector('input[type=range]');
  typeInto(slider, '7'); // stop 7 is V6
  click(sheet.querySelectorAll('.star-btn')[3]); // four stars
  typeInto(sheet.querySelector('textarea'), 'Stay low');
  click(sheet.querySelector('button.primary'));
  await wait(200);
  const [saved] = await repo.listClimbs('test-wall');
  assert.eq(saved.holds, '1:start,3:hand,9:foot');
  assert.eq([saved.name, saved.grade, saved.stars, saved.comment], ['Corner crimp', 6, 4, 'Stay low']);
  assert.eq(visits.at(-1), ['replace', `/climb/${saved.id}`]);
  assert.ok(!document.querySelector('.sheet'), 'the sheet closes');
  screen.destroy();
});

test('editor: the eye button hides and shows the outlines; Clear all empties the climb', async () => {
  const { root } = await freshApp();
  await mountEditor(root, { id: 'new' });
  const view = root.querySelector('.wallview').wallView;
  assert.eq(view.paint.outlineOthers, true);
  click(root.querySelector('[aria-label="Hide hold outlines"]'));
  assert.eq(view.paint.outlineOthers, false);
  click(root.querySelector('[aria-label="Show hold outlines"]'));
  assert.eq(view.paint.outlineOthers, true);
  view.renderNow();
  tap(view.canvas, ...screenPoint(view, view.wall.holds[0]));
  assert.eq(Object.keys(view.marks).length, 1);
  click(buttonWith(root, 'Clear all'));
  assert.eq(Object.keys(view.marks).length, 0);
});

test('editor: changing an existing climb keeps it one climb and keeps its setter', async () => {
  const { repo, root, visits } = await freshApp();
  await repo.setMeta('author', 'Leander');
  const made = await repo.saveClimb(climbData());
  await mountEditor(root, { id: made.id });
  const view = root.querySelector('.wallview').wallView;
  view.renderNow();
  assert.eq(Object.keys(view.marks).length, 2);
  click(buttonWith(root, 'Hand'));
  tap(view.canvas, ...screenPoint(view, view.wall.holds[7]));
  click(buttonWith(root, 'Save'));
  const sheet = document.querySelector('.sheet');
  assert.eq(sheet.querySelector('input[type=text]').value, 'First');
  click(sheet.querySelector('button.primary'));
  await wait(200);
  const all = await repo.listClimbs('test-wall');
  assert.eq(all.length, 1);
  assert.eq(all[0].holds, '1:start,5:hand,8:hand');
  assert.eq(all[0].author, 'Leander');
  assert.eq(visits.at(-1), ['back', `/climb/${made.id}`]);
});

// ---- the list ----

test('list: shows climbs, searches, sorts, and opens one', async () => {
  const { repo, root, visits } = await freshApp();
  await repo.saveClimb(climbData({ name: 'Alpha', grade: 2, stars: 1 }));
  await repo.saveClimb(climbData({ name: 'Bravo', grade: 6, stars: 5, comment: 'reachy' }));
  await repo.saveClimb(climbData({ name: 'Charlie', grade: null, stars: 3 }));
  const screen = await mountList(root);
  const names = () => [...root.querySelectorAll('.row .row-name')].map((el) => el.textContent);
  assert.eq(names(), ['Charlie', 'Bravo', 'Alpha']);
  assert.eq(root.querySelector('.bar-name').textContent, 'Test wall');
  const search = root.querySelector('input[type=search]');
  typeInto(search, 'reach');
  assert.eq(names(), ['Bravo']);
  typeInto(search, '');
  const sort = root.querySelector('select');
  sort.value = 'hardest';
  sort.dispatchEvent(new Event('change'));
  assert.eq(names(), ['Bravo', 'Alpha', 'Charlie']);
  click(root.querySelectorAll('.row')[1]);
  assert.eq(visits.at(-1)[0], 'go');
  assert.ok(visits.at(-1)[1].startsWith('/climb/'));
  typeInto(search, 'nothing matches this');
  assert.ok(root.querySelector('.empty h2').textContent.includes('Nothing matches'));
  screen.destroy();
});

test('list: with no wall it asks you to set one up; with no climbs it says so', async () => {
  const { root, visits, repo } = await freshApp({ withWall: false });
  const screen = await mountList(root);
  assert.ok(root.querySelector('.empty h2').textContent.includes('No wall yet'));
  assert.ok(root.querySelector('.fab').hidden);
  click(buttonWith(root, 'Set up a wall'));
  assert.eq(visits.at(-1), ['go', '/walls']);
  screen.destroy();
  await repo.saveWall(await testWall());
  root.replaceChildren();
  const screen2 = await mountList(root);
  assert.ok(root.querySelector('.empty h2').textContent.includes('No climbs yet'));
  screen2.destroy();
});

// ---- the viewer ----

test('viewer: shows the climb, and the arrow keys and swipes move through the list in its order', async () => {
  const { repo, root } = await freshApp();
  const a = await repo.saveClimb(climbData({ name: 'Alpha', comment: 'first one' }));
  const b = await repo.saveClimb(climbData({ name: 'Bravo' }));
  const c = await repo.saveClimb(climbData({ name: 'Charlie' }));
  const screen = await mountViewer(root, { id: b.id });
  const title = () => `${root.querySelector('.caption-name').textContent} ${root.querySelector('.bar-count').textContent}`;
  assert.eq(title(), 'Bravo 2 of 3'); // newest first: Charlie, Bravo, Alpha
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  await wait(600);
  assert.eq(title(), 'Alpha 3 of 3');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  await wait(600);
  assert.eq(title(), 'Alpha 3 of 3', 'the end of the list stays put');
  const center = root.querySelectorAll('.slide canvas')[1];
  await drag(center, [300, 300], [60, 300]);
  await drag(center, [60, 300], [300, 300]);
  await wait(700);
  assert.eq(title(), 'Bravo 2 of 3');
  screen.destroy();
  assert.ok(a && c);
});

test('viewer: a drag with the list filtered only goes through the filtered climbs', async () => {
  const { repo, root } = await freshApp();
  await repo.saveClimb(climbData({ name: 'Easy', grade: 1 }));
  const hard1 = await repo.saveClimb(climbData({ name: 'Hard one', grade: 7 }));
  await repo.saveClimb(climbData({ name: 'Hard two', grade: 8 }));
  app.query = { ...app.query, minGrade: 7, maxGrade: 17 };
  const screen = await mountViewer(root, { id: hard1.id });
  assert.ok(root.querySelector('.bar-count').textContent.endsWith('of 2'));
  screen.destroy();
});

test('viewer: the name and grade are in a small strip above the wall, and the info button shows the rest', async () => {
  const { repo, root } = await freshApp();
  await repo.setMeta('author', 'Zeke'); // a climb takes the name the app has been given for its setter
  const made = await repo.saveClimb(climbData({ name: 'Swoobap', grade: 6, stars: 4, comment: 'Directional holds.\nSomewhat powerful.' }));
  await repo.setMeta('author', '');
  const bare = await repo.saveClimb(climbData({ name: 'Bare', grade: null, stars: 0, comment: '' }));
  const screen = await mountViewer(root, { id: made.id });
  const order = [...root.children].map((el) => el.className.split(' ')[0]);
  assert.ok(order.indexOf('caption') > order.indexOf('bar') && order.indexOf('caption') < order.indexOf('pager'), `the strip sits between the bar and the wall (${order})`);
  assert.eq(root.querySelector('.caption-name').textContent, 'Swoobap');
  assert.eq(root.querySelector('.caption-grade').textContent, 'V6');
  assert.ok(!root.querySelector('.info, .info-comment'), 'there is no big panel under the wall any more');
  assert.ok(!document.querySelector('.sheet'), 'the details are hidden until the info button is pressed');

  click(root.querySelector('[aria-label="Climb info"]'));
  const sheet = document.querySelector('.sheet');
  assert.ok(sheet, 'the info button opens a panel');
  assert.eq(sheet.querySelector('h2').textContent, 'Swoobap');
  assert.eq(sheet.querySelector('.detail-grade').textContent, 'V6');
  assert.eq(sheet.querySelectorAll('.star-on').length, 4);
  assert.eq(sheet.querySelector('.detail-author').textContent, 'by Zeke');
  assert.eq(sheet.querySelector('.detail-comment').textContent, 'Directional holds.\nSomewhat powerful.');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  assert.ok(!document.querySelector('.sheet'), 'Escape closes it');
  screen.destroy();
  root.replaceChildren();

  const second = await mountViewer(root, { id: bare.id });
  assert.eq(root.querySelector('.caption-grade').textContent, '—');
  click(root.querySelector('[aria-label="Climb info"]'));
  const sheet2 = document.querySelector('.sheet');
  assert.ok(!sheet2.querySelector('.detail-author'), 'no "by" line without an author');
  assert.eq(sheet2.querySelector('.detail-comment').textContent, 'No comment.');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  second.destroy();
});

test('viewer: the eye button switches between dimmed and whole wall', async () => {
  const { repo, root } = await freshApp();
  const made = await repo.saveClimb(climbData());
  const screen = await mountViewer(root, { id: made.id });
  const center = root.querySelectorAll('.wallview')[1].wallView;
  assert.eq(center.paint.dim, 0.4);
  click(root.querySelector('[aria-label="Show the whole wall"]'));
  assert.eq(center.paint.dim, 0);
  click(root.querySelector('[aria-label="Dim the wall again"]'));
  assert.eq(center.paint.dim, 0.4);
  screen.destroy();
});

// ---- importing ----

const wire = (id, over = {}) => ({ id, name: 'Shared', grade: 4, stars: 3, comment: 'note', author: 'Zeke', holds: '1:start,2:hand', createdAt: 5000, updatedAt: 9000, ...over });
const shareOf = (climbs, key = 'test-wall') => parseShare({ format: 'spraywall-climbs', version: 1, wall: { key, name: 'Test wall' }, climbs }, 1_900_000_000_000);

test('import review: shows what is new, and Import saves it', async () => {
  const { repo, root, visits } = await freshApp();
  const mine = await repo.saveClimb(climbData({ name: 'Mine' }));
  app.pending = shareOf([wire('shared-climb-0001'), wire(mine.id, { name: 'Mine', updatedAt: 1 })]);
  const screen = await mountImporter(root, { payload: null });
  const badges = [...root.querySelectorAll('.badge')].map((b) => b.textContent);
  assert.eq(badges, ['New', 'You have a newer version']);
  const button = buttonWith(root, 'Import 1 climb');
  assert.ok(button && !button.disabled);
  click(button);
  await wait(300);
  assert.eq((await repo.listClimbs('test-wall')).map((c) => c.name).sort(), ['Mine', 'Shared']);
  assert.eq(visits.at(-1), ['replace', '/climb/shared-climb-0001']);
  screen.destroy();
});

test('import review: climbs for a wall you do not have cannot be imported, and the page says why', async () => {
  const { root, visits } = await freshApp();
  app.pending = shareOf([wire('shared-climb-0001')], 'other-wall');
  const screen = await mountImporter(root, { payload: null });
  assert.ok(root.querySelector('.banner.warn').textContent.includes('not on this phone yet'));
  assert.ok([...root.querySelectorAll('button')].find((b) => b.textContent.startsWith('Import'))?.disabled);
  click(buttonWith(root, 'Walls'));
  assert.eq(visits.at(-1), ['replace', '/walls']);
  screen.destroy();
});

test('import review: text from a stranger is shown as text, never run as HTML', async () => {
  const { root } = await freshApp();
  app.pending = shareOf([wire('shared-climb-0001', { name: '<img src=x onerror="window.__pwned=1">', comment: '<script>window.__pwned=1</script>', author: '<b>x</b>' })]);
  const screen = await mountImporter(root, { payload: null });
  await wait(50);
  assert.ok(root.querySelector('.row-name').textContent.startsWith('<img'));
  assert.eq(root.querySelector('.row-name img'), null);
  assert.eq(window.__pwned, undefined);
  screen.destroy();
});

test('import review: a damaged link shows a readable message instead of breaking', async () => {
  const { root } = await freshApp();
  const screen = await mountImporter(root, { payload: 'zAAAAAAAAAAAA' });
  assert.ok(root.querySelector('.empty h2').textContent.includes('Nothing to import'));
  assert.ok(root.querySelector('.empty p').textContent.length > 10);
  screen.destroy?.();
});

// ---- walls ----

test('walls: the list shows the wall, rename works from the dialog, and delete asks first', async () => {
  const { repo, root } = await freshApp();
  await repo.saveClimb(climbData());
  const screen = await mountWalls(root);
  assert.eq(root.querySelector('.row-name').textContent, 'Test wall');
  click(root.querySelector('[aria-label="Rename Test wall"]'));
  const dialog = document.querySelector('.dialog');
  typeInto(dialog.querySelector('input'), 'The Spray Wall');
  click(buttonWith(dialog, 'Save'));
  await wait(300);
  assert.eq((await repo.getWall('test-wall')).name, 'The Spray Wall');
  assert.eq(root.querySelector('.row-name').textContent, 'The Spray Wall');
  click(root.querySelector('[aria-label="Delete The Spray Wall"]'));
  await wait(100);
  const confirm = document.querySelector('.dialog');
  assert.ok(confirm.textContent.includes('1 climb'), 'the question says how many climbs go with it');
  click(buttonWith(confirm, 'Cancel'));
  await wait(50);
  assert.ok(await repo.getWall('test-wall'), 'cancel keeps it');
  click(root.querySelector('[aria-label="Delete The Spray Wall"]'));
  await wait(100);
  click(buttonWith(document.querySelector('.dialog'), 'Delete'));
  await wait(300);
  assert.eq(await repo.getWall('test-wall'), undefined);
  assert.eq((await repo.listClimbs('test-wall')).length, 0);
  screen.destroy();
});
