import { cleanWallName } from '../domain/climbs.js';
import { makeShare } from '../domain/share.js';
import { decideRemote, syncMark, versionOf } from '../domain/sync.js';

// Everything the app remembers, behind one object. It talks to a "store" with four calls (get, put, remove, all) over
// three tables: walls (keyed by `key`), climbs (keyed by `id`) and meta (keyed by `k`). The real app uses IndexedDB
// (db.js); the tests use a store that lives in memory.
//
// A wall is { key, name, image (a Blob), imageWidth, imageHeight, holds, angle, updatedAt }.
// A climb is { id, wallKey, name, grade, stars, comment, author, holds, createdAt, updatedAt } and, once deleted, keeps
// only { id, wallKey, name, deletedAt, updatedAt }. The deleted record is a marker that stops an old copy of the climb,
// arriving later in a shared file, from bringing it back.
// A climb that is kept in sync also carries a `syncMark` ("<board code>:<version>") saying which version of it the shared
// board has. Any change made here builds the climb afresh, which drops the mark, and that is how "needs sending" is known.

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

  /** The name that goes on the climbs you set. */
  authorName = async () => (await this.getMeta('author')) || '';

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

  /** Saves a new climb (no `id`), or changes an existing one. Returns the saved climb. */
  async saveClimb({ id, wallKey, name, grade, stars, comment, holds }) {
    const now = this.now();
    const old = id ? await this.store.get('climbs', id) : undefined;
    const climb = {
      id: old ? old.id : newId(),
      wallKey: old ? old.wallKey : wallKey,
      name: name.trim(),
      grade: grade ?? null,
      stars,
      comment: comment.trim(),
      // The setter is whoever made the climb; editing someone else's climb does not take the credit.
      author: old && !old.deletedAt ? old.author : await this.authorName(),
      holds,
      createdAt: old && !old.deletedAt ? old.createdAt : now,
      updatedAt: Math.max(now, old ? old.updatedAt + 1 : 0),
    };
    await this.#put('climbs', climb);
    this.#changed();
    return climb;
  }

  async deleteClimb(id) {
    const climb = await this.store.get('climbs', id);
    if (!climb || climb.deletedAt) return;
    const now = this.now();
    await this.#put('climbs', { id, wallKey: climb.wallKey, name: climb.name, deletedAt: now, updatedAt: now });
    this.#changed();
  }

  // ---- syncing with a shared board (the steps are in sync.js) ----

  /** The board a wall is kept in sync with: { code, lastPull, lastSyncedAt }, or undefined. */
  getSyncSetup(wallKey) {
    return this.getMeta(`sync:${wallKey}`);
  }

  /** Remembers (or with undefined, forgets) the board of a wall. Nobody is told: it is not a change to any climb. */
  setSyncSetup(wallKey, setup) {
    return this.setMetaQuietly(`sync:${wallKey}`, setup);
  }

  /** Every climb of the wall, deleted ones too, that the board `code` does not have the current version of. */
  async climbsToSend(wallKey, code) {
    return (await this.store.all('climbs')).filter((climb) => climb.wallKey === wallKey && climb.syncMark !== syncMark(code, climb));
  }

  /** Notes that these climbs, as they were when sent, are now on the board. A climb changed since then stays unsent. */
  async markSent(code, sent) {
    for (const was of sent) {
      const now = await this.store.get('climbs', was.id);
      if (now && versionOf(now) === versionOf(was)) await this.#put('climbs', { ...now, syncMark: syncMark(code, now) });
    }
  }

  /**
   * Takes in climbs from the board (already checked and cleaned). Each is added, replaces yours, deletes yours or is
   * ignored, as decideRemote says. Returns how many were added, updated and deleted.
   */
  async applySynced(wallKey, code, remotes) {
    const counts = { added: 0, updated: 0, deleted: 0 };
    for (const remote of remotes) {
      const mine = await this.store.get('climbs', remote.id);
      if (mine && mine.wallKey !== wallKey) continue; // the same id on another wall here: leave it alone
      const action = decideRemote(mine, remote);
      const { serverTime, ...fields } = remote;
      if (action === 'add' || action === 'update') {
        const climb = { ...fields, wallKey };
        await this.#put('climbs', { ...climb, syncMark: syncMark(code, climb) });
        counts[action === 'add' ? 'added' : 'updated']++;
      } else if (action === 'delete' || action === 'remember') {
        const gone = { id: remote.id, wallKey, name: remote.name, deletedAt: remote.deletedAt, updatedAt: remote.deletedAt };
        await this.#put('climbs', { ...gone, syncMark: syncMark(code, gone) });
        if (action === 'delete') counts.deleted++;
      } else if (action === 'same' && mine.syncMark !== syncMark(code, mine)) {
        await this.#put('climbs', { ...mine, syncMark: syncMark(code, mine) });
      }
    }
    if (counts.added + counts.updated + counts.deleted > 0) this.#changed();
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
    for (const { climb, status } of plan.items) {
      if (status !== 'new' && status !== 'update') continue;
      await this.#put('climbs', { ...climb, wallKey: plan.wallKey });
      if (status === 'new') added++;
      else updated++;
    }
    this.#changed();
    return { added, updated };
  }
}
