import { MAX_GRADE } from './climbs.js';
import { formatMarks, parseMarks } from './holds.js';

// Sharing climbs. Climbs travel as a small piece of JSON, either in a file or packed into a link.
//
//   { "format": "spraywall-climbs", "version": 1,
//     "wall": { "key": "home-wall", "name": "Home wall" },
//     "climbs": [ { "id", "name", "grade", "comment", "author", "holds", "createdAt", "updatedAt" } ] }
//
// A star rating is not shared: each person rates climbs on their own phone. (Files made before that still say "stars"; it is ignored.)
//
// Everything that arrives this way came from someone else, so it is checked and cleaned before the app looks at it:
// text is trimmed and capped, numbers are forced into range, and a climb without a usable id or holds is skipped.
// Text from a shared climb is only ever shown as plain text, never as HTML.

export const FORMAT = 'spraywall-climbs';
export const VERSION = 1;
export const MAX_NAME = 80;
export const MAX_COMMENT = 2000;
export const MAX_AUTHOR = 40;
export const MAX_CLIMBS_PER_SHARE = 500;
export const MAX_PAYLOAD_CHARS = 400_000;

export class ShareError extends Error {}

const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const KEY_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;

export function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max).trim();
}

const wholeNumber = (value) => typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);

/** The fields of a climb that are shared (nothing else about it leaves the phone). */
export const toWire = (climb) => ({
  id: climb.id,
  name: climb.name,
  grade: climb.grade ?? null,
  comment: climb.comment || '',
  author: climb.author || '',
  holds: climb.holds,
  createdAt: climb.createdAt,
  updatedAt: climb.updatedAt,
});

export function makeShare(wall, climbs) {
  return {
    format: FORMAT,
    version: VERSION,
    wall: { key: wall.key, name: wall.name },
    climbs: climbs.map(toWire),
  };
}

/** The share as the text of a .json file. */
export const shareToText = (share) => JSON.stringify(share, null, 1);

/** Checks and cleans a share (an object or its JSON text). Returns { wallKey, wallName, climbs, skipped }. */
export function parseShare(input, now = Date.now()) {
  let share = input;
  if (typeof input === 'string') {
    try {
      share = JSON.parse(input);
    } catch {
      throw new ShareError('That is not a SprayWall climbs file.');
    }
  }
  if (share === null || typeof share !== 'object' || share.format !== FORMAT) throw new ShareError('That is not a SprayWall climbs file.');
  if (!wholeNumber(share.version) || share.version < 1) throw new ShareError('That is not a SprayWall climbs file.');
  if (share.version > VERSION) throw new ShareError('That file was made by a newer version of SprayWall. Update the app first.');
  const wall = share.wall;
  if (wall === null || typeof wall !== 'object' || typeof wall.key !== 'string' || !KEY_PATTERN.test(wall.key)) {
    throw new ShareError('That file does not say which wall its climbs are for.');
  }
  if (!Array.isArray(share.climbs) || share.climbs.length === 0) throw new ShareError('That file has no climbs in it.');
  if (share.climbs.length > MAX_CLIMBS_PER_SHARE) throw new ShareError(`That file has more than ${MAX_CLIMBS_PER_SHARE} climbs.`);

  const climbs = [];
  let skipped = 0;
  const seen = new Set();
  for (const raw of share.climbs) {
    const climb = cleanClimb(raw, now);
    if (!climb || seen.has(climb.id)) {
      skipped++;
      continue;
    }
    seen.add(climb.id);
    climbs.push(climb);
  }
  if (climbs.length === 0) throw new ShareError('None of the climbs in that file could be read.');
  return { wallKey: wall.key, wallName: cleanText(wall.name, 80) || wall.key, climbs, skipped };
}

/** A climb that someone deleted, as it arrives from a sync: only { id, name, deletedAt, updatedAt } is kept. */
export function cleanDeleted(raw, now) {
  if (raw === null || typeof raw !== 'object' || typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) return null;
  const deletedAt = typeof raw.deletedAt === 'number' && Number.isFinite(raw.deletedAt) && raw.deletedAt > 0 ? Math.min(raw.deletedAt, now + 24 * 60 * 60 * 1000) : null;
  if (deletedAt === null) return null;
  return { id: raw.id, name: cleanText(raw.name, MAX_NAME) || 'Deleted climb', deletedAt, updatedAt: deletedAt };
}

