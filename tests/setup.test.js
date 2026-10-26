import { assert, test } from './harness.js';
import { FakeFirebase } from './fakefirebase.js';
import { FirestoreRemote } from '../site/src/data/firestore.js';
import { MemoryStore, Repo } from '../site/src/data/repo.js';
import { SyncService } from '../site/src/data/sync.js';
import { DEFAULTS, MEMORY } from '../site/src/defaults.js';
import { parseBoardCode } from '../site/src/domain/sync.js';
import { downloadPack, ensureDefaults, ensureIdentity, installDefaultWall } from '../site/src/setup.js';

// What happens when the app opens: who you are, and the default wall and board.

const WALL = { key: 'av-wall', name: 'AV wall', image: null, imageWidth: 10, imageHeight: 10, holds: [{ id: 1, x: 0.5, y: 0.5, r: 0.02, outline: null }], angle: null };
const tick = (backend, seconds = 5) => { backend.clock.now += seconds * 1000; };

/** A phone with nothing on it yet, and the app's sync pointing at `backend` (or with no Firebase at all). */
function freshPhone(backend) {
  const clock = backend?.clock ?? { now: 1_800_000_000_000 };
  const repo = new Repo(new MemoryStore(), () => clock.now);
  let remote = null;
  if (backend) {
    const tokens = { load: () => repo.getMeta('syncAuth'), save: (auth) => repo.setMetaQuietly('syncAuth', auth) };
    remote = new FirestoreRemote({ config: { apiKey: backend.apiKey, projectId: backend.projectId }, tokens, fetchImpl: backend.fetch, now: () => clock.now });
  }
  const sync = new SyncService({ repo, remote, now: () => clock.now, delays: { first: 10_000, afterChange: 10_000, whileOpen: 100_000 } });
  return { repo, sync, clock };
}

/** Stand-ins for downloading and importing the wall pack, with a log of what was asked. */
function stubs(log = []) {
  return {
    log,
    fetchPack: async (url) => {
      log.push(`download ${url}`);
      return new Blob(['a zip']);
    },
    importPack: async (blob, repo) => {
      log.push('import');
      return repo.saveWall(WALL);
    },
  };
}

/** A board for the AV wall with one uploaded climb, made by somebody else. Returns its code. */
async function boardWithOneClimb(backend) {
  const other = freshPhone(backend);
  await other.repo.saveWall(WALL);
  await other.sync.signUp('alex', 'alex-password');
  const code = await other.sync.createBoard('av-wall');
  const climb = await other.repo.saveClimb({ wallKey: 'av-wall', name: 'On the board', grade: 4, comment: '', holds: '1:start' });
  await other.sync.upload(climb.id);
  tick(backend);
  return code;
}

const config = (code) => ({ wall: { key: 'av-wall', pack: 'wall/av-wall.zip' }, board: { wallKey: 'av-wall', code } });

test('defaults: the app is set up for the AV wall and its open board', () => {
  assert.eq(DEFAULTS.wall, { key: 'av-wall', pack: 'wall/av-wall.zip' });
  assert.eq(DEFAULTS.board.wallKey, 'av-wall');
  assert.eq(parseBoardCode(DEFAULTS.board.code), 'mh6gp7rt2aajh5jp', 'the board code is a valid code');
});

// ---- who you are ----

test('start-up: a signed-in account is used as it is, without asking anything', async () => {
  const backend = new FakeFirebase();
  const a = freshPhone(backend);
  await a.sync.signUp('alex', 'alex-password');
  const b = freshPhone(backend);
  await b.sync.signIn('alex', 'alex-password');
  const asked = [];
  const outcome = await ensureIdentity({ repo: b.repo, sync: b.sync, askForAccount: async (options) => asked.push(options), askForUsername: async () => asked.push('name') });
  assert.eq([outcome, await b.repo.authorName(), asked.length], ['account', 'alex', 0]);
});

