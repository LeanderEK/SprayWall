import { assert, test } from './harness.js';
import { FakeFirebase } from './fakefirebase.js';
import { FirestoreRemote } from '../site/src/data/firestore.js';
import { MemoryStore, Repo } from '../site/src/data/repo.js';
import { SyncService } from '../site/src/data/sync.js';
import { cleanUsername, isMine, isUploaded } from '../site/src/domain/climbs.js';
import {
  BOARD_ALPHABET, cleanRemote, fromFields, idFromName, makeBoardCode, parseBoardCode, showBoardCode, stampValue, toFields, toRecord,
} from '../site/src/domain/sync.js';
import { parseShare } from '../site/src/domain/share.js';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const WALL = { key: 'home-wall', name: 'Home wall', image: null, imageWidth: 10, imageHeight: 10, holds: [], angle: null };
const climbData = (over = {}) => ({ wallKey: 'home-wall', name: 'One', grade: 4, comment: '', holds: '1:start,5:hand', ...over });
const kindOf = async (promise) => {
  try {
    await promise;
    return 'none';
  } catch (error) {
    return error.kind || `not a SyncError: ${error.message}`;
  }
};
const messageOf = async (promise) => {
  try {
    await promise;
    return 'no error';
  } catch (error) {
    return error.message;
  }
};

// ---- board codes and usernames ----

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

test('username: 2 to 20 letters, digits, spaces, dots, dashes or underscores, tidied; anything else is refused', () => {
  assert.eq(cleanUsername('Leander'), 'Leander');
  assert.eq(cleanUsername('  Zeke   B  '), 'Zeke B');
  assert.eq(cleanUsername('Åsa-2_x.y'), 'Åsa-2_x.y');
  assert.eq(cleanUsername('ab'), 'ab');
  for (const bad of ['', ' ', 'a', ' a ', 'x'.repeat(21), '<b>hi</b>', '-leading', '🙂🙂', 'semi;colon', null, undefined]) assert.eq(cleanUsername(bad), null, String(bad));
  assert.ok(isMine({ author: 'zeke' }, ' Zeke '), 'capitals and spaces at the ends do not matter');
  assert.ok(!isMine({ author: '' }, ''), 'no name is nobody\'s');
});

// ---- how climbs are written to and read from the database ----

test('sync: a climb survives being written as database fields and read back; only the climb fields are taken', () => {
  const climb = { id: 'abc-12345678', wallKey: 'home-wall', name: 'Swoobap', grade: 6, comment: 'hi', author: 'Zeke', holds: '1:hand', createdAt: 1792774888771, updatedAt: 1792774913178, publishedAt: 5 };
  const record = toRecord(climb);
  assert.eq(Object.keys(record), ['name', 'grade', 'comment', 'author', 'holds', 'createdAt'], 'no id, rating, stars or edit time goes up');
  const fields = toFields(record);
  assert.eq(fields.createdAt, { integerValue: '1792774888771' });
  assert.eq(fields.name, { stringValue: 'Swoobap' });
  assert.eq(fromFields(fields), record);
  const bare = toFields(toRecord({ ...climb, grade: null, comment: '' }));
  assert.ok(!('grade' in bare) && !('comment' in bare), 'no grade and no comment are no fields');
  assert.eq(idFromName('projects/p/databases/(default)/documents/boards/abcdefghjkmnpqrs/climbs/abc-12345678'), 'abc-12345678');
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
  const record = { name: '<b>x</b>'.repeat(40), grade: 99, comment: 'c'.repeat(5000), author: 'a'.repeat(300), holds: '3:hand,9:wobble', createdAt: NOW * 9, serverTime: '2026-10-25T10:00:00.1Z', stars: 5, evil: 1 };
  const clean = cleanRemote('abc-12345678', record, NOW);
  assert.eq([clean.name.length, clean.grade, clean.comment.length, clean.author.length, clean.holds], [80, null, 2000, 40, '3:hand']);
  assert.ok(clean.createdAt <= NOW + DAY && clean.updatedAt === clean.createdAt, 'a date from the future is held to tomorrow at the latest');
  assert.ok(!('stars' in clean) && !('evil' in clean));
  assert.eq(clean.serverTime, '2026-10-25T10:00:00.1Z');
  assert.eq(cleanRemote('abc-12345678', { ...record, holds: 'junk' }, NOW), null);
  assert.eq(cleanRemote('abc-12345678', { ...record, author: '' }, NOW), null, 'a climb on a board always has a name on it');
  assert.eq(cleanRemote('x', record, NOW), null);
  assert.eq(cleanRemote('abc-12345678', {}, NOW), null);
});

