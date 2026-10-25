import { SyncError, cleanRemote, makeBoardCode, parseBoardCode, stampValue, toRecord } from '../domain/sync.js';

// Keeping a wall's climbs in step with a shared board. Everything works on the phone first; the board is only visited
// when there is a connection. One visit ("a sync") does two things, in this order:
//   1. fetch what the board gained since the last visit, and take it in (newest change wins, deletions are kept);
//   2. send the climbs the board does not have the current version of yet.
// Fetching first means a phone that was offline for a while does not overwrite newer edits with its old ones.

const DELAYS = {
  first: 500, // after the app opens
  afterChange: 2500, // after you change something, so a burst of changes is sent together
  whileOpen: 2 * 60 * 1000, // and look for friends' changes this often while the app is open
};
const DAY = 24 * 60 * 60 * 1000;

export class SyncService {
  /** `remote` is a FirestoreRemote (or null when this copy of the app has no Firebase project to talk to). */
  constructor({ repo, remote, now = () => Date.now(), delays = {} }) {
    this.repo = repo;
    this.remote = remote;
    this.now = now;
    this.delays = { ...DELAYS, ...delays };
    this.states = new Map(); // wallKey -> { status: 'idle' | 'syncing' | 'ok' | 'offline' | 'error', message, at }
    this.listeners = new Set();
    this.queue = Promise.resolve();
    this.timer = null;
    this.stops = [];
  }

  get available() {
    return this.remote !== null;
  }

  /** What is happening with a wall's sync, for showing. */
  stateOf(wallKey) {
    return this.states.get(wallKey) || { status: 'idle', message: '', at: null };
  }

  /** Calls `listener` whenever any wall's state changes. Returns a function that stops listening. */
  onState(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #setState(wallKey, state) {
    this.states.set(wallKey, { message: '', at: this.stateOf(wallKey).at, ...state });
    for (const listener of this.listeners) listener(wallKey);
  }

  /** One thing at a time, so two syncs never run over each other. */
  #exclusive(task) {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  // ---- starting and stopping ----

  /** Creates a new board for a wall, shared by whoever you give the code to. Returns the code. */
  async createBoard(wallKey) {
    this.#need();
    const wall = await this.repo.getWall(wallKey);
    if (!wall) throw new SyncError('wall', 'That wall is not on this phone.');
    let code;
    for (let attempt = 0; ; attempt++) {
      code = makeBoardCode();
      try {
        await this.remote.createBoard(code, { wallKey, wallName: wall.name });
        break;
      } catch (error) {
        if (error.kind !== 'exists' || attempt >= 2) throw error; // a code is never taken in practice; try again if it is
      }
    }
    await this.#begin(wallKey, code);
    return code;
  }

