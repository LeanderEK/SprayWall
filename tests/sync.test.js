import { assert, test } from './harness.js';
import { FakeFirebase } from './fakefirebase.js';
import { FirestoreRemote } from '../site/src/data/firestore.js';
import { MemoryStore, Repo } from '../site/src/data/repo.js';
import { SyncService } from '../site/src/data/sync.js';
import {
  BOARD_ALPHABET, SyncError, cleanRemote, decideRemote, fromFields, makeBoardCode, parseBoardCode, showBoardCode, stampValue, toFields, toRecord,
} from '../site/src/domain/sync.js';
import { parseShare } from '../site/src/domain/share.js';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const WALL = { key: 'home-wall', name: 'Home wall', image: null, imageWidth: 10, imageHeight: 10, holds: [], angle: null };
const climbData = (over = {}) => ({ wallKey: 'home-wall', name: 'One', grade: 4, stars: 3, comment: '', holds: '1:start,5:hand', ...over });
const kindOf = async (promise) => {
  try {
    await promise;
    return 'none';
  } catch (error) {
    return error.kind || `not a SyncError: ${error.message}`;
  }
};

// ---- board codes ----

test('sync: a board code is 16 letters and digits that cannot be mixed up, written in four groups', () => {
  const code = makeBoardCode();
  assert.eq(code.length, 16);
  assert.ok([...code].every((letter) => BOARD_ALPHABET.includes(letter)), code);
  assert.ok(!/[ilo01]/.test(BOARD_ALPHABET), 'no look-alike characters');
  assert.eq(showBoardCode('abcdefghjkmnpqrs'), 'abcd-efgh-jkmn-pqrs');
  assert.eq(new Set(Array.from({ length: 200 }, () => makeBoardCode())).size, 200);
  let calls = 0;
  const skipped = makeBoardCode(() => {
    calls++;
    return new Uint8Array(32).fill(calls === 1 ? 255 : 0); // 255 would favour some letters, so it is passed over
  });
  assert.eq(skipped, 'a'.repeat(16));
});

test('sync: a typed or pasted code is understood in any case, with spaces or dashes, or inside a message', () => {
  assert.eq(parseBoardCode('k7f2-9xqm-c4ta-p8dn'), 'k7f29xqmc4tap8dn');
  assert.eq(parseBoardCode('  K7F2 9XQM C4TA P8DN '), 'k7f29xqmc4tap8dn');
  assert.eq(parseBoardCode('k7f29xqmc4tap8dn'), 'k7f29xqmc4tap8dn');
  assert.eq(parseBoardCode('Join my board: k7f2-9xqm-c4ta-p8dn thanks!'), 'k7f29xqmc4tap8dn');
  for (const wrong of ['', 'hello', 'k7f2-9xqm-c4ta', 'k7f2-9xqm-c4ta-p8d0', 'k7f2-9xqm-c4ta-p8dn-aaaa', '../../etc/passwd']) {
    assert.throws(() => parseBoardCode(wrong), 'board code');
  }
});

// ---- how climbs are written to and read from the database ----

test('sync: a climb survives being written as database fields and read back; only the climb fields are taken', () => {
  const climb = { id: 'abc-12345678', wallKey: 'home-wall', name: 'Swoobap', grade: 6, stars: 5, comment: 'hi', author: 'Zeke', holds: '1:hand', createdAt: 1792774888771, updatedAt: 1792774913178, syncMark: 'x:1' };
  const record = toRecord(climb);
  assert.eq(Object.keys(record), ['id', 'name', 'grade', 'stars', 'comment', 'author', 'holds', 'createdAt', 'updatedAt']);
  const fields = toFields(record);
  assert.eq(fields.createdAt, { integerValue: '1792774888771' });
  assert.eq(fields.name, { stringValue: 'Swoobap' });
  assert.eq(fromFields(fields), record);
  assert.ok(!('grade' in toFields(toRecord({ ...climb, grade: null }))), 'no grade is no field');
  const gone = toRecord({ id: 'abc-12345678', wallKey: 'home-wall', name: 'Swoobap', deletedAt: 5000, updatedAt: 5000 });
  assert.eq(gone, { id: 'abc-12345678', name: 'Swoobap', deletedAt: 5000, updatedAt: 5000 });
  const sneaky = fromFields(JSON.parse('{"__proto__":{"stringValue":"x"},"constructor":{"stringValue":"y"},"evil":{"stringValue":"z"},"name":{"stringValue":"ok"},"serverTime":{"timestampValue":"2026-10-25T10:00:00.123456Z"}}'));
  assert.eq(sneaky, { name: 'ok', serverTime: '2026-10-25T10:00:00.123456Z' });
  assert.ok(Object.getPrototypeOf(sneaky) === Object.prototype, 'nothing slips in through the prototype');
});