// ---- the repo's side: drafts, uploaded climbs, ratings, username ----

const freshRepo = async (clock = { now: NOW }, username = 'Leander') => {
  const repo = new Repo(new MemoryStore(), () => clock.now);
  await repo.saveWall(WALL);
  if (username) await repo.setUsername(username);
  return { repo, clock };
};

test('climbs: a new climb is a draft with your username on it; once uploaded it can never be changed or deleted', async () => {
  const { repo, clock } = await freshRepo();
  const draft = await repo.saveClimb(climbData({ name: 'Draft' }));
  assert.eq([draft.author, isUploaded(draft), 'stars' in draft], ['Leander', false, false]);
  clock.now += 1000;
  const edited = await repo.saveClimb(climbData({ id: draft.id, name: 'Draft edited' }));
  assert.eq(edited.author, 'Leander');
  const published = await repo.markPublished(draft.id);
  assert.ok(isUploaded(published));
  await assert.rejects(repo.saveClimb(climbData({ id: draft.id, name: 'Too late' })), 'cannot be changed');
  await assert.rejects(repo.deleteClimb(draft.id), 'cannot be deleted');
  assert.eq((await repo.getClimb(draft.id)).name, 'Draft edited');
  const other = await repo.saveClimb(climbData({ name: 'Other draft' }));
  await repo.deleteClimb(other.id);
  assert.eq(await repo.getClimb(other.id), undefined, 'drafts can still be deleted');
  const plan = await repo.planImport(parseShare({ format: 'spraywall-climbs', version: 1, wall: { key: 'home-wall', name: 'Home wall' }, climbs: [{ id: draft.id, name: 'From a file', holds: '1:hand', createdAt: 5, updatedAt: clock.now + 10_000 }] }, clock.now));
  assert.eq(plan.items[0].status, 'same', 'a file cannot replace an uploaded climb');
});

test('ratings: each phone keeps its own, 1 to 5, and they never travel with a climb', async () => {
  const { repo } = await freshRepo();
  const climb = await repo.saveClimb(climbData());
  assert.eq(await repo.getRating(climb.id), 0);
  let heard = 0;
  repo.onChange(() => heard++);
  assert.eq(await repo.setRating(climb.id, 4), 4);
  assert.eq(heard, 1, 'the screens are told');
  assert.eq(await repo.getRating(climb.id), 4);
  assert.eq([...(await repo.getRatings())], [[climb.id, 4]]);
  assert.eq(await repo.setRating(climb.id, 99), 5, 'too many stars is held at 5');
  assert.eq(await repo.setRating(climb.id, 0), 0);
  assert.eq((await repo.getRatings()).size, 0, '0 takes the rating away');
  await repo.setRating(climb.id, 3);
  const share = await repo.exportWall('home-wall');
  assert.ok(!JSON.stringify(share).includes('stars') && !JSON.stringify(share).includes('rating'), 'a shared file has no stars');
  assert.ok(!('stars' in toRecord(await repo.getClimb(climb.id))));
});

test('ratings: the stars old climbs carried become your own ratings, once, and the field goes', async () => {
  const { repo } = await freshRepo();
  await repo.store.put('climbs', { id: 'old-climb-0001', wallKey: 'home-wall', name: 'Old', grade: 3, stars: 5, comment: '', author: '', holds: '1:hand', createdAt: 1, updatedAt: 1 }, 'old-climb-0001');
  await repo.store.put('climbs', { id: 'old-climb-0002', wallKey: 'home-wall', name: 'Unrated', grade: 3, stars: 0, comment: '', author: '', holds: '1:hand', createdAt: 2, updatedAt: 2 }, 'old-climb-0002');
  await repo.store.put('climbs', { id: 'old-climb-0003', wallKey: 'home-wall', name: 'Gone', deletedAt: 9, updatedAt: 9, stars: 4 }, 'old-climb-0003');
  assert.eq(await repo.upgradeData(), 3);
  assert.eq([...(await repo.getRatings())], [['old-climb-0001', 5]]);
  assert.ok(!('stars' in (await repo.getClimb('old-climb-0001'))));
  assert.eq(await repo.upgradeData(), 0, 'the second time there is nothing to do');
});

