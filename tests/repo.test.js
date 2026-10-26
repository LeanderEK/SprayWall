import { assert, test } from './harness.js';
import { MemoryStore, Repo } from '../site/src/data/repo.js';
import { parseShare } from '../site/src/domain/share.js';

function setup() {
  let time = 1_000_000;
  const repo = new Repo(new MemoryStore(), () => (time += 1000));
  return { repo, tick: (ms = 1000) => (time += ms), now: () => time };
}
const wallData = (over = {}) => ({ key: 'home', name: 'AV wall', image: new Blob(['x']), imageWidth: 100, imageHeight: 200, holds: [{ id: 1, x: 0.5, y: 0.5, r: 0.02, outline: null }], angle: null, ...over });
const climbData = (over = {}) => ({ wallKey: 'home', name: 'Swoobap', grade: 6, stars: 5, comment: 'fun', holds: '1:hand', ...over });
const shared = (climbs, wallKey = 'home') =>
  parseShare({ format: 'spraywall-climbs', version: 1, wall: { key: wallKey, name: 'AV wall' }, climbs }, 1_900_000_000_000);
const wire = (id, over = {}) => ({ id, name: 'Shared', grade: 4, stars: 3, comment: '', author: 'Zeke', holds: '1:start', createdAt: 5000, updatedAt: 9000, ...over });

test('repo: a wall is saved, becomes the active one, and re-importing keeps the name you gave it', async () => {
  const { repo } = setup();
  assert.eq(await repo.activeWall(), null);
  const first = await repo.saveWall(wallData());
  assert.eq(first.updated, false);
  assert.eq((await repo.activeWall()).name, 'AV wall');
  assert.ok(await repo.renameWall('home', '  The Spray Wall '));
  const second = await repo.saveWall(wallData({ name: 'AV wall', holds: [{ id: 1, x: 0.1, y: 0.1, r: 0.02, outline: null }, { id: 2, x: 0.2, y: 0.2, r: 0.02, outline: null }] }));
  assert.eq(second.updated, true);
  const wall = await repo.getWall('home');
  assert.eq(wall.name, 'The Spray Wall');
  assert.eq(wall.holds.length, 2);
});

test('repo: renaming refuses an empty name and an unknown wall', async () => {
  const { repo } = setup();
  await repo.saveWall(wallData());
  assert.eq(await repo.renameWall('home', '   '), false);
  assert.eq(await repo.renameWall('nowhere', 'Name'), false);
  assert.eq((await repo.getWall('home')).name, 'AV wall');
  await repo.renameWall('home', 'x'.repeat(100));
  assert.eq((await repo.getWall('home')).name.length, 40);
});

test('repo: the active wall falls back to the first one if the chosen one is gone', async () => {
  const { repo } = setup();
  await repo.saveWall(wallData({ key: 'a', name: 'Alpha' }));
  await repo.saveWall(wallData({ key: 'b', name: 'Beta' }));
  assert.eq((await repo.activeWall()).key, 'b');
  await repo.setActiveWall('a');
  assert.eq((await repo.activeWall()).key, 'a');
  await repo.deleteWall('a');
  assert.eq((await repo.activeWall()).key, 'b');
});

test('repo: deleting a wall deletes its climbs but not other walls\' climbs', async () => {
  const { repo } = setup();
  await repo.saveWall(wallData({ key: 'a', name: 'A' }));
  await repo.saveWall(wallData({ key: 'b', name: 'B' }));
  await repo.saveClimb(climbData({ wallKey: 'a' }));
  await repo.saveClimb(climbData({ wallKey: 'b', name: 'Keep' }));
  await repo.deleteWall('a');
  assert.eq((await repo.listClimbs('a')).length, 0);
  assert.eq((await repo.listClimbs('b')).map((c) => c.name), ['Keep']);
});