  /** Remembers the board and does the first sync. The board is joined even if that first sync cannot happen yet. */
  async #begin(wallKey, code) {
    await this.repo.setSyncSetup(wallKey, { code, lastPull: null, lastSyncedAt: null });
    this.#setState(wallKey, { status: 'idle' });
    await this.syncWall(wallKey).catch(() => {}); // a problem shows in the wall's state
  }

  /** Joins the board with this code (as typed or pasted). The board must be for the same wall. Returns the code. */
  async joinBoard(wallKey, text) {
    this.#need();
    const code = parseBoardCode(text);
    const board = await this.remote.getBoard(code);
    if (!board) throw new SyncError('notfound', 'There is no board with that code. Check it and try again.');
    if (board.wallKey !== wallKey) {
      throw new SyncError('wall', `That board is for the wall “${board.wallName || board.wallKey}”, not this one. Open that wall first (or import its wall pack).`);
    }
    await this.#begin(wallKey, code);
    return code;
  }

  /** Stops syncing this wall. Its climbs stay on the phone; the board keeps what is on it. */
  async stop(wallKey) {
    await this.repo.setSyncSetup(wallKey, undefined);
    this.states.delete(wallKey);
    for (const listener of this.listeners) listener(wallKey);
  }

  #need() {
    if (!this.remote) throw new SyncError('setup', 'Sync is not switched on in this copy of the app.');
  }

  // ---- the sync itself ----

  /** Syncs one wall now. Resolves with { added, updated, deleted, sent }, or null if there was nothing to do. */
  syncWall(wallKey) {
    return this.#exclusive(() => this.#syncWall(wallKey));
  }

  /** Syncs every wall that has a board. Never throws: problems show up in each wall's state. */
  async syncAll() {
    if (!this.remote) return;
    for (const wall of await this.repo.listWalls()) {
      if (!(await this.repo.getSyncSetup(wall.key))) continue;
      await this.syncWall(wall.key).catch(() => {});
    }
  }

  async #syncWall(wallKey) {
    const setup = await this.repo.getSyncSetup(wallKey);
    if (!setup || !this.remote) return null;
    this.#setState(wallKey, { status: 'syncing' });
    const result = { added: 0, updated: 0, deleted: 0, sent: 0 };
    try {
      // 1. fetch
      let since = setup.lastPull;
      let latest = setup.lastPull;
      let inclusive = false;
      for (let page = 0; page < 100; page++) {
        const { records, full } = await this.remote.fetchClimbs(setup.code, since, { inclusive });
        const clean = records.map((record) => cleanRemote(record, this.now())).filter(Boolean);
        const counts = await this.repo.applySynced(wallKey, setup.code, clean);
        result.added += counts.added;
        result.updated += counts.updated;
        result.deleted += counts.deleted;
        // Stamps come from the database's own clock. One from the far future (someone with the code could write one) is
        // ignored, or it would make this phone skip everything stamped after it.
        const stamps = records.map((record) => record.serverTime).filter((stamp) => stampValue(stamp) / 1000 <= this.now() + DAY);
        if (stamps.length) latest = stamps.reduce((a, b) => (stampValue(b) > stampValue(a) ? b : a));
        if (!full || !stamps.length || latest === since) break;
        since = latest;
        inclusive = true; // a full page may end in the middle of climbs sent together, so look at that stamp again
      }
      // 2. send
      const unsent = await this.repo.climbsToSend(wallKey, setup.code);
      if (unsent.length) {
        await this.remote.sendClimbs(setup.code, unsent.map(toRecord));
        await this.repo.markSent(setup.code, unsent);
        result.sent = unsent.length;
      }
      const at = this.now();
      await this.repo.setSyncSetup(wallKey, { ...setup, lastPull: latest, lastSyncedAt: at });
      this.states.set(wallKey, { status: 'ok', message: '', at });
      for (const listener of this.listeners) listener(wallKey);
      return result;
    } catch (error) {
      const known = error instanceof SyncError ? error : new SyncError('server', 'Something went wrong while syncing.');
      if (!(error instanceof SyncError)) console.error(error);
      if (known.kind === 'offline') this.#setState(wallKey, { status: 'offline', message: 'Offline. Changes are sent when you are back online.' });
      else this.#setState(wallKey, { status: 'error', message: known.message });
      throw known;
    }
  }

  // ---- when to sync ----

  /** Syncs now and then from here on: after changes, when the app comes back, when the connection returns, and every
   * couple of minutes while it is open. */
  start(target = globalThis) {
    if (!this.remote || this.stops.length) return;
    const soon = (ms) => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.syncAll(), ms);
    };
    const visible = () => target.document?.visibilityState !== 'hidden';
    const onVisible = () => visible() && soon(300);
    this.stops.push(this.repo.onChange(() => soon(this.delays.afterChange)));
    target.addEventListener?.('online', onVisible);
    target.document?.addEventListener?.('visibilitychange', onVisible);
    const every = setInterval(() => visible() && this.syncAll(), this.delays.whileOpen);
    this.stops.push(() => {
      target.removeEventListener?.('online', onVisible);
      target.document?.removeEventListener?.('visibilitychange', onVisible);
      clearInterval(every);
      clearTimeout(this.timer);
    });
    soon(this.delays.first);
  }

  destroy() {
    for (const stop of this.stops) stop();
    this.stops = [];
  }
}
