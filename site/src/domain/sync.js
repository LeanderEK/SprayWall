import { cleanClimb, cleanDeleted } from './share.js';

// The rules of syncing, with no network in them (the network part is data/firestore.js, the steps are data/sync.js).
//
// A "board" is a shared set of climbs for one wall. Everyone who has the board's code can read and change it, so the
// code is the password: 16 letters and digits chosen at random, written like  k7f2-9xqm-c4ta-p8dn.
// Climbs are stored one document each, under the board, in the same fields as a shared climb. A climb that was deleted
// stays as a small record with a `deletedAt`, so that a phone that was offline cannot bring it back by mistake.

/** Why a sync step failed. `kind` is one of: offline, denied, notfound, quota, server, setup, code, wall, exists. */
export class SyncError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

// Letters and digits that cannot be mistaken for each other (no i, l, o, 0 or 1): 31 of them.
export const BOARD_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const CODE_LENGTH = 16;

const randomBytes = (count) => globalThis.crypto.getRandomValues(new Uint8Array(count));

/** A new board code. `bytes` can be given for testing. */
export function makeBoardCode(bytes = randomBytes) {
  const size = BOARD_ALPHABET.length;
  const limit = 256 - (256 % size); // bytes above this would make some letters likelier than others, so they are skipped
  let code = '';
  while (code.length < CODE_LENGTH) {
    for (const byte of bytes(32)) {
      if (byte >= limit) continue;
      code += BOARD_ALPHABET[byte % size];
      if (code.length === CODE_LENGTH) break;
    }
  }
  return code;
}

export const showBoardCode = (code) => code.match(/.{4}/g).join('-');

/** The code inside whatever was typed or pasted (capitals, spaces and dashes do not matter). Throws if there is none. */
export function parseBoardCode(text) {
  const wrong = new SyncError('code', 'That does not look like a board code. It looks like k7f2-9xqm-c4ta-p8dn.');
  const valid = (letters) => letters.length === CODE_LENGTH && [...letters].every((letter) => BOARD_ALPHABET.includes(letter));
  const typed = String(text || '').toLowerCase();
  const plain = typed.replace(/[^a-z0-9]/g, '');
  if (valid(plain)) return plain;
  const inside = /(?<![a-z0-9-])[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}(?![a-z0-9-])/.exec(typed); // a code in the middle of a message
  if (inside && valid(inside[0].replace(/-/g, ''))) return inside[0].replace(/-/g, '');
  throw wrong;
}

// ---- how a climb is written in the database ----

const FIELDS = ['id', 'name', 'grade', 'stars', 'comment', 'author', 'holds', 'createdAt', 'updatedAt', 'deletedAt', 'serverTime'];

/** What goes into the database for a climb (or a deleted climb), as plain values. */
export function toRecord(climb) {
  if (climb.deletedAt) return { id: climb.id, name: climb.name, deletedAt: climb.deletedAt, updatedAt: climb.updatedAt };
  return {
    id: climb.id,
    name: climb.name,
    grade: climb.grade ?? null,
    stars: climb.stars,
    comment: climb.comment || '',
    author: climb.author || '',
    holds: climb.holds,
    createdAt: climb.createdAt,
    updatedAt: climb.updatedAt,
  };
}

/** The same, in the typed form the database wants. Empty values are left out. */
export function toFields(record) {
  const fields = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') fields[key] = { stringValue: value };
    else if (Number.isInteger(value)) fields[key] = { integerValue: String(value) };
    else throw new Error(`cannot store ${key}`);
  }
  return fields;
}

/** Typed fields from the database back to plain values. Only the fields of a climb are taken, nothing else. */
export function fromFields(fields) {
  const record = {};
  for (const key of FIELDS) {
    const typed = fields && Object.hasOwn(fields, key) ? fields[key] : null;
    if (!typed || typeof typed !== 'object') continue;
    if (typeof typed.stringValue === 'string') record[key] = typed.stringValue;
    else if (typeof typed.timestampValue === 'string') record[key] = typed.timestampValue;
    else if (typed.integerValue !== undefined) record[key] = Number(typed.integerValue);
    else if (typeof typed.doubleValue === 'number') record[key] = typed.doubleValue;
  }
  return record;
}

/** Checks and cleans one climb that came from the database (anyone with the code can write there). Null if unusable. */
export function cleanRemote(record, now = Date.now()) {
  const clean = record && record.deletedAt ? cleanDeleted(record, now) : cleanClimb(record, now);
  return clean && { ...clean, serverTime: typeof record.serverTime === 'string' ? record.serverTime : null };
}

/**
 * A time stamp from the database ("2026-10-25T10:00:00.123456Z", with any number of decimals) as microseconds since 1970,
 * so that two stamps can be compared exactly. NaN if it is not a time stamp.
 */
export function stampValue(stamp) {
  const parts = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?Z$/.exec(String(stamp));
  if (!parts) return NaN;
  const seconds = Math.floor(Date.parse(`${parts[1]}Z`) / 1000);
  return seconds * 1_000_000 + Number((parts[2] || '').padEnd(6, '0').slice(0, 6));
}

/** The "version" of a stored climb: when it last changed, or was deleted. */
export const versionOf = (climb) => climb.deletedAt || climb.updatedAt;

/**
 * What to do with a climb from the board, given your copy of it (or undefined):
 *   add / update  take the board's copy
 *   delete        it was deleted on the board after your last change, so delete yours
 *   remember      you do not have it, and it is deleted: keep a marker so an old copy cannot return
 *   same          nothing to do (your copy is the board's)
 *   keep          yours is newer, so it stays (and is sent to the board)
 */
export function decideRemote(mine, remote) {
  if (remote.deletedAt) {
    if (!mine) return 'remember';
    if (mine.deletedAt) return 'same';
    return remote.deletedAt > mine.updatedAt ? 'delete' : 'keep';
  }
  if (!mine) return 'add';
  if (mine.deletedAt) return remote.updatedAt > mine.deletedAt ? 'add' : 'keep';
  if (remote.updatedAt > mine.updatedAt) return 'update';
  if (remote.updatedAt === mine.updatedAt) return 'same';
  return 'keep';
}

/** Marks a climb as "this version is on the board `code`". */
export const syncMark = (code, climb) => `${code}:${versionOf(climb)}`;