test('repo: a new climb gets an id, the setter name and dates; editing keeps id, setter and creation date', async () => {
  const { repo } = setup();
  await repo.saveWall(wallData());
  await repo.setMeta('author', 'Leander');
  const made = await repo.saveClimb(climbData());
  assert.ok(made.id.length >= 8);
  assert.eq(made.author, 'Leander');
  assert.eq(made.createdAt, made.updatedAt);
  await repo.setMeta('author', 'Someone else');
  const edited = await repo.saveClimb(climbData({ id: made.id, name: '  Renamed  ', comment: ' note ' }));
  assert.eq(edited.id, made.id);
  assert.eq(edited.author, 'Leander');
  assert.eq(edited.createdAt, made.createdAt);
  assert.ok(edited.updatedAt > made.updatedAt);
  assert.eq([edited.name, edited.comment], ['Renamed', 'note']);
  assert.eq((await repo.listClimbs('home')).length, 1);
});

test('repo: even two edits in the same millisecond get increasing update times', async () => {
  const repo = new Repo(new MemoryStore(), () => 5000);
  await repo.saveWall(wallData());
  const a = await repo.saveClimb(climbData());
  const b = await repo.saveClimb(climbData({ id: a.id }));
  const c = await repo.saveClimb(climbData({ id: a.id }));
  assert.ok(a.updatedAt < b.updatedAt && b.updatedAt < c.updatedAt);
});

test('repo: deleting a climb removes it from view but leaves a marker', async () => {
  const { repo } = setup();
  await repo.saveWall(wallData());
  const made = await repo.saveClimb(climbData());
  await repo.deleteClimb(made.id);
  assert.eq(await repo.getClimb(made.id), undefined);
  assert.eq((await repo.listClimbs('home')).length, 0);
  const marker = await repo.store.get('climbs', made.id);
  assert.ok(marker.deletedAt > 0);
  assert.eq(marker.holds, undefined, 'the climb itself is gone, only the marker stays');
  await repo.deleteClimb(made.id); // twice is harmless
  await repo.deleteClimb('never-existed');
});

test('repo: import plan says what will happen to each climb', async () => {
  const { repo } = setup();
  await repo.saveWall(wallData());
  const mine = await repo.saveClimb(climbData());
  const newer = mine.updatedAt + 5000;
  const yours = await repo.saveClimb(climbData({ name: 'Yours is newer' }));
  const deleted = await repo.saveClimb(climbData({ name: 'Deleted one' }));
  await repo.deleteClimb(deleted.id);
  const plan = await repo.planImport(
    shared([
      wire('brand-new-climb-1'),
      { ...wire(mine.id), name: 'Their edit', updatedAt: newer },
      { ...wire(yours.id), name: 'Older copy', updatedAt: 1500 },
      { ...wire(deleted.id), updatedAt: 1 },
    ]),
  );
  const status = Object.fromEntries(plan.items.map(({ climb, status: s }) => [climb.id, s]));
  assert.eq(status['brand-new-climb-1'], 'new');
  assert.eq(status[mine.id], 'update');
  assert.eq(status[yours.id], 'older');
  assert.eq(status[deleted.id], 'deleted');
  assert.eq(plan.wallKnown, true);
  assert.eq(plan.items.length, 4);
});

test('repo: importing the same climb twice does not duplicate it, and equal copies are "same"', async () => {
  const { repo } = setup();
  await repo.saveWall(wallData());
  const plan1 = await repo.planImport(shared([wire('shared-climb-0001')]));
  assert.eq(await repo.applyImport(plan1), { added: 1, updated: 0 });
  const plan2 = await repo.planImport(shared([wire('shared-climb-0001')]));
  assert.eq(plan2.items[0].status, 'same');
  assert.eq(await repo.applyImport(plan2), { added: 0, updated: 0 });
  assert.eq((await repo.listClimbs('home')).length, 1);
  const stored = await repo.getClimb('shared-climb-0001');
  assert.eq([stored.wallKey, stored.author, stored.updatedAt], ['home', 'Zeke', 9000], 'the sender\'s dates and name are kept');
});