test('sync: time stamps with any number of decimals compare exactly', () => {
  assert.ok(stampValue('2026-10-25T10:00:00.123457Z') > stampValue('2026-10-25T10:00:00.123456Z'));
  assert.ok(stampValue('2026-10-25T10:00:00Z') < stampValue('2026-10-25T10:00:00.000001Z'));
  assert.ok(stampValue('2026-10-25T10:00:00.5Z') > stampValue('2026-10-25T10:00:00.45Z'));
  assert.eq(stampValue('2026-10-25T10:00:01Z') - stampValue('2026-10-25T10:00:00Z'), 1_000_000);
  assert.ok(Number.isNaN(stampValue('yesterday')));
  assert.ok(Number.isNaN(stampValue(undefined)));
});

test('sync: whatever is on the board is checked and cleaned before the app uses it', () => {
  const record = { id: 'abc-12345678', name: '<b>x</b>'.repeat(40), grade: 99, stars: 17, comment: 'c'.repeat(5000), author: 'a'.repeat(300), holds: '3:hand,9:wobble', createdAt: NOW * 9, updatedAt: NOW * 9, serverTime: '2026-10-25T10:00:00.1Z' };
  const clean = cleanRemote(record, NOW);
  assert.eq([clean.name.length, clean.grade, clean.stars, clean.comment.length, clean.author.length, clean.holds], [80, null, 0, 2000, 40, '3:hand']);
  assert.ok(clean.updatedAt <= NOW + DAY, 'a date from the future is held to tomorrow at the latest');
  assert.eq(clean.serverTime, '2026-10-25T10:00:00.1Z');
  assert.eq(cleanRemote({ ...record, holds: 'junk' }, NOW), null);
  assert.eq(cleanRemote({ ...record, id: 'x' }, NOW), null);
  assert.eq(cleanRemote(null, NOW), null);
  const gone = cleanRemote({ id: 'abc-12345678', name: '', deletedAt: NOW * 9, updatedAt: 1, holds: 'ignored', serverTime: 's' }, NOW);
  assert.eq(gone, { id: 'abc-12345678', name: 'Deleted climb', deletedAt: NOW + DAY, updatedAt: NOW + DAY, serverTime: 's' });
});

test('sync: what to do with a climb from the board, for every pairing', () => {
  const live = (updatedAt) => ({ id: 'abc-12345678', name: 'n', updatedAt });
  const dead = (deletedAt) => ({ id: 'abc-12345678', name: 'n', deletedAt, updatedAt: deletedAt });
  assert.eq(decideRemote(undefined, live(5)), 'add');
  assert.eq(decideRemote(undefined, dead(5)), 'remember');
  assert.eq(decideRemote(live(5), live(9)), 'update');
  assert.eq(decideRemote(live(5), live(5)), 'same');
  assert.eq(decideRemote(live(9), live(5)), 'keep');
  assert.eq(decideRemote(live(5), dead(9)), 'delete');
  assert.eq(decideRemote(live(9), dead(5)), 'keep', 'an edit after the deletion wins');
  assert.eq(decideRemote(dead(5), live(9)), 'add', 'an edit after the deletion brings it back');
  assert.eq(decideRemote(dead(9), live(5)), 'keep', 'a deletion after the edit stays deleted');
  assert.eq(decideRemote(dead(5), dead(9)), 'same');
});

