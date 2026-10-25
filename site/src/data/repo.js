import { MAX_STARS, USERNAME_HELP, cleanUsername, cleanWallName, isMine, sameName } from '../domain/climbs.js';
import { makeShare } from '../domain/share.js';

// Everything the app remembers, behind one object. It talks to a "store" with four calls (get, put, remove, all) over
// three tables: walls (keyed by `key`), climbs (keyed by `id`) and meta (keyed by `k`). The real app uses IndexedDB
// (db.js); the tests use a store that lives in memory.
//
// A wall is { key, name, image (a Blob), imageWidth, imageHeight, holds, angle, updatedAt }.
// A climb is { id, wallKey, name, grade, comment, author, holds, createdAt, updatedAt } and, once deleted, keeps
// only { id, wallKey, name, deletedAt, updatedAt }. The deleted record is a marker that stops an old copy of the climb,
// arriving later in a shared file, from bringing it back.
// A climb starts as a draft: only on this phone, and it can be changed or deleted. Uploading it to a shared board gives it a
// `publishedAt`; from then on it can never be changed or deleted (a climb that came from a board has one too).
// Star ratings and "sent" marks are the owner's own and stay on this phone, in the meta table as `rating:<climb id>` and
// `sent:<climb id>` (when it was sent). The username is meta `author`.

export const newId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

export class MemoryStore {
  constructor() {
    this.tables = { walls: new Map(), climbs: new Map(), meta: new Map() };
  }
  async get(table, key) {
    const value = this.tables[table].get(key);
    return value === undefined ? undefined : structuredClone(value);
  }
  async put(table, value, key) {
    this.tables[table].set(key, structuredClone(value));
  }
  async remove(table, key) {
    this.tables[table].delete(key);
  }
  async all(table) {
    return [...this.tables[table].values()].map((value) => structuredClone(value));
  }
}

const KEY_FIELD = { walls: 'key', climbs: 'id', meta: 'k' };

export class Repo {
  constructor(store, now = () => Date.now()) {
    this.store = store;
    this.now = now;
    this.listeners = new Set();
  }

