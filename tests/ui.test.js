import { assert, test } from './harness.js';
import { FakeFirebase } from './fakefirebase.js';
import { drag, pinch, tap } from './touch.js';
import { app } from '../site/src/app.js';
import { FirestoreRemote } from '../site/src/data/firestore.js';
import { MemoryStore, Repo } from '../site/src/data/repo.js';
import { SyncService } from '../site/src/data/sync.js';
import { parseShare } from '../site/src/domain/share.js';
import { Viewport } from '../site/src/domain/viewport.js';
import { mountEditor } from '../site/src/ui/editor.js';
import { mountImporter } from '../site/src/ui/importer.js';
import { mountList } from '../site/src/ui/list.js';
import { openSharingSheet } from '../site/src/ui/sharing.js';
import { askForUsername } from '../site/src/ui/username.js';
import { openSyncSheet } from '../site/src/ui/syncsheet.js';
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
  await repo.setUsername('Tester');
  const wall = await testWall();
  if (withWall) await repo.saveWall(wall);
  const visits = [];
  app.repo = repo;
  app.query = { text: '', minGrade: 0, maxGrade: 17, minStars: 0, scope: 'all', sort: 'newest' };
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
  assert.ok(!sheet.querySelector('.star-btn'), 'there are no stars to set: a rating belongs to each person');
  typeInto(sheet.querySelector('textarea'), 'Stay low');
  click(sheet.querySelector('button.primary'));
  await wait(200);
  const [saved] = await repo.listClimbs('test-wall');
  assert.eq(saved.holds, '1:start,3:hand,9:foot');
  assert.eq([saved.name, saved.grade, saved.comment, 'stars' in saved, saved.author, saved.publishedAt], ['Corner crimp', 6, 'Stay low', false, 'Tester', undefined]);
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