test('start-up: a new user is offered the account dialog with a Later button, and Later is remembered', async () => {
  const backend = new FakeFirebase();
  const { repo, sync } = freshPhone(backend);
  const asked = [];
  const ask = (answer) => async (options) => {
    asked.push({ canSkip: options.canSkip, suggest: options.suggest });
    return answer;
  };
  assert.eq(await ensureIdentity({ repo, sync, askForAccount: ask(null), askForUsername: async () => assert.ok(false, 'no local name box when there are accounts') }), 'skipped');
  assert.eq(asked, [{ canSkip: true, suggest: '' }], 'Later is on offer, even to a brand-new user');
  assert.eq(await repo.getMeta('accountSkipped'), true);
  assert.eq(await ensureIdentity({ repo, sync, askForAccount: ask(null), askForUsername: async () => {} }), 'skipped');
  assert.eq(asked.length, 1, 'not asked again every time the app opens');

  const another = freshPhone(backend);
  assert.eq(await ensureIdentity({ repo: another.repo, sync: another.sync, askForAccount: ask('bob'), askForUsername: async () => {} }), 'account');
});

test('start-up: a phone that already has a name suggests it, and keeps it when the account is skipped', async () => {
  const backend = new FakeFirebase();
  const { repo, sync } = freshPhone(backend);
  await repo.saveWall(WALL);
  await repo.setUsername('leander');
  const asked = [];
  await ensureIdentity({ repo, sync, askForAccount: async (options) => { asked.push(options.suggest); return null; }, askForUsername: async () => {} });
  assert.eq([asked, await repo.authorName()], [['leander'], 'leander']);
});

test('start-up: with no Firebase project a name is asked for once and that is all', async () => {
  const { repo, sync } = freshPhone(null);
  let asks = 0;
  const askForUsername = async (save) => {
    asks++;
    return save('typed-name');
  };
  assert.eq(await ensureIdentity({ repo, sync, askForAccount: async () => assert.ok(false), askForUsername }), 'local');
  assert.eq([asks, await repo.authorName()], [1, 'typed-name']);
  await ensureIdentity({ repo, sync, askForAccount: async () => assert.ok(false), askForUsername });
  assert.eq(asks, 1);
});

// ---- the default wall and board ----

test('defaults: a new phone gets the wall at once, and the board as soon as there is an account', async () => {
  const backend = new FakeFirebase();
  const code = await boardWithOneClimb(backend);
  const { repo, sync } = freshPhone(backend);
  const { log, fetchPack, importPack } = stubs();
  const steps = [];
  const progress = (text) => steps.push(text);

  let result = await ensureDefaults({ repo, sync, config: config(code), fetchPack, importPack, progress });
  assert.eq([result.wall, result.board, result.problem], ['imported', 'waiting', '']);
  assert.eq(log, ['download wall/av-wall.zip', 'import']);
  assert.eq(steps, ['Downloading the AV wall…', 'Adding the AV wall…']);
  assert.eq((await repo.activeWall()).key, 'av-wall');
  assert.eq(await repo.getSyncSetup('av-wall'), undefined, 'no board without an account');

  await sync.signUp('bea', 'bea-password'); // she makes an account later
  result = await ensureDefaults({ repo, sync, config: config(code), fetchPack, importPack, progress });
  assert.eq([result.wall, result.board], ['had', 'joined']);
  assert.eq((await repo.getSyncSetup('av-wall')).code, parseBoardCode(code));
  assert.eq((await repo.listClimbs('av-wall')).map((c) => c.name), ['On the board'], 'the shared climbs arrived');
  assert.eq(log.length, 2, 'the wall was not downloaded again');
  assert.eq(steps.at(-1), 'Joining the AV board…');

  result = await ensureDefaults({ repo, sync, config: config(code), fetchPack, importPack });
  assert.eq([result.wall, result.board], ['had', 'had']);
});

test('defaults: signing in with the account first, the wall and the board come in one go', async () => {
  const backend = new FakeFirebase();
  const code = await boardWithOneClimb(backend);
  const { repo, sync } = freshPhone(backend);
  await sync.signUp('bea', 'bea-password');
  const { fetchPack, importPack } = stubs();
  const result = await ensureDefaults({ repo, sync, config: config(code), fetchPack, importPack });
  assert.eq([result.wall, result.board], ['imported', 'joined']);
  assert.eq((await repo.listClimbs('av-wall')).length, 1);
});

