// The real store: IndexedDB, the database every browser keeps for a web app. It is saved on the phone itself, so the app
// works with no signal. Same four calls as MemoryStore in repo.js.

const NAME = 'spraywall';
const VERSION = 1;
const KEY_FIELD = { walls: 'key', climbs: 'id', meta: 'k' };

const done = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export class IdbStore {
  constructor(db) {
    this.db = db;
  }

  static open() {
    return new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error('This browser cannot save data for the app (private browsing can cause this).'));
        return;
      }
      const request = indexedDB.open(NAME, VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('walls', { keyPath: KEY_FIELD.walls });
        const climbs = db.createObjectStore('climbs', { keyPath: KEY_FIELD.climbs });
        climbs.createIndex('wallKey', 'wallKey');
        db.createObjectStore('meta', { keyPath: KEY_FIELD.meta });
      };
      request.onsuccess = () => resolve(new IdbStore(request.result));
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close the other SprayWall tabs and try again.'));
    });
  }

  #table(name, mode) {
    return this.db.transaction(name, mode).objectStore(name);
  }

  get(table, key) {
    return done(this.#table(table, 'readonly').get(key));
  }

  async put(table, value) {
    await done(this.#table(table, 'readwrite').put(value));
  }

  async remove(table, key) {
    await done(this.#table(table, 'readwrite').delete(key));
  }

  all(table) {
    return done(this.#table(table, 'readonly').getAll());
  }
}

/** Asks the browser not to throw the app's data away when the phone is short of space. Not every browser agrees. */
export async function askToKeepData() {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
