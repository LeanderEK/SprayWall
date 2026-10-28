import { cleanClimb } from './share.js';

// The rules of syncing, with no network in them (the network part is data/firestore.js, the steps are data/sync.js).
//
// A "board" is a shared set of climbs for one wall. Everyone who has the board's code can read the climbs on it and upload
// climbs of their own, so the code is the password: 16 letters and digits chosen at random, written like  k7f2-9xqm-c4ta-p8dn.
// An uploaded climb can never be changed or deleted (the database's rules allow only adding), so a board is just a growing
// list and syncing is only "fetch the climbs I do not have yet". Climbs are stored one document each, under the board,
// with the climb's id as the document's name. Star ratings are not stored there: each phone keeps its own.

/**
 * Why a sync step failed. `kind` is one of: offline, denied, notfound, quota, server, setup (the Firebase project is not
 * ready), code (not a board code), wall (the board is for another wall), exists, mine (not a climb you can upload),
 * board (no board for the wall yet), username (not a usable username), password (not a usable password),
 * signin (not signed in, or signed out), taken (username already has an account), credentials (wrong username or
 * password), weak (password refused as too weak), disabled (account switched off), tooMany (too many tries, wait).
 */
export class SyncError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

// ---- accounts ----
//
// An account is a username and a password. Firebase's sign-in wants an email address, so the username is turned into one
// that nobody can ever receive mail at (the part before the @ is the username, the part after is below). Firebase keeps
// the addresses unique, which makes the usernames unique, and the database's rules compare the address in your sign-in
// with the author of each climb you upload, so nobody can upload under another name. No email is ever sent, so a lost
// password cannot be reset by email: the project owner deletes the account in the Firebase console and the name is free again.

export const AUTH_DOMAIN = 'spraywall.example.com';
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 128;
export const emailFor = (username) => `${username}@${AUTH_DOMAIN}`;

/** The password as typed, or null if it is too short (Firebase needs 6; 8 is asked for). Passwords are never changed or trimmed. */
export const cleanPassword = (text) => (typeof text === 'string' && text.length >= MIN_PASSWORD && text.length <= MAX_PASSWORD ? text : null);

/** Why a typed password will not do, in words for the person typing it, or null if it is fine (so it is null exactly when `cleanPassword` accepts it). */
export function passwordProblem(text) {
  const typed = typeof text === 'string' ? text : '';
  if (typed === '') return `Type a password (at least ${MIN_PASSWORD} characters).`;
  if (typed.length < MIN_PASSWORD) return `That password is too short: you typed ${typed.length} and it needs at least ${MIN_PASSWORD} characters.`;
  if (typed.length > MAX_PASSWORD) return `That password is too long: the most is ${MAX_PASSWORD} characters.`;
  return null;
}

// ---- board codes ----

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

// The fields of a climb on the board. The id is the document's name, not a field.
const FIELDS = ['name', 'grade', 'comment', 'author', 'holds', 'createdAt', 'serverTime'];

/** What goes into the database for a climb, as plain values. */
export function toRecord(climb) {
  return {
    name: climb.name,
    grade: climb.grade ?? null,
    comment: climb.comment || '',
    author: climb.author,
    holds: climb.holds,
    createdAt: climb.createdAt,
  };
}

/** The same, in the typed form the database wants. Empty values are left out. */
export function toFields(record) {
  const fields = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined || value === '') continue;
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
  }
  return record;
}

/** The id of a climb from the name of its document ("projects/.../climbs/<id>"). */
export const idFromName = (name) => String(name || '').split('/').pop();

/** Checks and cleans one climb that came from the board (anyone with the code can write there). Null if unusable. */
export function cleanRemote(id, record, now = Date.now()) {
  const clean = cleanClimb({ ...record, id, updatedAt: record.createdAt }, now);
  if (!clean || clean.author === '') return null; // a climb on a board always has someone's name on it
  return { ...clean, serverTime: typeof record.serverTime === 'string' ? record.serverTime : null };
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
