import { parseMarks } from './holds.js';

export const MAX_GRADE = 17;
export const MAX_STARS = 5;
export const MAX_WALL_NAME = 40;
export const MAX_USERNAME = 20;

export const gradeLabel = (grade) => (grade === null || grade === undefined ? '—' : `V${grade}`);

// The grade slider has a stop for "no grade" at the left, then V0 to V17: stop 0 is no grade, stop 1 is V0, and so on.
export const gradeToStop = (grade) => (grade === null || grade === undefined ? 0 : grade + 1);

export function stopToGrade(stop) {
  const rounded = Math.round(stop);
  return rounded <= 0 ? null : Math.min(rounded - 1, MAX_GRADE);
}

/** What a person typing a wall name gets: trimmed, at most MAX_WALL_NAME characters, or null if nothing is left. */
export function cleanWallName(text) {
  const clean = String(text).trim().slice(0, MAX_WALL_NAME).trim();
  return clean === '' ? null : clean;
}

/**
 * What a person typing a username gets: spaces tidied, 2 to 20 letters, digits, spaces, dots, dashes or underscores,
 * starting with a letter or digit. Null if it will not do.
 */
export function cleanUsername(text) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return /^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,19}$/u.test(clean) ? clean : null;
}

/** Two usernames are the same person's, whatever the capitals. */
export const sameName = (a, b) => Boolean(a) && Boolean(b) && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** A climb you made: it carries your username. */
export const isMine = (climb, me) => sameName(climb.author, me);

/** A climb that has been uploaded to a shared board (or came from one): it can no longer be changed or deleted. */
export const isUploaded = (climb) => Boolean(climb.publishedAt);

export const SORTS = [
  ['newest', 'Newest'],
  ['oldest', 'Oldest'],
  ['hardest', 'Hardest'],
  ['easiest', 'Easiest'],
  ['top', 'Top rated'],
  ['name', 'Name'],
];

// Which climbs to show: all of them, the ones you made, or the ones you made and have not uploaded yet.
export const SCOPES = [
  ['all', 'All climbs'],
  ['mine', 'My climbs'],
  ['drafts', 'My drafts'],
];

export const defaultQuery = () => ({ text: '', minGrade: 0, maxGrade: MAX_GRADE, minStars: 0, scope: 'all', sort: 'newest' });
export const gradeFiltered = (query) => query.minGrade > 0 || query.maxGrade < MAX_GRADE;
export const filterCount = (query) => (gradeFiltered(query) ? 1 : 0) + (query.minStars > 0 ? 1 : 0) + (query.scope && query.scope !== 'all' ? 1 : 0);

// A climb is { id, wallKey, name, grade (0-17 or null), comment, author, holds (text), createdAt, updatedAt } and, once it is
// on a shared board, publishedAt. The star rating is not part of a climb: each phone keeps its own (see Repo.getRatings), and
// the list and the viewer put it on the climbs they show as `stars` (0-5).

export const marksOf = (climb) => parseMarks(climb.holds);

/** The climbs the list shows: filtered by the search words, grade range, stars and whose they are, then sorted. `me` is your username. */
export function applyQuery(climbs, query, me = '') {
  const words = query.text.toLowerCase().split(' ').filter((word) => word.trim() !== '');
  const filtered = climbs.filter((climb) => {
    const name = climb.name.toLowerCase();
    const comment = (climb.comment || '').toLowerCase();
    const matchesText = words.every((word) => name.includes(word) || comment.includes(word));
    // A grade range that is narrower than everything hides climbs that have no grade yet.
    const matchesGrade =
      !gradeFiltered(query) || (climb.grade !== null && climb.grade >= query.minGrade && climb.grade <= query.maxGrade);
    const matchesScope = !query.scope || query.scope === 'all' || (isMine(climb, me) && (query.scope === 'mine' || !isUploaded(climb)));
    return matchesText && matchesGrade && matchesScope && (climb.stars || 0) >= query.minStars;
  });
  const newestFirst = (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  const by = {
    newest: newestFirst,
    oldest: (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    hardest: (a, b) => (b.grade ?? -1) - (a.grade ?? -1) || newestFirst(a, b),
    easiest: (a, b) => (a.grade ?? Infinity) - (b.grade ?? Infinity) || newestFirst(a, b),
    top: (a, b) => (b.stars || 0) - (a.stars || 0) || newestFirst(a, b),
    name: (a, b) => {
      const x = a.name.toLowerCase();
      const y = b.name.toLowerCase();
      return x < y ? -1 : x > y ? 1 : newestFirst(a, b);
    },
  };
  return filtered.sort(by[query.sort] || newestFirst);
}

/**
 * The climbs you can swipe through when viewing `startId`: the same ones, in the same order, as the list shows with the
 * search, filters and sort it has now. A climb the list would not show is still viewable, just alone.
 */
export function browseIds(climbs, query, startId, me = '') {
  const ids = applyQuery(climbs, query, me).map((climb) => climb.id);
  return ids.includes(startId) ? ids : [startId];
}