test('defaults: a wall you deleted does not come back, and a board you left is not joined again', async () => {
  const backend = new FakeFirebase();
  const code = await boardWithOneClimb(backend);
  const { repo, sync } = freshPhone(backend);
  await sync.signUp('bea', 'bea-password');
  const { log, fetchPack, importPack } = stubs();
  await ensureDefaults({ repo, sync, config: config(code), fetchPack, importPack });

  await sync.stop('av-wall');
  let result = await ensureDefaults({ repo, sync, config: config(code), fetchPack, importPack });
  assert.eq(result.board, 'stopped', 'leaving the board is final');
  assert.eq(await repo.getSyncSetup('av-wall'), undefined);

  await repo.deleteWall('av-wall');
  result = await ensureDefaults({ repo, sync, config: config(code), fetchPack, importPack });
  assert.eq([result.wall, result.board, log.length], ['skipped', 'skipped', 2], 'nothing is added again');
  assert.eq(await repo.getWall('av-wall'), undefined);

  const manual = await installDefaultWall({ repo, config: config(code), fetchPack, importPack });
  assert.eq(manual.key, 'av-wall', 'but it can always be fetched by hand (Walls, Get the AV wall)');
});

test('defaults: with no connection nothing is lost: it says so and tries again next time', async () => {
  const backend = new FakeFirebase();
  const code = await boardWithOneClimb(backend);
  const { repo, sync } = freshPhone(backend);
  await sync.signUp('bea', 'bea-password');
  const failing = async () => { throw new TypeError('Failed to fetch'); };
  const good = stubs();
  let result = await ensureDefaults({ repo, sync, config: config(code), fetchPack: failing, importPack: good.importPack });
  assert.eq(result.wall, 'failed');
  assert.ok(result.problem.includes('Could not download the wall'), result.problem);
  assert.eq(await repo.getMeta(MEMORY.wall), undefined, 'not marked as done');
  result = await ensureDefaults({ repo, sync, config: config(code), ...good });
  assert.eq([result.wall, result.board], ['imported', 'joined']);

  // a board that cannot be joined yet (here: no such board) is tried again next time too
  const second = freshPhone(backend);
  await second.sync.signUp('cyrus', 'cyrus-password');
  result = await ensureDefaults({ repo: second.repo, sync: second.sync, config: config('abcd-efgh-jkmn-pqrs'), ...good });
  assert.eq([result.wall, result.board], ['imported', 'failed']);
  assert.ok(result.problem.includes('no board with that code'), result.problem);
  assert.eq(await second.repo.getMeta(MEMORY.board), undefined);
  result = await ensureDefaults({ repo: second.repo, sync: second.sync, config: config(code), ...good });
  assert.eq(result.board, 'joined');
});

test('defaults: a phone that already has the wall and a board is left exactly as it is', async () => {
  const backend = new FakeFirebase();
  const { repo, sync } = freshPhone(backend);
  await sync.signUp('alex', 'alex-password');
  await repo.saveWall(WALL);
  const mine = await sync.createBoard('av-wall'); // the owner's own board, made before there were defaults
  const { log, fetchPack, importPack } = stubs();
  const result = await ensureDefaults({ repo, sync, config: config('mh6g-p7rt-2aaj-h5jp'), fetchPack, importPack });
  assert.eq([result.wall, result.board, log.length], ['had', 'had', 0]);
  assert.eq((await repo.getSyncSetup('av-wall')).code, mine, 'it keeps its own board');
});

test('defaults: with no Firebase the wall is still set up, and there is no board to join', async () => {
  const { repo, sync } = freshPhone(null);
  const { fetchPack, importPack } = stubs();
  const result = await ensureDefaults({ repo, sync, config: config('mh6g-p7rt-2aaj-h5jp'), fetchPack, importPack });
  assert.eq([result.wall, result.board], ['imported', 'skipped']);
});

test('defaults: the real wall pack downloads from the site and imports with its 524 holds', async () => {
  const { repo, sync } = freshPhone(null);
  const result = await ensureDefaults({ repo, sync, config: config('mh6g-p7rt-2aaj-h5jp'), fetchPack: () => downloadPack('/wall/av-wall.zip') });
  assert.eq(result.wall, 'imported');
  const wall = await repo.getWall('av-wall');
  assert.eq([wall.name, wall.holds.length, wall.imageWidth > 1000], ['AV wall', 524, true]);
  await assert.rejects(downloadPack('/wall/no-such-pack.zip'), 'the download failed (404)');
});