  /** Calls `listener` after anything changes. Returns a function that stops listening. */
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #changed() {
    for (const listener of this.listeners) listener();
  }

  async #put(table, value) {
    await this.store.put(table, value, value[KEY_FIELD[table]]);
  }

  // ---- settings ----

  async getMeta(k) {
    return (await this.store.get('meta', k))?.value;
  }

  async setMeta(k, value) {
    await this.#put('meta', { k, value });
    this.#changed();
  }

  /** Like setMeta, but nobody is told (for things the app keeps for itself, such as sign-in tokens). */
  async setMetaQuietly(k, value) {
    if (value === undefined) await this.store.remove('meta', k);
    else await this.#put('meta', { k, value });
  }

  /** The username that goes on the climbs you set ('' until one has been chosen). */
  authorName = async () => (await this.getMeta('author')) || '';

  /**
   * Chooses (or changes) the username. Climbs on this phone that have no name on them are yours and take it. By default a
   * change of name also renames your drafts (`renameDrafts: false` leaves them, for signing in as somebody else).
   * Once any climb of yours is uploaded the name is on a shared board for good, so it can no longer be changed, unless
   * `force` is given (an account decides the name then). Returns the cleaned name, or throws an Error saying why not.
   */
  async setUsername(text, { force = false, renameDrafts = true } = {}) {
    const name = cleanUsername(text);
    if (name === null) throw new Error(USERNAME_HELP);
    const old = await this.authorName();
    if (!force && old && !sameName(old, name) && !(await this.canChangeUsername())) throw new Error('You have uploaded climbs under your current username, so it cannot be changed.');
    await this.#put('meta', { k: 'author', value: name });
    for (const climb of await this.store.all('climbs')) {
      if (climb.deletedAt) continue;
      const unnamed = climb.author === '' || climb.author === undefined;
      const mineBefore = renameDrafts && old && sameName(climb.author, old) && !climb.publishedAt; // drafts follow a change of name
      if (unnamed || mineBefore) await this.#put('climbs', { ...climb, author: name });
    }
    this.#changed();
    return name;
  }

  /** True while none of your climbs is on a shared board. */
  async canChangeUsername() {
    const me = await this.authorName();
    return !(await this.store.all('climbs')).some((climb) => !climb.deletedAt && climb.publishedAt && isMine(climb, me));
  }

  // ---- star ratings (kept on this phone only) ----

  /** Every rating you have given: a Map from climb id to 1-5. */
  async getRatings() {
    const ratings = new Map();
    for (const { k, value } of await this.store.all('meta')) {
      if (k.startsWith('rating:') && Number.isInteger(value) && value >= 1 && value <= MAX_STARS) ratings.set(k.slice(7), value);
    }
    return ratings;
  }

  /** Your rating of a climb (0 if you have not rated it). */
  async getRating(id) {
    const value = await this.getMeta(`rating:${id}`);
    return Number.isInteger(value) && value >= 1 && value <= MAX_STARS ? value : 0;
  }

  /** Rates a climb 1-5, or with 0 takes the rating away. */
  async setRating(id, stars) {
    const clean = Math.max(0, Math.min(MAX_STARS, Math.round(Number(stars) || 0)));
    if (clean === 0) await this.store.remove('meta', `rating:${id}`);
    else await this.#put('meta', { k: `rating:${id}`, value: clean });
    this.#changed();
    return clean;
  }

  // ---- sent (completed) climbs, kept on this phone only ----

  /** Every climb you have marked as sent: a Map from climb id to when. */
  async getSent() {
    const sent = new Map();
    for (const { k, value } of await this.store.all('meta')) if (k.startsWith('sent:') && Number.isFinite(value) && value > 0) sent.set(k.slice(5), value);
    return sent;
  }

  /** When you sent a climb (0 if you have not). */
  async getSentAt(id) {
    const value = await this.getMeta(`sent:${id}`);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  /** Marks a climb as sent (now), or with false takes the mark away. Returns when it was sent, or 0. */
  async setSent(id, sent = true) {
    if (!sent) {
      await this.store.remove('meta', `sent:${id}`);
      this.#changed();
      return 0;
    }
    const at = this.now();
    await this.#put('meta', { k: `sent:${id}`, value: at });
    this.#changed();
    return at;
  }

  /**
   * Brings data from before ratings were separate up to date: a climb's own `stars` becomes your rating of it, and the field
   * goes. Safe to run every time the app starts. Returns how many climbs it touched.
   */
  async upgradeData() {
    let touched = 0;
    for (const climb of await this.store.all('climbs')) {
      if (!('stars' in climb)) continue;
      const { stars, ...rest } = climb;
      if (stars > 0 && !climb.deletedAt && !(await this.getRating(climb.id))) await this.#put('meta', { k: `rating:${climb.id}`, value: Math.min(MAX_STARS, stars) });
      await this.#put('climbs', rest);
      touched++;
    }
    return touched;
  }

  // ---- walls ----

  async listWalls() {
    return (await this.store.all('walls')).sort((a, b) => a.name.localeCompare(b.name));
  }

  getWall(key) {
    return this.store.get('walls', key);
  }

  /** The wall being climbed on: the one picked last, or the first one if that was deleted. */
  async activeWall() {
    const wanted = await this.getMeta('activeWall');
    const walls = await this.listWalls();
    return walls.find((wall) => wall.key === wanted) || walls[0] || null;
  }

  async setActiveWall(key) {
    await this.setMeta('activeWall', key);
  }

  /**
   * Adds a wall, or updates the wall with the same key. An update keeps the name you gave the wall and all its climbs.
   * Returns { wall, updated }.
   */
  async saveWall({ key, name, image, imageWidth, imageHeight, holds, angle }) {
    const existing = await this.getWall(key);
    const wall = {
      key,
      name: existing ? existing.name : name,
      image,
      imageWidth,
      imageHeight,
      holds,
      angle: angle ?? null,
      updatedAt: this.now(),
    };
    await this.#put('walls', wall);
    await this.setActiveWall(key);
    return { wall, updated: Boolean(existing) };
  }

  /** Returns false (and changes nothing) if the name is empty. */
  async renameWall(key, name) {
    const clean = cleanWallName(name);
    const wall = await this.getWall(key);
    if (clean === null || !wall) return false;
    await this.#put('walls', { ...wall, name: clean });
    this.#changed();
    return true;
  }

  /** Removes a wall and every climb on it. */
  async deleteWall(key) {
    for (const climb of await this.store.all('climbs')) if (climb.wallKey === key) await this.store.remove('climbs', climb.id);
    await this.store.remove('walls', key);
    await this.store.remove('meta', `sync:${key}`);
    this.#changed();
  }

  // ---- climbs ----

  async listClimbs(wallKey) {
    return (await this.store.all('climbs')).filter((climb) => climb.wallKey === wallKey && !climb.deletedAt);
  }

  async countClimbs(wallKey) {
    return (await this.listClimbs(wallKey)).length;
  }

  async getClimb(id) {
    const climb = await this.store.get('climbs', id);
    return climb && !climb.deletedAt ? climb : undefined;
  }

  /** Saves a new climb (no `id`), or changes a draft. A climb that is on a shared board cannot be changed. Returns the saved climb. */
  async saveClimb({ id, wallKey, name, grade, comment, holds }) {
    const now = this.now();
    const old = id ? await this.store.get('climbs', id) : undefined;
    if (old && !old.deletedAt && old.publishedAt) throw new Error('This climb is on a shared board, so it cannot be changed.');
    const live = old && !old.deletedAt;
    const climb = {
      id: old ? old.id : newId(),
      wallKey: old ? old.wallKey : wallKey,
      name: name.trim(),
      grade: grade ?? null,
      comment: comment.trim(),
      // The setter is whoever made the climb; editing someone else's climb does not take the credit.
      author: live ? old.author : await this.authorName(),
      holds,
      createdAt: live ? old.createdAt : now,
      updatedAt: Math.max(now, old ? old.updatedAt + 1 : 0),
    };
    await this.#put('climbs', climb);
    this.#changed();
    return climb;
  }

  /** Deletes a draft. A climb that is on a shared board cannot be deleted. */
  async deleteClimb(id) {
    const climb = await this.store.get('climbs', id);
    if (!climb || climb.deletedAt) return;
    if (climb.publishedAt) throw new Error('This climb is on a shared board, so it cannot be deleted.');
    const now = this.now();
    await this.#put('climbs', { id, wallKey: climb.wallKey, name: climb.name, deletedAt: now, updatedAt: now });
    this.#changed();
  }

  /** Notes that a draft is now on the shared board. From here on it cannot be changed or deleted. */
  async markPublished(id) {
    const climb = await this.store.get('climbs', id);
    if (!climb || climb.deletedAt || climb.publishedAt) return climb;
    const published = { ...climb, publishedAt: this.now() };
    await this.#put('climbs', published);
    this.#changed();
    return published;
  }

  // ---- the shared board (the steps are in sync.js) ----

  /** The board a wall is attached to: { code, lastPull, lastSyncedAt }, or undefined. */
  getSyncSetup(wallKey) {
    return this.getMeta(`sync:${wallKey}`);
  }

  /** Remembers (or with undefined, forgets) the board of a wall. Nobody is told: it is not a change to any climb. */
  setSyncSetup(wallKey, setup) {
    return this.setMetaQuietly(`sync:${wallKey}`, setup);
  }

  /**
   * Takes in climbs from the board (already checked and cleaned). The board is final: a climb you do not have is added, and a
   * draft of yours with the same id becomes the board's version. Climbs already published here are left alone.
   * Returns how many were added and how many drafts were replaced.
   */
  async applyPublished(wallKey, remotes) {
    const counts = { added: 0, replaced: 0 };
    for (const remote of remotes) {
      const mine = await this.store.get('climbs', remote.id);
      if (mine && mine.wallKey !== wallKey) continue; // the same id on another wall here: leave it alone
      if (mine && !mine.deletedAt && mine.publishedAt) continue;
      const { serverTime, ...fields } = remote;
      await this.#put('climbs', { ...fields, wallKey, publishedAt: this.now() });
      counts[mine && !mine.deletedAt ? 'replaced' : 'added']++;
    }
    if (counts.added + counts.replaced > 0) this.#changed();
    return counts;
  }

  // ---- sharing ----

  /** Everything on a wall, as a share, for a backup file. */
  async exportWall(wallKey) {
    const wall = await this.getWall(wallKey);
    if (!wall) throw new Error('No such wall.');
    return makeShare(wall, await this.listClimbs(wallKey));
  }

  /**
   * Works out what importing a share would do, without doing it. Each item says what would happen to that climb:
   * "new", "update" (the shared copy is newer than yours), "same", "older" (yours is newer, so it is kept) or
   * "deleted" (you deleted it here after that copy was made).
   */
  async planImport(parsed) {
    const wall = await this.getWall(parsed.wallKey);
    const items = [];
    for (const climb of parsed.climbs) {
      const mine = await this.store.get('climbs', climb.id);
      let status;
      if (!mine) status = 'new';
      else if (mine.deletedAt) status = climb.updatedAt > mine.deletedAt ? 'new' : 'deleted';
      else if (mine.publishedAt) status = 'same'; // on a shared board, so it is final
      else if (climb.updatedAt > mine.updatedAt) status = 'update';
      else if (climb.updatedAt === mine.updatedAt) status = 'same';
      else status = 'older';
      items.push({ climb, status });
    }
    return { wallKey: parsed.wallKey, wallName: parsed.wallName, wallKnown: Boolean(wall), items, skipped: parsed.skipped };
  }

  /** Carries out a plan from planImport. Returns how many climbs were added and updated. */
  async applyImport(plan) {
    if (!plan.wallKnown) throw new Error('The wall for these climbs has not been imported yet.');
    let added = 0;
    let updated = 0;
    const me = await this.authorName();
    for (const { climb, status } of plan.items) {
      if (status !== 'new' && status !== 'update') continue;
      // A climb with nobody's name on it (a file from before usernames) is taken to be the importer's own.
      await this.#put('climbs', { ...climb, author: climb.author || me, wallKey: plan.wallKey });
      if (status === 'new') added++;
      else updated++;
    }
    this.#changed();
    return { added, updated };
  }
}