test('username: the first one is given to unnamed climbs; it can change until a climb of yours is uploaded', async () => {
  const { repo } = await freshRepo(undefined, '');
  await repo.store.put('climbs', { id: 'old-climb-0001', wallKey: 'home-wall', name: 'Old', grade: 3, comment: '', author: '', holds: '1:hand', createdAt: 1, updatedAt: 1 }, 'old-climb-0001');
  await repo.store.put('climbs', { id: 'friends-climb1', wallKey: 'home-wall', name: 'Theirs', grade: 3, comment: '', author: 'Zeke', holds: '1:hand', createdAt: 1, updatedAt: 1 }, 'friends-climb1');
  await assert.rejects(repo.setUsername('x'), '2 to 20');
  assert.eq(await repo.setUsername('  Leander  '), 'Leander');
  assert.eq((await repo.getClimb('old-climb-0001')).author, 'Leander', 'climbs from before usernames are the owner\'s');
  assert.eq((await repo.getClimb('friends-climb1')).author, 'Zeke', 'someone else\'s name is left alone');
  const mine = await repo.saveClimb(climbData());
  assert.ok(await repo.canChangeUsername());
  assert.eq(await repo.setUsername('Lee'), 'Lee');
  assert.eq((await repo.getClimb(mine.id)).author, 'Lee', 'drafts follow a change of name');
  await repo.markPublished(mine.id);
  assert.ok(!(await repo.canChangeUsername()));
  await assert.rejects(repo.setUsername('Somebody else'), 'cannot be changed');
  assert.eq(await repo.setUsername('lee'), 'lee', 'only capitals differ, so it is the same name');
});

test('username: a climb from a file with nobody\'s name on it is taken to be the importer\'s; one with a name keeps it', async () => {
  const { repo } = await freshRepo(undefined, 'Leander');
  const file = parseShare({ format: 'spraywall-climbs', version: 1, wall: { key: 'home-wall', name: 'Home wall' }, climbs: [
    { id: 'unnamed-climb-01', name: 'Unnamed', holds: '1:hand', createdAt: 5, updatedAt: 9 },
    { id: 'named-climb-0001', name: 'Named', author: 'Zeke', holds: '1:hand', createdAt: 5, updatedAt: 9 },
  ] }, NOW);
  await repo.applyImport(await repo.planImport(file));
  assert.eq((await repo.getClimb('unnamed-climb-01')).author, 'Leander');
  assert.eq((await repo.getClimb('named-climb-0001')).author, 'Zeke');
});

test('board: taking in the board\'s climbs adds them, turns a matching draft into the board\'s version, and leaves uploaded ones alone', async () => {
  const { repo, clock } = await freshRepo();
  const draft = await repo.saveClimb(climbData({ name: 'My draft' }));
  const gone = await repo.saveClimb(climbData({ name: 'Deleted here' }));
  await repo.deleteClimb(gone.id);
  const uploaded = await repo.markPublished((await repo.saveClimb(climbData({ name: 'Mine, uploaded' }))).id);
  const remote = (id, over = {}) => ({ id, name: 'x', grade: 2, comment: '', author: 'Zeke', holds: '2:hand', createdAt: 1, updatedAt: 1, serverTime: 's', ...over });
  let heard = 0;
  repo.onChange(() => heard++);
  clock.now += 1000;
  const counts = await repo.applyPublished('home-wall', [
    remote('fresh-climb-01', { name: 'Fresh' }),
    remote(draft.id, { name: 'My draft, as uploaded elsewhere', author: 'Leander' }),
    remote(gone.id, { name: 'Back from the board' }),
    remote(uploaded.id, { name: 'Different' }),
  ]);
  assert.eq(counts, { added: 2, replaced: 1 });
  assert.eq(heard, 1, 'the screens are told once');
  const fresh = await repo.getClimb('fresh-climb-01');
  assert.ok(isUploaded(fresh) && !('serverTime' in fresh), 'it is final here and the stamp is not kept');
  assert.eq((await repo.getClimb(draft.id)).name, 'My draft, as uploaded elsewhere');
  assert.ok(isUploaded(await repo.getClimb(draft.id)));
  assert.eq((await repo.getClimb(uploaded.id)).name, 'Mine, uploaded', 'an uploaded climb is never overwritten');
  assert.eq((await repo.getClimb(gone.id)).name, 'Back from the board', 'a climb on the board cannot be deleted by hiding it here');
  assert.eq(await repo.applyPublished('home-wall', [remote('fresh-climb-01')]), { added: 0, replaced: 0 });
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
const RECORD = { name: 'Swoobap', grade: 6, comment: 'hi', author: 'Zeke', holds: '1:hand,5:start', createdAt: NOW };

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
  assert.eq(await kindOf(remoteFor(backend).getBoard(CODE)), 'setup');
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
  assert.eq(await kindOf(remote.createBoard('short', { wallKey: 'a', wallName: 'b' })), 'denied', 'a board without a proper code is refused');
});