test('viewer: the name and grade are in a small strip above the wall, and the info button shows the rest and lets you rate', async () => {
  const { repo, root } = await freshApp();
  await repo.setUsername('Zeke');
  const made = await repo.saveClimb(climbData({ name: 'Swoobap', grade: 6, comment: 'Directional holds.\nSomewhat powerful.' }));
  const bare = await repo.saveClimb(climbData({ name: 'Bare', grade: null, comment: '' }));
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
  assert.ok(sheet.querySelector('.detail-by').textContent.includes('by Zeke') && sheet.querySelector('.detail-by .tag').textContent === 'Draft');
  assert.eq(sheet.querySelector('.detail-comment').textContent, 'Directional holds.\nSomewhat powerful.');
  assert.eq(sheet.querySelectorAll('.star-on').length, 0, 'you have not rated it yet');
  click(sheet.querySelectorAll('.star-btn')[3]); // four stars
  await wait(100);
  assert.eq(await repo.getRating(made.id), 4, 'the rating is saved on this phone');
  assert.eq(sheet.querySelectorAll('.star-on').length, 4);
  click(sheet.querySelectorAll('.star-btn')[3]); // the same star again takes the rating away
  await wait(100);
  assert.eq(await repo.getRating(made.id), 0);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  assert.ok(!document.querySelector('.sheet'), 'Escape closes it');
  screen.destroy();
  root.replaceChildren();

  const second = await mountViewer(root, { id: bare.id });
  assert.eq(root.querySelector('.caption-grade').textContent, '—');
  click(root.querySelector('[aria-label="Climb info"]'));
  assert.eq(document.querySelector('.sheet .detail-comment').textContent, 'No comment.');
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

// ---- sync ----

/** The app's sync, talking to a stand-in for Firebase. */
function syncWith(repo, backend = new FakeFirebase()) {
  const tokens = { load: () => repo.getMeta('syncAuth'), save: (auth) => repo.setMetaQuietly('syncAuth', auth) };
  const remote = new FirestoreRemote({ config: { apiKey: backend.apiKey, projectId: backend.projectId }, tokens, fetchImpl: backend.fetch, now: () => backend.clock.now });
  app.sync = new SyncService({ repo, remote, now: () => backend.clock.now });
  return backend;
}
const topSheet = () => [...document.querySelectorAll('.sheet')].at(-1);

test('sync sheet: with no Firebase project the share sheet does not mention sync, and the panel says so', async () => {
  const { repo } = await freshApp();
  app.sync = new SyncService({ repo, remote: null });
  await openSharingSheet();
  assert.ok(!topSheet().textContent.includes('Sync with friends'));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await openSyncSheet();
  assert.ok(topSheet().textContent.includes('not switched on'));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  app.sync = null;
});

test('sync sheet: starting a board shows its code and how it went, and stopping goes back to the start', async () => {
  const { repo } = await freshApp();
  const backend = syncWith(repo);
  await repo.saveClimb(climbData({ name: 'Sent along' }));
  await openSharingSheet();
  assert.ok(topSheet().textContent.includes('Sync with friends'));
  click(buttonWith(topSheet(), 'Set up sync'));
  await wait(100);
  assert.eq(topSheet().querySelector('h2').textContent, 'Sync with friends');
  click(buttonWith(topSheet(), 'Start a board'));
  await wait(400);
  const code = topSheet().querySelector('.board-code').textContent;
  assert.ok(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/.test(code), code);
  assert.ok(topSheet().textContent.includes('Synced just now'), topSheet().textContent);
  assert.eq([...backend.docs.keys()].filter((path) => path.includes('/climbs/')).length, 0, 'starting a board uploads nothing by itself');
  assert.eq((await repo.getSyncSetup('test-wall')).code, code.replaceAll('-', ''));
  assert.ok(buttonWith(topSheet(), 'Copy') && buttonWith(topSheet(), 'Share') && buttonWith(topSheet(), 'Check for new climbs'));

  click(buttonWith(topSheet(), 'Stop syncing on this phone'));
  await wait(50);
  click(buttonWith(document.querySelector('.dialog'), 'Stop syncing'));
  await wait(200);
  assert.ok(buttonWith(topSheet(), 'Start a board'), 'back to the start');
  assert.eq(await repo.getSyncSetup('test-wall'), undefined);
  assert.eq((await repo.listClimbs('test-wall')).length, 1, 'the climbs stay');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  app.sync = null;
});

test('sync sheet: a wrong code, a code nobody has, and no connection are each explained', async () => {
  const { repo } = await freshApp();
  const backend = syncWith(repo);
  await openSyncSheet();
  const input = topSheet().querySelector('input[aria-label="Board code"]');
  typeInto(input, 'hello');
  click(buttonWith(topSheet(), 'Join'));
  await wait(200);
  assert.ok(topSheet().textContent.includes('does not look like a board code'), topSheet().textContent);
  typeInto(topSheet().querySelector('input[aria-label="Board code"]'), 'abcd-efgh-jkmn-pqrs');
  click(buttonWith(topSheet(), 'Join'));
  await wait(300);
  assert.ok(topSheet().textContent.includes('no board with that code'), topSheet().textContent);
  backend.offline = true;
  click(buttonWith(topSheet(), 'Start a board'));
  await wait(300);
  assert.ok(topSheet().textContent.includes('no connection'), topSheet().textContent);
  assert.eq(await repo.getSyncSetup('test-wall'), undefined, 'nothing was set up');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  app.sync = null;
});

// ---- usernames, drafts, uploading ----

test('username: asked for until a good one is given, with no way to skip it', async () => {
  const { root } = await freshApp();
  const saved = [];
  const waiting = askForUsername(async (name) => {
    if (name === 'taken') throw new Error('Not that one.');
    saved.push(name);
    return name;
  });
  const dialog = document.querySelector('.dialog');
  assert.ok(dialog.textContent.includes('Choose a username') && dialog.textContent.includes('cannot be changed'));
  assert.ok(!buttonWith(dialog, 'Cancel'), 'there is no way to skip it');
  click(buttonWith(dialog, 'Continue'));
  assert.ok(dialog.querySelector('[role=alert]').textContent.includes('2 to 20'), 'an empty name is refused');
  typeInto(dialog.querySelector('input'), 'x');
  click(buttonWith(dialog, 'Continue'));
  assert.ok(dialog.querySelector('[role=alert]').textContent.includes('2 to 20'), 'a one-letter name is refused');
  typeInto(dialog.querySelector('input'), 'taken');
  click(buttonWith(dialog, 'Continue'));
  await wait(50);
  assert.eq(dialog.querySelector('[role=alert]').textContent, 'Not that one.', 'a reason from saving is shown');
  assert.ok(document.querySelector('.dialog'), 'and it stays');
  typeInto(dialog.querySelector('input'), '  Zeke  B ');
  click(buttonWith(dialog, 'Continue'));
  assert.eq(await waiting, 'Zeke B');
  assert.eq(saved, ['Zeke B']);
  assert.ok(!document.querySelector('.dialog'), 'then it goes');
  root.replaceChildren();
});

test('list: drafts are marked, your own stars show, and the Show filter finds your climbs and your drafts', async () => {
  const { repo, root } = await freshApp();
  const draft = await repo.saveClimb(climbData({ name: 'My draft' }));
  await repo.markPublished((await repo.saveClimb(climbData({ name: 'My uploaded' }))).id);
  await repo.applyPublished('test-wall', [{ id: 'friends-climb1', name: 'Friend climb', grade: 3, comment: '', author: 'Zeke', holds: '1:hand', createdAt: 5, updatedAt: 5, serverTime: 's' }]);
  await repo.setRating(draft.id, 3);
  const screen = await mountList(root);
  const rowFor = (name) => [...root.querySelectorAll('.row')].find((row) => row.querySelector('.row-name').textContent === name);
  const names = () => [...root.querySelectorAll('.row .row-name')].map((el) => el.textContent).sort();
  assert.eq(names(), ['Friend climb', 'My draft', 'My uploaded']);
  assert.eq(rowFor('My draft').querySelectorAll('.star-on').length, 3, 'the stars shown are your own rating');
  assert.eq(rowFor('Friend climb').querySelectorAll('.star-on').length, 0);
  assert.ok(rowFor('My draft').querySelector('.badge').textContent === 'Draft');
  assert.ok(!rowFor('My uploaded').querySelector('.badge') && !rowFor('Friend climb').querySelector('.badge'), 'only drafts are marked');
  assert.ok(rowFor('Friend climb').textContent.includes('by Zeke'));

  const filtersButton = () => [...root.querySelectorAll('button.chip')].find((button) => button.textContent.includes('Filters') || button.textContent.includes('My ') || button.textContent.includes('All'));
  click(filtersButton());
  const sheet = document.querySelector('.sheet');
  click(buttonWith(sheet, 'My climbs'));
  assert.eq(names(), ['My draft', 'My uploaded']);
  click(buttonWith(sheet, 'My drafts'));
  assert.eq(names(), ['My draft']);
  assert.ok(filtersButton().textContent.includes('My drafts'), 'the filter button says what is on');
  click(buttonWith(sheet, 'All climbs'));
  assert.eq(names().length, 3);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  screen.destroy();
});

test('viewer: a draft of yours can be uploaded after a warning, and then it can no longer be edited or deleted', async () => {
  const { repo, root } = await freshApp();
  const backend = syncWith(repo);
  const made = await repo.saveClimb(climbData({ name: 'Mine' }));
  await app.sync.createBoard('test-wall');
  const screen = await mountViewer(root, { id: made.id });
  const edit = root.querySelector('[aria-label="Edit climb"]');
  const remove = root.querySelector('[aria-label="Delete climb"]');
  assert.ok(!edit.hidden && !remove.hidden, 'a draft can be edited and deleted');
  assert.ok(buttonWith(root, 'Upload') && !root.querySelector('.caption .tag'));

  click(buttonWith(root, 'Upload'));
  await wait(100);
  const ask = document.querySelector('.dialog');
  assert.ok(ask.textContent.includes('nobody can edit or delete it'), ask.textContent);
  click(buttonWith(ask, 'Cancel'));
  await wait(50);
  assert.ok(!(await repo.getClimb(made.id)).publishedAt, 'cancel uploads nothing');

  click(buttonWith(root, 'Upload'));
  await wait(100);
  click(buttonWith(document.querySelector('.dialog'), 'Upload'));
  await wait(400);
  assert.ok((await repo.getClimb(made.id)).publishedAt, 'it is uploaded');
  assert.eq([...backend.docs.keys()].filter((path) => path.endsWith(`/climbs/${made.id}`)).length, 1);
  assert.eq(root.querySelector('.caption .tag').textContent, 'Uploaded');
  assert.ok(!buttonWith(root, 'Upload'), 'no second upload');
  assert.ok(edit.hidden && remove.hidden, 'Edit and Delete are gone');
  assert.ok(document.querySelector('.toast').textContent.includes('Uploaded'));
  screen.destroy();
  app.sync = null;
});

test('viewer: a friend\'s climb has no Upload, Edit or Delete; with no board yet, Upload leads to the board panel', async () => {
  const { repo, root } = await freshApp();
  syncWith(repo);
  await repo.applyPublished('test-wall', [{ id: 'friends-climb1', name: 'Friend climb', grade: 3, comment: '', author: 'Zeke', holds: '1:hand', createdAt: 5, updatedAt: 5, serverTime: 's' }]);
  const screen = await mountViewer(root, { id: 'friends-climb1' });
  assert.ok(!buttonWith(root, 'Upload'));
  assert.ok(root.querySelector('[aria-label="Edit climb"]').hidden && root.querySelector('[aria-label="Delete climb"]').hidden);
  assert.eq(root.querySelector('.caption .tag').textContent, 'Uploaded');
  screen.destroy();
  root.replaceChildren();

  const draft = await repo.saveClimb(climbData({ name: 'No board yet' }));
  const second = await mountViewer(root, { id: draft.id });
  click(buttonWith(root, 'Upload'));
  await wait(200);
  assert.eq(document.querySelector('.sheet h2').textContent, 'Sync with friends', 'it opens the board panel');
  assert.ok(buttonWith(document.querySelector('.sheet'), 'Start a board'));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  second.destroy();
  app.sync = null;
});

test('editor: an uploaded climb cannot be opened for editing, even by its address', async () => {
  const { repo, root } = await freshApp();
  const made = await repo.markPublished((await repo.saveClimb(climbData({ name: 'Final' }))).id);
  const screen = await mountEditor(root, { id: made.id });
  assert.ok(root.querySelector('.empty h2').textContent.includes('uploaded'));
  assert.ok(!root.querySelector('.wallview'), 'there is no editor');
  screen.destroy?.();
});

test('share sheet: shows your username, which can be changed until you upload, then is locked', async () => {
  const { repo } = await freshApp();
  await openSharingSheet();
  assert.eq(topSheet().querySelector('.username').textContent, 'Tester');
  click(buttonWith(topSheet(), 'Change'));
  await wait(50);
  typeInto(document.querySelector('.dialog input'), 'Tester Two');
  click(buttonWith(document.querySelector('.dialog'), 'Save'));
  await wait(200);
  assert.eq(await repo.authorName(), 'Tester Two');
  const made = await repo.saveClimb(climbData());
  await repo.markPublished(made.id);
  await openSharingSheet();
  assert.ok(!buttonWith(topSheet(), 'Change') && topSheet().textContent.includes('Locked'));
  assert.ok(topSheet().textContent.includes('can no longer be changed'));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
});