// ---- the repo's side of syncing ----

const freshRepo = async (clock = { now: NOW }) => {
  const repo = new Repo(new MemoryStore(), () => clock.now);
  await repo.saveWall(WALL);
  return { repo, clock };
};

test('sync: a climb needs sending until its current version is marked sent, and any change makes it need sending again', async () => {
  const { repo, clock } = await freshRepo();
  const first = await repo.saveClimb(climbData());
  assert.eq((await repo.climbsToSend('home-wall', 'boardone')).map((c) => c.id), [first.id]);
  await repo.markSent('boardone', [first]);
  assert.eq((await repo.climbsToSend('home-wall', 'boardone')).length, 0);
  assert.eq((await repo.climbsToSend('home-wall', 'boardtwo')).length, 1, 'another board does not have it');
  clock.now += 1000;
  const edited = await repo.saveClimb(climbData({ id: first.id, name: 'Changed' }));
  assert.eq((await repo.climbsToSend('home-wall', 'boardone')).length, 1);
  await repo.markSent('boardone', [first]); // the old version arriving late must not hide the edit
  assert.eq((await repo.climbsToSend('home-wall', 'boardone')).length, 1);
  await repo.markSent('boardone', [edited]);
  assert.eq((await repo.climbsToSend('home-wall', 'boardone')).length, 0);
  clock.now += 1000;
  await repo.deleteClimb(first.id);
  const [marker] = await repo.climbsToSend('home-wall', 'boardone');
  assert.ok(marker.deletedAt, 'a deletion is sent too');
});

test('sync: taking in the board\'s climbs adds, updates and deletes, and leaves newer local edits alone', async () => {
  const { repo, clock } = await freshRepo();
  const mine = await repo.saveClimb(climbData({ name: 'Mine' }));
  const doomed = await repo.saveClimb(climbData({ name: 'Doomed' }));
  const newer = await repo.saveClimb(climbData({ name: 'Newer here' }));
  const remote = (id, over) => ({ id, name: 'x', grade: 2, stars: 1, comment: '', author: '', holds: '2:hand', createdAt: 1, updatedAt: 1, serverTime: 's', ...over });
  let heard = 0;
  repo.onChange(() => heard++);
  const counts = await repo.applySynced('home-wall', 'boardone', [
    remote('fresh-climb-01', { name: 'Fresh' }),
    remote(mine.id, { name: 'Mine, edited elsewhere', updatedAt: mine.updatedAt + 5000 }),
    { id: doomed.id, name: 'Doomed', deletedAt: doomed.updatedAt + 10, updatedAt: doomed.updatedAt + 10, serverTime: 's' },
    remote(newer.id, { name: 'Older there', updatedAt: newer.updatedAt - 500 }),
    { id: 'long-gone-0001', name: 'Gone', deletedAt: 77, updatedAt: 77, serverTime: 's' },
  ]);
  assert.eq(counts, { added: 1, updated: 1, deleted: 1 });
  assert.eq(heard, 1, 'the screens are told once');
  assert.eq((await repo.listClimbs('home-wall')).map((c) => c.name).sort(), ['Fresh', 'Mine, edited elsewhere', 'Newer here']);
  assert.ok(!('serverTime' in (await repo.getClimb('fresh-climb-01'))), 'the stamp is not kept on the climb');
  assert.eq((await repo.climbsToSend('home-wall', 'boardone')).map((c) => c.name), ['Newer here'], 'only the newer local edit still needs sending');
  assert.eq(await repo.getClimb('long-gone-0001'), undefined);
  clock.now += 1;
  const again = await repo.applySynced('home-wall', 'boardone', [{ ...remote('long-gone-0001'), name: 'Old copy', updatedAt: 50 }]);
  assert.eq(again, { added: 0, updated: 0, deleted: 0 }, 'an old copy cannot bring back a deleted climb');
});

// ---- talking to the database ----