test('repo: a newer shared copy updates your climb, an older one does not', async () => {
  const { repo } = setup();
  await repo.saveWall(wallData());
  await repo.applyImport(await repo.planImport(shared([wire('shared-climb-0001', { name: 'First', updatedAt: 9000 })])));
  await repo.applyImport(await repo.planImport(shared([wire('shared-climb-0001', { name: 'Edited', grade: 7, updatedAt: 12000 })])));
  assert.eq((await repo.getClimb('shared-climb-0001')).name, 'Edited');
  const result = await repo.applyImport(await repo.planImport(shared([wire('shared-climb-0001', { name: 'Stale', updatedAt: 10000 })])));
  assert.eq(result, { added: 0, updated: 0 });
  assert.eq((await repo.getClimb('shared-climb-0001')).name, 'Edited');
});

test('repo: a climb you deleted stays deleted unless it was edited afterwards', async () => {
  const { repo } = setup();
  await repo.saveWall(wallData());
  await repo.applyImport(await repo.planImport(shared([wire('shared-climb-0001', { updatedAt: 9000 })])));
  await repo.deleteClimb('shared-climb-0001');
  const old = await repo.planImport(shared([wire('shared-climb-0001', { updatedAt: 9000 })]));
  assert.eq(old.items[0].status, 'deleted');
  assert.eq(await repo.applyImport(old), { added: 0, updated: 0 });
  assert.eq((await repo.listClimbs('home')).length, 0);
  const edited = await repo.planImport(shared([wire('shared-climb-0001', { updatedAt: 1_800_000_000_000 })]));
  assert.eq(edited.items[0].status, 'new');
  await repo.applyImport(edited);
  assert.eq((await repo.listClimbs('home')).length, 1);
});

test('repo: climbs for a wall you do not have yet cannot be imported', async () => {
  const { repo } = setup();
  const plan = await repo.planImport(shared([wire('shared-climb-0001')], 'other-wall'));
  assert.eq(plan.wallKnown, false);
  await assert.rejects(repo.applyImport(plan), 'not been imported');
  assert.eq((await repo.store.all('climbs')).length, 0);
});

test('repo: exporting a wall gives a share that imports cleanly into another phone', async () => {
  const a = setup();
  await a.repo.saveWall(wallData());
  await a.repo.setMeta('author', 'Leander');
  const one = await a.repo.saveClimb(climbData({ name: 'One' }));
  await a.repo.saveClimb(climbData({ name: 'Two' }));
  const gone = await a.repo.saveClimb(climbData({ name: 'Gone' }));
  await a.repo.deleteClimb(gone.id);
  const file = await a.repo.exportWall('home');
  assert.eq(file.climbs.length, 2, 'deleted climbs are not exported');
  const b = setup();
  await b.repo.saveWall(wallData());
  const plan = await b.repo.planImport(parseShare(JSON.stringify(file), Date.now() + 1e9));
  assert.eq(plan.items.map((i) => i.status), ['new', 'new']);
  assert.eq(await b.repo.applyImport(plan), { added: 2, updated: 0 });
  const names = (await b.repo.listClimbs('home')).map((c) => c.name).sort();
  assert.eq(names, ['One', 'Two']);
  assert.eq((await b.repo.getClimb(one.id)).author, 'Leander');
});

test('repo: listeners hear about changes', async () => {
  const { repo } = setup();
  let heard = 0;
  const stop = repo.onChange(() => heard++);
  await repo.saveWall(wallData());
  await repo.saveClimb(climbData());
  assert.ok(heard >= 2);
  stop();
  const before = heard;
  await repo.saveClimb(climbData());
  assert.eq(heard, before);
});

test('repo: a wall keeps its faces, and a wall saved without any has none', async () => {
  const { repo } = setup();
  await repo.saveWall(wallData({ key: 'plain' }));
  assert.eq((await repo.getWall('plain')).sections, []);
  const sections = [{ name: 'Left wall', angle: 90, x0: 0, x1: 0.5 }, { name: 'Right panel', angle: null, x0: 0.5, x1: 1 }];
  await repo.saveWall(wallData({ key: 'long', sections }));
  assert.eq((await repo.getWall('long')).sections, sections);
  await repo.saveWall(wallData({ key: 'long', sections: [sections[0]] }));
  assert.eq((await repo.getWall('long')).sections, [sections[0]], 're-importing a pack replaces its faces');
});