test('firebase: a climb can be added once and never changed or deleted', async () => {
  const backend = new FakeFirebase();
  const remote = remoteFor(backend);
  await remote.createBoard(CODE, { wallKey: 'home-wall', wallName: 'Home wall' });
  assert.ok(!(await remote.hasClimb(CODE, 'abc-12345678')));
  await remote.createClimb(CODE, 'abc-12345678', RECORD);
  assert.ok(await remote.hasClimb(CODE, 'abc-12345678'));
  assert.eq(await kindOf(remote.createClimb(CODE, 'abc-12345678', { ...RECORD, name: 'Changed' })), 'exists', 'adding it again does not replace it');
  const { records } = await remote.fetchClimbs(CODE, null);
  assert.eq([records.length, records[0].id, records[0].name, records[0].author], [1, 'abc-12345678', 'Swoobap', 'Zeke']);
  assert.ok(typeof records[0].serverTime === 'string', 'the database stamps it');

  // What a hand-made request could try, against the same rules.
  const call = async (method, path, body) => {
    const token = (await (async () => { const r = await backend.fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${backend.apiKey}`, { method: 'POST', body: '{}' }); return (await r.json()).idToken; })());
    const response = await backend.fetch(`https://firestore.googleapis.com/v1/projects/${backend.projectId}/databases/(default)/documents/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return response.status;
  };
  const doc = `boards/${CODE}/climbs/abc-12345678`;
  assert.eq(await call('DELETE', doc), 403, 'delete is refused');
  assert.eq(await call('PATCH', doc, { fields: { name: { stringValue: 'Hacked' } } }), 403, 'edit is refused');
  const overwrite = { writes: [{ update: { name: `projects/${backend.projectId}/databases/(default)/documents/${doc}`, fields: toFields({ ...RECORD, name: 'Hacked' }) }, updateTransforms: [{ fieldPath: 'serverTime', setToServerValue: 'REQUEST_TIME' }] }] };
  assert.eq(await call('POST', ':commit', overwrite), 403, 'a replacement is refused');
  assert.eq(backend.docs.get(doc).fields.name.stringValue, 'Swoobap', 'and nothing changed');
  for (const bad of [{ ...RECORD, author: 'Z' }, { ...RECORD, holds: 'nonsense' }, { ...RECORD, name: '' }, { ...RECORD, grade: 40 }, { ...RECORD, name: 'x'.repeat(81) }]) {
    assert.eq(await kindOf(remote.createClimb(CODE, 'bad-climb-0001', bad)), 'denied', JSON.stringify(bad).slice(0, 60));
  }
});

// ---- phones and a board ----

async function phone(backend, username = 'Leander') {
  const clock = backend.clock;
  const repo = new Repo(new MemoryStore(), () => clock.now);
  await repo.saveWall(WALL);
  if (username) await repo.setUsername(username);
  const tokens = { load: () => repo.getMeta('syncAuth'), save: (auth) => repo.setMetaQuietly('syncAuth', auth) };
  const remote = new FirestoreRemote({ config: config(backend), tokens, fetchImpl: backend.fetch, now: () => clock.now });
  const sync = new SyncService({ repo, remote, now: () => clock.now, delays: { first: 10, afterChange: 20, whileOpen: 100_000 } });
  return { repo, sync, clock };
}
const tick = (backend, seconds = 5) => { backend.clock.now += seconds * 1000; };
const names = async (device) => (await device.repo.listClimbs('home-wall')).map((c) => c.name).sort();

test('board: climbs are uploaded one at a time by their maker and then reach everyone on the board, final', async () => {
  const backend = new FakeFirebase();
  const a = await phone(backend, 'Alex');
  const b = await phone(backend, 'Bea');
  const one = await a.repo.saveClimb(climbData({ name: 'One', grade: 6, comment: 'Directional.', holds: '1:start,5:hand,9:finish' }));
  tick(backend);
  const two = await a.repo.saveClimb(climbData({ name: 'Two' }));
  const draft = await a.repo.saveClimb(climbData({ name: 'Still a draft' }));
  const code = await a.sync.createBoard('home-wall');
  assert.eq((await a.repo.getSyncSetup('home-wall')).code, code);
  assert.eq(a.sync.stateOf('home-wall').status, 'ok');
  assert.ok(!isUploaded(await a.repo.getClimb(one.id)), 'making a board does not upload anything by itself');

  await a.sync.upload(one.id);
  tick(backend);
  await a.sync.upload(two.id);
  assert.ok(isUploaded(await a.repo.getClimb(one.id)) && isUploaded(await a.repo.getClimb(two.id)) && !isUploaded(await a.repo.getClimb(draft.id)));
  await assert.rejects(a.repo.saveClimb(climbData({ id: one.id, name: 'Edit' })), 'cannot be changed');
  await assert.rejects(a.repo.deleteClimb(two.id), 'cannot be deleted');

  tick(backend);
  await b.sync.joinBoard('home-wall', showBoardCode(code));
  assert.eq(await names(b), ['One', 'Two'], 'the draft stayed on its maker\'s phone');
  const copy = await b.repo.getClimb(one.id);
  assert.eq([copy.holds, copy.grade, copy.comment, copy.author, copy.createdAt], [one.holds, 6, 'Directional.', 'Alex', one.createdAt]);
  assert.ok(isUploaded(copy) && !isMine(copy, 'Bea'));
  await assert.rejects(b.repo.saveClimb(climbData({ id: one.id, name: 'Mine now' })), 'cannot be changed');
  await assert.rejects(b.repo.deleteClimb(one.id), 'cannot be deleted');
  assert.eq(await kindOf(b.sync.upload(one.id)), 'mine', 'a climb from the board is already uploaded');

  await a.repo.setRating(one.id, 5);
  assert.eq(await b.repo.getRating(one.id), 0, 'ratings stay on their own phone');
  await b.repo.setRating(one.id, 2);
  assert.eq(await a.repo.getRating(one.id), 5);

  tick(backend);
  const bea = await b.repo.saveClimb(climbData({ name: 'Bea\'s climb' }));
  await b.sync.upload(bea.id);
  tick(backend);
  const arrived = await a.sync.syncWall('home-wall');
  assert.eq(arrived.added, 1);
  assert.eq((await a.repo.getClimb(bea.id)).author, 'Bea');
  tick(backend);
  await a.sync.upload(draft.id);
  tick(backend);
  await b.sync.syncWall('home-wall');
  assert.eq(await names(b), ['Bea\'s climb', 'One', 'Still a draft', 'Two']);
  assert.ok(!(await a.repo.canChangeUsername()), 'Alex has uploaded, so the name is final');
});

test('board: what is refused is explained, and a refused upload stays a draft', async () => {
  const backend = new FakeFirebase();
  const a = await phone(backend, 'Alex');
  const draft = await a.repo.saveClimb(climbData({ name: 'Draft' }));
  assert.eq(await kindOf(a.sync.upload(draft.id)), 'board', 'no board for this wall yet');
  await a.sync.createBoard('home-wall');
  const file = parseShare({ format: 'spraywall-climbs', version: 1, wall: { key: 'home-wall', name: 'Home wall' }, climbs: [{ id: 'from-a-file-01', name: 'Not mine', author: 'Zeke', holds: '1:hand', createdAt: 5, updatedAt: 9 }] }, NOW);
  await a.repo.applyImport(await a.repo.planImport(file));
  assert.eq(await kindOf(a.sync.upload('from-a-file-01')), 'mine', 'only your own climbs can be uploaded');
  assert.eq(await kindOf(a.sync.upload('no-such-climb')), 'mine');
  backend.offline = true;
  assert.eq(await kindOf(a.sync.upload(draft.id)), 'offline');
  assert.ok(!isUploaded(await a.repo.getClimb(draft.id)), 'still a draft');
  backend.offline = false;
  backend.quotaUsedUp = true;
  assert.eq(await kindOf(a.sync.upload(draft.id)), 'quota');
  assert.ok(a.sync.stateOf('home-wall').message.includes('daily limit'));
  backend.quotaUsedUp = false;
  await a.sync.upload(draft.id);
  assert.ok(isUploaded(await a.repo.getClimb(draft.id)));
  assert.eq(a.sync.stateOf('home-wall').status, 'ok');
  assert.eq(await kindOf(a.sync.upload(draft.id)), 'mine', 'it is already uploaded');
});

test('board: an upload whose answer was lost is recognised on the second try', async () => {
  const backend = new FakeFirebase();
  const a = await phone(backend, 'Alex');
  const draft = await a.repo.saveClimb(climbData({ name: 'Lost answer' }));
  const code = await a.sync.createBoard('home-wall');
  await a.sync.remote.createClimb(code, draft.id, toRecord(draft)); // it got there, but the phone never heard
  assert.ok(!isUploaded(await a.repo.getClimb(draft.id)));
  await a.sync.upload(draft.id);
  assert.ok(isUploaded(await a.repo.getClimb(draft.id)), 'marked as uploaded without a second copy');
  assert.eq([...backend.docs.keys()].filter((path) => path.includes('/climbs/')).length, 1);
});

test('board: joining needs a real code for the same wall, and says what is wrong', async () => {
  const backend = new FakeFirebase();
  const a = await phone(backend);
  const code = await a.sync.createBoard('home-wall');
  const c = await phone(backend, 'Cy');
  await c.repo.saveWall({ ...WALL, key: 'other-wall', name: 'Other wall' });
  assert.eq(await kindOf(c.sync.joinBoard('home-wall', 'hello')), 'code');
  assert.eq(await kindOf(c.sync.joinBoard('home-wall', 'abcd-efgh-jkmn-pqrs')), 'notfound');
  await assert.rejects(c.sync.joinBoard('other-wall', code), 'Home wall');
  assert.eq(await kindOf(c.sync.joinBoard('other-wall', code)), 'wall');
  assert.eq(await c.repo.getSyncSetup('other-wall'), undefined, 'a failed join leaves nothing behind');
});

test('board: a big board comes across in pages, and a check with nothing new asks the database once', async () => {
  const backend = new FakeFirebase();
  const a = await phone(backend, 'Alex');
  const code = await a.sync.createBoard('home-wall');
  // 650 climbs already on the board, stamped five at a time like climbs sent together.
  for (let i = 0; i < 650; i++) {
    const id = `planted-climb-${String(i).padStart(4, '0')}`;
    const stamp = `2027-01-15T08:00:${String(Math.floor(i / 5) % 60).padStart(2, '0')}.${String(Math.floor(i / 300)).padStart(3, '0')}000Z`;
    backend.docs.set(`boards/${code}/climbs/${id}`, { fields: { ...toFields({ name: `Climb ${i}`, author: 'Zed', holds: `${(i % 9) + 1}:hand`, createdAt: NOW }), serverTime: { timestampValue: stamp } } });
  }
  tick(backend);
  const b = await phone(backend, 'Bea');
  const before = count(backend, 'runQuery');
  await b.sync.joinBoard('home-wall', code);
  assert.ok(count(backend, 'runQuery') - before >= 3, 'several pages were asked for');
  assert.eq((await b.repo.listClimbs('home-wall')).length, 650);
  const asked = backend.requests.length;
  const idle = await b.sync.syncWall('home-wall');
  assert.eq(backend.requests.length - asked, 1, 'one question for what is new');
  assert.eq([idle.added, idle.replaced], [0, 0]);
});

test('board: odd things on the board are skipped or limited, and cannot stop later climbs arriving', async () => {
  const backend = new FakeFirebase();
  const a = await phone(backend, 'Alex');
  const b = await phone(backend, 'Bea');
  const code = await a.sync.createBoard('home-wall');
  await b.sync.joinBoard('home-wall', code);
  const stampAfterNow = `${new Date(backend.clock.now + 1000).toISOString().slice(0, -1)}001Z`;
  const plant = (id, fields, stamp) => backend.docs.set(`boards/${code}/climbs/${id}`, { fields: { ...toFields(fields), serverTime: { timestampValue: stamp } } });
  plant('junk-holds-0001', { name: 'Junk', author: 'Zed', holds: 'nonsense', createdAt: NOW }, stampAfterNow);
  plant('no-author-0001', { name: 'Nobody', author: '', holds: '1:hand', createdAt: NOW }, stampAfterNow);
  plant('from-the-future', { name: 'Future', author: 'Zed', holds: '1:hand', createdAt: NOW }, '2999-01-01T00:00:00.000000Z');
  tick(backend);
  await b.sync.syncWall('home-wall');
  assert.ok((await b.repo.getSyncSetup('home-wall')).lastPull < '2100', 'a stamp from the far future is not followed');
  tick(backend);
  const real = await a.repo.saveClimb(climbData({ name: 'Real one' }));
  await a.sync.upload(real.id);
  tick(backend);
  await b.sync.syncWall('home-wall');
  assert.ok((await names(b)).includes('Real one'), 'climbs uploaded later still arrive');
  assert.ok(!(await names(b)).includes('Junk') && !(await names(b)).includes('Nobody'), 'climbs without usable holds or a name are skipped');
});

test('board: stopping keeps every climb, uploaded ones stay uploaded, and the phone asks nothing more', async () => {
  const backend = new FakeFirebase();
  const a = await phone(backend, 'Alex');
  const climb = await a.repo.saveClimb(climbData());
  await a.sync.createBoard('home-wall');
  await a.sync.upload(climb.id);
  await a.sync.stop('home-wall');
  assert.eq(await a.repo.getSyncSetup('home-wall'), undefined);
  assert.eq(await names(a), ['One']);
  assert.ok(isUploaded(await a.repo.getClimb(climb.id)));
  const asked = backend.requests.length;
  await a.sync.syncAll();
  assert.eq(backend.requests.length, asked);
  const second = await a.repo.saveClimb(climbData({ name: 'After' }));
  assert.eq(await kindOf(a.sync.upload(second.id)), 'board', 'without a board nothing can be uploaded');
});

test('board: problems show up as the wall\'s state, and the next try works once they are fixed', async () => {
  const backend = new FakeFirebase();
  const a = await phone(backend, 'Alex');
  await a.sync.createBoard('home-wall');
  const seen = [];
  a.sync.onState((key) => seen.push(a.sync.stateOf(key).status));
  backend.quotaUsedUp = true;
  tick(backend);
  assert.eq(await kindOf(a.sync.syncWall('home-wall')), 'quota');
  assert.eq(a.sync.stateOf('home-wall').status, 'error');
  assert.ok(a.sync.stateOf('home-wall').message.includes('daily limit'));
  backend.quotaUsedUp = false;
  backend.offline = true;
  assert.eq(await kindOf(a.sync.syncWall('home-wall')), 'offline');
  assert.eq(a.sync.stateOf('home-wall').status, 'offline');
  backend.offline = false;
  await a.sync.syncWall('home-wall');
  assert.eq(a.sync.stateOf('home-wall').status, 'ok');
  assert.ok(seen.includes('syncing') && seen.includes('error') && seen.includes('offline') && seen.at(-1) === 'ok', seen.join(','));
});

test('board: the app looks for new climbs by itself after a change, and does not loop', async () => {
  const backend = new FakeFirebase();
  const a = await phone(backend, 'Alex');
  const b = await phone(backend, 'Bea');
  const code = await a.sync.createBoard('home-wall');
  await b.sync.joinBoard('home-wall', code);
  const quiet = { addEventListener() {}, removeEventListener() {}, document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} } };
  b.sync.start(quiet);
  tick(backend);
  const climb = await a.repo.saveClimb(climbData({ name: 'By itself' }));
  await a.sync.upload(climb.id);
  tick(backend);
  await b.repo.setRating('whatever-id-0001', 3); // a change on b: it looks for new climbs shortly after
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.eq(await names(b), ['By itself']);
  const quietCount = backend.requests.length;
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.eq(backend.requests.length, quietCount, 'once it has everything it stops asking');
  b.sync.destroy();
});