const config = (backend) => ({ apiKey: backend.apiKey, projectId: backend.projectId });
const memoryTokens = () => {
  const box = {};
  return { load: async () => box.value, save: async (value) => { box.value = structuredClone(value); }, box };
};
const remoteFor = (backend, tokens = memoryTokens()) => new FirestoreRemote({ config: config(backend), tokens, fetchImpl: backend.fetch, now: () => backend.clock.now });
const count = (backend, part) => backend.requests.filter((request) => request.includes(part)).length;
const CODE = 'k7f29xqmc4tap8dn';

test('firebase: signs in once, keeps the sign-in between visits, renews it when it runs out', async () => {
  const backend = new FakeFirebase();
  const tokens = memoryTokens();
  const remote = remoteFor(backend, tokens);
  assert.eq(await remote.getBoard(CODE), null);
  await remote.getBoard(CODE);
  assert.eq(count(backend, 'signUp'), 1, 'one sign-in however many requests');
  await remoteFor(backend, tokens).getBoard(CODE); // the app was closed and opened again
  assert.eq(count(backend, 'signUp'), 1, 'the saved sign-in is reused');
  backend.clock.now += 3700_000;
  await remoteFor(backend, tokens).getBoard(CODE);
  assert.eq([count(backend, 'signUp'), count(backend, 'v1/token')], [1, 1], 'an hour later the token is renewed, not made again');
  backend.expireTokens(); // the server stops accepting a token the app still thinks is good
  await remoteFor(backend, tokens).getBoard(CODE);
  assert.eq(count(backend, 'signUp'), 1, 'one refused request is retried with a renewed token');
  backend.revokeRefreshTokens();
  backend.clock.now += 3700_000;
  await remoteFor(backend, tokens).getBoard(CODE);
  assert.eq(count(backend, 'signUp'), 2, 'if the renewal is refused too, it signs in afresh');
});

test('firebase: problems come back as readable errors of a known kind', async () => {
  const backend = new FakeFirebase();
  backend.offline = true;
  assert.eq(await kindOf(remoteFor(backend).getBoard(CODE)), 'offline');
  backend.offline = false;
  backend.anonymousDisabled = true;
  const disabled = remoteFor(backend);
  assert.eq(await kindOf(disabled.getBoard(CODE)), 'setup');
  await assert.rejects(remoteFor(backend).getBoard(CODE), 'Anonymous sign-in is not switched on');
  backend.anonymousDisabled = false;
  const wrongKey = new FirestoreRemote({ config: { apiKey: 'wrong', projectId: backend.projectId }, tokens: memoryTokens(), fetchImpl: backend.fetch, now: () => NOW });
  await assert.rejects(wrongKey.getBoard(CODE), 'API key');
  backend.quotaUsedUp = true;
  assert.eq(await kindOf(remoteFor(backend).getBoard(CODE)), 'quota');
  backend.quotaUsedUp = false;
  const remote = remoteFor(backend);
  await remote.createBoard(CODE, { wallKey: 'home-wall', wallName: 'Home wall' });
  assert.eq(await kindOf(remote.createBoard(CODE, { wallKey: 'home-wall', wallName: 'Home wall' })), 'exists');
  assert.eq(await remote.getBoard(CODE), { wallKey: 'home-wall', wallName: 'Home wall' });
  assert.eq(await kindOf(remote.sendClimbs(CODE, [{ id: 'abc-12345678', name: 'x', stars: 9, updatedAt: 5 }])), 'denied', 'the rules refuse a climb with 9 stars');
  assert.eq(await kindOf(remote.createBoard('short', { wallKey: 'a', wallName: 'b' })), 'denied', 'and a board without a proper code');
});

// ---- two phones and one board ----

async function phone(backend) {
  const clock = backend.clock;
  const repo = new Repo(new MemoryStore(), () => clock.now);
  await repo.saveWall(WALL);
  const tokens = { load: () => repo.getMeta('syncAuth'), save: (auth) => repo.setMetaQuietly('syncAuth', auth) };
  const remote = new FirestoreRemote({ config: config(backend), tokens, fetchImpl: backend.fetch, now: () => clock.now });
  const sync = new SyncService({ repo, remote, now: () => clock.now, delays: { first: 10, afterChange: 20, whileOpen: 100_000 } });
  return { repo, sync, clock };
}
const tick = (backend, seconds = 5) => { backend.clock.now += seconds * 1000; };
const names = async (device) => (await device.repo.listClimbs('home-wall')).map((c) => c.name).sort();