export function cleanClimb(raw, now) {
  if (raw === null || typeof raw !== 'object') return null;
  if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) return null;
  const marks = parseMarks(typeof raw.holds === 'string' ? raw.holds.slice(0, 20_000) : '');
  const markCount = Object.keys(marks).length;
  if (markCount === 0 || markCount > 400) return null;
  const name = cleanText(raw.name, MAX_NAME);
  if (name === '') return null;
  const grade = wholeNumber(raw.grade) && raw.grade >= 0 && raw.grade <= MAX_GRADE ? raw.grade : null;
  // A climb dated in the far future would beat every later edit, so dates are held to "now" at the latest.
  const latest = now + 24 * 60 * 60 * 1000;
  const date = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(value, latest) : fallback);
  const updatedAt = date(raw.updatedAt, now);
  const createdAt = Math.min(date(raw.createdAt, updatedAt), updatedAt);
  return {
    id: raw.id,
    name,
    grade,
    comment: cleanText(raw.comment, MAX_COMMENT),
    author: cleanText(raw.author, MAX_AUTHOR),
    holds: formatMarks(marks),
    createdAt,
    updatedAt,
  };
}

// ---- links ----------------------------------------------------------------------------------------------------

const toBase64Url = (bytes) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text) => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const MAX_UNPACKED_BYTES = 2_000_000;

/** Runs bytes through a (de)compression stream. Stops with an error if the output grows past `maxOut`, so a tiny
 * crafted link cannot swell into gigabytes. */
async function pipe(bytes, stream, maxOut = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxOut) {
      await reader.cancel();
      throw new ShareError('That link is too long to be a climb.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * A share packed into a short piece of text for a link: the JSON, squeezed with deflate where the browser can, then
 * written in letters and digits. The first character says how it was packed ("z" squeezed, "j" plain).
 */
export async function packShare(share) {
  const json = new TextEncoder().encode(JSON.stringify(share));
  if (typeof CompressionStream !== 'undefined') {
    try {
      return 'z' + toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
    } catch {
      /* fall through to the plain form */
    }
  }
  return 'j' + toBase64Url(json);
}

/** The link that opens SprayWall with the share ready to import. `base` is the address of the app. */
export const linkFor = (base, payload) => `${base.split('#')[0]}#/import/${payload}`;

/**
 * Finds the packed text in whatever was pasted: a whole link (with or without chat text before and after it), or just the
 * code. In a link the code ends at the first character that cannot be part of it, such as a space, a full stop or a bracket.
 */
export function extractPayload(pasted) {
  const text = String(pasted || '').trim();
  const marker = '#/import/';
  const at = text.indexOf(marker);
  // A bare code may have been broken into lines on its way here, so its spaces and line breaks are dropped.
  const code = at >= 0 ? /^[A-Za-z0-9_-]*/.exec(text.slice(at + marker.length))[0] : text.replace(/\s+/g, '');
  if (!/^[zj][A-Za-z0-9_-]{4,}$/.test(code)) throw new ShareError('That does not look like a SprayWall link or code.');
  if (code.length > MAX_PAYLOAD_CHARS) throw new ShareError('That link is too long to be a climb.');
  return code;
}

/** Unpacks and checks a link's text (or a whole pasted link). Returns what parseShare returns. */
export async function unpackShare(pasted, now = Date.now()) {
  const code = extractPayload(pasted);
  let bytes;
  try {
    bytes = fromBase64Url(code.slice(1));
  } catch {
    throw new ShareError('That link is damaged: part of it is missing.');
  }
  if (code[0] === 'z') {
    if (typeof DecompressionStream === 'undefined') throw new ShareError('This browser is too old to open that link. Update it.');
    try {
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'), MAX_UNPACKED_BYTES);
    } catch (error) {
      if (error instanceof ShareError) throw error;
      throw new ShareError('That link is damaged: part of it is missing.');
    }
  }
  if (bytes.length > MAX_UNPACKED_BYTES) throw new ShareError('That link is too long to be a climb.');
  return parseShare(new TextDecoder().decode(bytes), now);
}
