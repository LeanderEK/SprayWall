import { parseMarks } from './holds.js';

export const MAX_GRADE = 17;
export const MAX_STARS = 5;
export const MAX_WALL_NAME = 40;

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

export const SORTS = [
  ['newest', 'Newest'],
  ['oldest', 'Oldest'],
  ['hardest', 'Hardest'],
  ['easiest', 'Easiest'],
  ['top', 'Top rated'],
  ['name', 'Name'],
];

export const defaultQuery = () => ({ text: '', minGrade: 0, maxGrade: MAX_GRADE, minStars: 0, sort: 'newest' });
export const gradeFiltered = (query) => query.minGrade > 0 || query.maxGrade < MAX_GRADE;
export const filterCount = (query) => (gradeFiltered(query) ? 1 : 0) + (query.minStars > 0 ? 1 : 0);

// A climb is { id, wallKey, name, grade (0-17 or null), stars (0-5), comment, author, holds (text), createdAt, updatedAt }.

export const marksOf = (climb) => parseMarks(climb.holds);

/** The climbs the list shows: filtered by the search words, grade range and stars, then sorted. */
export function applyQuery(climbs, query) {
  const words = query.text.toLowerCase().split(' ').filter((word) => word.trim() !== '');
  const filtered = climbs.filter((climb) => {
    const name = climb.name.toLowerCase();
    const comment = (climb.comment || '').toLowerCase();
    const matchesText = words.every((word) => name.includes(word) || comment.includes(word));
    // A grade range that is narrower than everything hides climbs that have no grade yet.
    const matchesGrade =
      !gradeFiltered(query) || (climb.grade !== null && climb.grade >= query.minGrade && climb.grade <= query.maxGrade);
    return matchesText && matchesGrade && climb.stars >= query.minStars;
  });
  const newestFirst = (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  const by = {
    newest: newestFirst,
    oldest: (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    hardest: (a, b) => (b.grade ?? -1) - (a.grade ?? -1) || newestFirst(a, b),
    easiest: (a, b) => (a.grade ?? Infinity) - (b.grade ?? Infinity) || newestFirst(a, b),
    top: (a, b) => b.stars - a.stars || newestFirst(a, b),
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
export function browseIds(climbs, query, startId) {
  const ids = applyQuery(climbs, query).map((climb) => climb.id);
  return ids.includes(startId) ? ids : [startId];
}