test('sync: a board started on one phone is joined by another, and climbs flow both ways, edits and deletions included', async () => {
  const backend = new FakeFirebase();
  const a = await phone(backend);
  const b = await phone(backend);
  const one = await a.repo.saveClimb(climbData({ name: 'One', grade: 6, stars: 5, comment: 'Directional.', holds: '1:start,5:hand,9:finish' }));
  tick(backend);
  const two = await a.repo.saveClimb(climbData({ name: 'Two' }));
  tick(backend);
  const code = await a.sync.createBoard('home-wall');
  assert.eq(code.length, 16);
  assert.eq(a.sync.stateOf('home-wall').status, 'ok');
  assert.eq((await a.repo.climbsToSend('home-wall', code)).length, 0, 'everything was sent');

  tick(backend);
  await b.sync.joinBoard('home-wall', showBoardCode(code));
  assert.eq(await names(b), ['One', 'Two']);
  const copy = await b.repo.getClimb(one.id);
  assert.eq([copy.holds, copy.grade, copy.stars, copy.comment, copy.createdAt, copy.updatedAt], [one.holds, 6, 5, 'Directional.', one.createdAt, one.updatedAt]);
  assert.eq((await b.repo.climbsToSend('home-wall', code)).length, 0, 'nothing is sent back');

  tick(backend);
  await b.repo.saveClimb(climbData({ name: 'Three' }));
  await b.sync.syncWall('home-wall');
  tick(backend);
  await a.sync.syncWall('home-wall');
  assert.eq(await names(a), ['One', 'Three', 'Two']);

  tick(backend);
  await a.repo.saveClimb(climbData({ id: one.id, name: 'One!', grade: 7, stars: 5, comment: '', holds: one.holds }));
  await a.sync.syncWall('home-wall');
  tick(backend);
  const result = await b.sync.syncWall('home-wall');
  assert.eq((await b.repo.getClimb(one.id)).name, 'One!');
  assert.eq(result.updated, 1);

  tick(backend);
  await b.repo.deleteClimb(two.id);
  await b.sync.syncWall('home-wall');
  tick(backend);
  await a.sync.syncWall('home-wall');
  assert.eq(await names(a), ['One!', 'Three']);
});

test('sync: edits made on two phones while offline are both kept, the later edit of the same climb wins', async () => {
  const backend = new FakeFirebase();
  const a = await phone(backend);
  const b = await phone(backend);
  const shared = await a.repo.saveClimb(climbData({ name: 'Shared' }));
  const code = await a.sync.createBoard('home-wall');
  tick(backend);
  await b.sync.joinBoard('home-wall', code);

  backend.offline = true;
  tick(backend);
  await a.repo.saveClimb(climbData({ id: shared.id, name: 'A edit' }));
  await a.repo.saveClimb(climbData({ name: 'A new' }));
  tick(backend);
  await b.repo.saveClimb(climbData({ id: shared.id, name: 'B edit' }));
  assert.eq(await kindOf(a.sync.syncWall('home-wall')), 'offline');
  assert.eq(a.sync.stateOf('home-wall').status, 'offline');
  assert.eq(await kindOf(b.sync.syncWall('home-wall')), 'offline');
  backend.offline = false;

  tick(backend);
  await a.sync.syncWall('home-wall');
  tick(backend);
  await b.sync.syncWall('home-wall');
  tick(backend);
  await a.sync.syncWall('home-wall');
  assert.eq(await names(a), ['A new', 'B edit']);
  assert.eq(await names(b), ['A new', 'B edit']);
});

test('sync: a deleted climb stays deleted, unless someone edited it after it was deleted', async () => {
  const backend = new FakeFirebase();
  const a = await phone(backend);
  const b = await phone(backend);
  const stays = await a.repo.saveClimb(climbData({ name: 'Stays deleted' }));
  const comes = await a.repo.saveClimb(climbData({ name: 'Edited after' }));
  const code = await a.sync.createBoard('home-wall');
  tick(backend);
  await b.sync.joinBoard('home-wall', code);

  backend.offline = true;
  tick(backend);
  await a.repo.deleteClimb(stays.id);
  await a.repo.deleteClimb(comes.id);
  tick(backend);
  await b.repo.saveClimb(climbData({ id: comes.id, name: 'Edited after' + '!' })); // later than A's deletion
  backend.offline = false;

  tick(backend);
  await a.sync.syncWall('home-wall');
  tick(backend);
  await b.sync.syncWall('home-wall');
  assert.eq(await names(b), ['Edited after!'], 'B lost the one it did not touch, and kept its later edit');
  tick(backend);
  await a.sync.syncWall('home-wall');
  assert.eq(await names(a), ['Edited after!'], 'and A takes the edited climb back');
});

test('sync: joining needs a real code for the same wall, and says what is wrong', async () => {
  const backend = new FakeFirebase();
  const a = await phone(backend);
  const code = await a.sync.createBoard('home-wall');
  const c = await phone(backend);
  await c.repo.saveWall({ ...WALL, key: 'other-wall', name: 'Other wall' });
  assert.eq(await kindOf(c.sync.joinBoard('home-wall', 'hello')), 'code');
  assert.eq(await kindOf(c.sync.joinBoard('home-wall', 'abcd-efgh-jkmn-pqrs')), 'notfound');
  await assert.rejects(c.sync.joinBoard('other-wall', code), 'Home wall');
  assert.eq(await kindOf(c.sync.joinBoard('other-wall', code)), 'wall');
  assert.eq(await c.repo.getSyncSetup('other-wall'), undefined, 'a failed join leaves nothing behind');
});

test('sync: a big board comes across in pages, and a sync with nothing new asks the database once and sends nothing', async () => {
  const backend = new FakeFirebase();
  const a = await phone(backend);
  for (let i = 0; i < 650; i++) await a.repo.saveClimb(climbData({ name: `Climb ${i}`, holds: `${(i % 9) + 1}:hand` }));
  const code = await a.sync.createBoard('home-wall');
  assert.eq(backend.requests.filter((r) => r.includes('commit')).length, 7, 'sent 100 at a time');
  tick(backend);
  const b = await phone(backend);
  const before = count(backend, 'runQuery');
  await b.sync.joinBoard('home-wall', code);
  assert.ok(count(backend, 'runQuery') - before >= 3, 'several pages were asked for');
  assert.eq((await b.repo.listClimbs('home-wall')).length, 650);
  tick(backend);
  const asked = backend.requests.length;
  const idle = await b.sync.syncWall('home-wall');
  assert.eq(backend.requests.length - asked, 1, 'one question for what is new, nothing sent');
  assert.eq([idle.added, idle.updated, idle.deleted, idle.sent], [0, 0, 0, 0]);
  await a.repo.saveClimb(climbData({ name: 'One more' }));
  await a.sync.syncWall('home-wall');
  tick(backend);
  const fresh = await b.sync.syncWall('home-wall');
  assert.eq(fresh.added, 1, 'only the new climb comes across');
});

test('sync: a climb imported from a file is sent on the next sync, and stopping keeps the climbs', async () => {
  const backend = new FakeFirebase();
  const a = await phone(backend);
  const b = await phone(backend);
  const code = await a.sync.createBoard('home-wall');
  await b.sync.joinBoard('home-wall', code);
  tick(backend);
  const parsed = parseShare({ format: 'spraywall-climbs', version: 1, wall: { key: 'home-wall', name: 'Home wall' }, climbs: [{ id: 'from-a-file-01', name: 'From a file', grade: 3, stars: 2, holds: '1:hand', createdAt: 5, updatedAt: 9 }] }, NOW);
  await b.repo.applyImport(await b.repo.planImport(parsed));
  await b.sync.syncWall('home-wall');
  tick(backend);
  await a.sync.syncWall('home-wall');
  assert.eq(await names(a), ['From a file']);
  await b.sync.stop('home-wall');
  assert.eq(await b.repo.getSyncSetup('home-wall'), undefined);
  assert.eq(await names(b), ['From a file'], 'the climbs stay on the phone');
  const asked = backend.requests.length;
  await b.sync.syncAll();
  assert.eq(backend.requests.length, asked, 'a phone that stopped asks nothing');
});

test('sync: odd things on the board are skipped or limited, and cannot stop later climbs arriving', async () => {
  const backend = new FakeFirebase();
  const a = await phone(backend);
  const b = await phone(backend);
  const code = await a.sync.createBoard('home-wall');
  await b.sync.joinBoard('home-wall', code);
  const plant = (id, fields) => backend.docs.set(`boards/${code}/climbs/${id}`, { fields });
  const text = (stringValue) => ({ stringValue });
  const whole = (n) => ({ integerValue: String(n) });
  const justAfterNow = `${new Date(backend.clock.now + 1000).toISOString().slice(0, -1)}001Z`;
  plant('junk-holds-0001', { id: text('junk-holds-0001'), name: text('Junk'), holds: text('nonsense'), updatedAt: whole(5), serverTime: { timestampValue: justAfterNow } });
  plant('from-the-future', { id: text('from-the-future'), name: text('Future'), holds: text('1:hand'), updatedAt: whole(5), serverTime: { timestampValue: '2999-01-01T00:00:00.000000Z' } });
  tick(backend);
  await b.sync.syncWall('home-wall');
  assert.ok((await b.repo.getSyncSetup('home-wall')).lastPull < '2100', 'a stamp from the far future is not followed');
  tick(backend);
  await a.repo.saveClimb(climbData({ name: 'Real one' }));
  await a.sync.syncWall('home-wall');
  tick(backend);
  await b.sync.syncWall('home-wall');
  assert.ok((await names(b)).includes('Real one'), 'climbs sent later still arrive');
  assert.ok(!(await names(b)).includes('Junk'), 'a climb without usable holds is skipped');
});

test('sync: problems show up as the wall\'s state, and the next try works once they are fixed', async () => {
  const backend = new FakeFirebase();
  const a = await phone(backend);
  const code = await a.sync.createBoard('home-wall');
  const seen = [];
  a.sync.onState((key) => seen.push(a.sync.stateOf(key).status));
  await a.repo.saveClimb(climbData({ name: 'Waiting' }));
  backend.quotaUsedUp = true;
  tick(backend);
  assert.eq(await kindOf(a.sync.syncWall('home-wall')), 'quota');
  assert.eq(a.sync.stateOf('home-wall').status, 'error');
  assert.ok(a.sync.stateOf('home-wall').message.includes('daily limit'));
  backend.quotaUsedUp = false;
  tick(backend);
  await a.sync.syncWall('home-wall');
  assert.eq(a.sync.stateOf('home-wall').status, 'ok');
  assert.eq((await a.repo.climbsToSend('home-wall', code)).length, 0);
  assert.ok(seen.includes('syncing') && seen.includes('error') && seen.at(-1) === 'ok', seen.join(','));
});

test('sync: changing a climb makes the app sync by itself shortly after', async () => {
  const backend = new FakeFirebase();
  const a = await phone(backend);
  const b = await phone(backend);
  const code = await a.sync.createBoard('home-wall');
  await b.sync.joinBoard('home-wall', code);
  const quiet = { addEventListener() {}, removeEventListener() {}, document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} } };
  a.sync.start(quiet);
  tick(backend);
  await a.repo.saveClimb(climbData({ name: 'By itself' }));
  await new Promise((resolve) => setTimeout(resolve, 400));
  a.sync.destroy();
  tick(backend);
  await b.sync.syncWall('home-wall');
  assert.eq(await names(b), ['By itself']);
});
