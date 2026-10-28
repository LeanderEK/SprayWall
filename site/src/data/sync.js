import { USERNAME_HELP, cleanUsername, isUploaded, sameName, usernameProblem } from '../domain/climbs.js';
import { MEMORY } from '../defaults.js';
import { boardFits } from '../domain/wallpack.js';
import { SyncError, cleanPassword, cleanRemote, makeBoardCode, parseBoardCode, passwordProblem, stampValue, toRecord } from '../domain/sync.js';

// A wall's shared board. Everything works on the phone first; the board is only visited when there is a connection.
//   - Fetching: climbs other people (or your other phones) have uploaded since the last visit are added here. Uploaded
//     climbs never change, so there is nothing to merge: a climb is either here or it is not.
//   - Uploading: you choose, one climb at a time. A draft of yours goes to the board and from then on it can no longer be
//     edited or deleted, by anyone, you included.

const DELAYS = {
  first: 500, // after the app opens
  afterChange: 2500, // after anything changes here
  whileOpen: 2 * 60 * 1000, // and look for new climbs this often while the app is open
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

  /** What is happening with a wall's board, for showing. */
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

  /** One thing at a time, so two visits to the board never run over each other. */
  #exclusive(task) {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  #need() {
    if (!this.remote) throw new SyncError('setup', 'Sync is not switched on in this copy of the app.');
  }

  // ---- the account ----

  /** { username } of the account signed in on this phone, or null (also when sync is not switched on). */
  async account() {
    return this.remote ? this.remote.account() : null;
  }

  /**
   * Makes a new account with this username (unique: it fails if someone has it) and signs in. The drafts and unnamed climbs on
   * this phone become the new username's. Returns the username.
   */
  async signUp(name, password) {
    this.#need();
    const { username, secret } = this.#credentials(name, password);
    await this.remote.signUp(username, secret);
    await this.repo.setUsername(username, { force: true, renameDrafts: true });
    this.#changed();
    return username;
  }

  /** Signs in to an existing account, on this or any phone. Returns the username. */
  async signIn(name, password) {
    this.#need();
    const { username, secret } = this.#credentials(name, password);
    await this.remote.signIn(username, secret);
    await this.repo.setUsername(username, { force: true, renameDrafts: false });
    this.#changed();
    this.#recover();
    return username;
  }

  /** Signs out on this phone. Its climbs stay; uploading and receiving climbs wait for the next sign-in. */
  async signOut() {
    await this.remote?.signOut();
    this.#changed();
  }

  #credentials(name, password) {
    const username = cleanUsername(name);
    if (username === null) throw new SyncError('username', usernameProblem(name) ?? USERNAME_HELP);
    const secret = cleanPassword(password);
    if (secret === null) throw new SyncError('password', passwordProblem(password));
    return { username, secret };
  }

  #changed() {
    for (const listener of this.listeners) listener(null);
  }

  /** After signing in again, errors that were only about being signed out can go. */
  #recover() {
    for (const [wallKey, state] of this.states) if (state.kind === 'signin') this.states.set(wallKey, { status: 'idle', message: '', at: state.at });
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

  /** Joins the board with this code (as typed or pasted). The board must be for the same wall. Returns the code. */
  async joinBoard(wallKey, text) {
    this.#need();
    const code = parseBoardCode(text);
    const board = await this.remote.getBoard(code);
    if (!board) throw new SyncError('notfound', 'There is no board with that code. Check it and try again.');
    if (!boardFits(board.wallKey, wallKey)) {
      throw new SyncError('wall', `That board is for the wall “${board.wallName || board.wallKey}”, not this one. Open that wall first (or import its wall pack).`);
    }
    await this.#begin(wallKey, code);
    return code;
  }

  /** Remembers the board and fetches its climbs. The board is joined even if that first fetch cannot happen yet. */
  async #begin(wallKey, code) {
    await this.repo.setSyncSetup(wallKey, { code, lastPull: null, lastSyncedAt: null });
    this.#setState(wallKey, { status: 'idle' });
    await this.syncWall(wallKey).catch(() => {}); // a problem shows in the wall's state
  }

  /** Stops using the board on this phone. Its climbs stay here (uploaded ones stay uploaded). It is not joined again by itself. */
  async stop(wallKey) {
    await this.repo.setSyncSetup(wallKey, undefined);
    await this.repo.setMetaQuietly(MEMORY.board, 'stopped');
    this.states.delete(wallKey);
    for (const listener of this.listeners) listener(wallKey);
  }

  // ---- fetching ----

  /** Fetches the new climbs of one wall's board now. Resolves with { added, replaced }, or null if the wall has no board. */
  syncWall(wallKey) {
    return this.#exclusive(() => this.#fetch(wallKey));
  }

  /** Does that for every wall that has a board. Never throws: problems show up in each wall's state. */
  async syncAll() {
    if (!this.remote) return;
    for (const wall of await this.repo.listWalls()) {
      if (!(await this.repo.getSyncSetup(wall.key))) continue;
      await this.syncWall(wall.key).catch(() => {});
    }
  }

  async #fetch(wallKey) {
    const setup = await this.repo.getSyncSetup(wallKey);
    if (!setup || !this.remote) return null;
    this.#setState(wallKey, { status: 'syncing' });
    const result = { added: 0, replaced: 0 };
    try {
      let since = setup.lastPull;
      let latest = setup.lastPull;
      let inclusive = false;
      for (let page = 0; page < 200; page++) {
        const { records, full } = await this.remote.fetchClimbs(setup.code, since, { inclusive });
        const clean = records.map((record) => cleanRemote(record.id, record, this.now())).filter(Boolean);
        const counts = await this.repo.applyPublished(wallKey, clean);
        result.added += counts.added;
        result.replaced += counts.replaced;
        // Stamps come from the database's own clock. One from the far future (someone with the code could write one) is
        // ignored, or it would make this phone skip everything stamped after it.
        const stamps = records.map((record) => record.serverTime).filter((stamp) => stampValue(stamp) / 1000 <= this.now() + DAY);
        if (stamps.length) latest = stamps.reduce((a, b) => (stampValue(b) > stampValue(a) ? b : a));
        if (!full || !stamps.length || latest === since) break;
        since = latest;
        inclusive = true; // a full page may end in the middle of climbs stamped together, so look at that stamp again
      }
      const at = this.now();
      await this.repo.setSyncSetup(wallKey, { ...setup, lastPull: latest, lastSyncedAt: at });
      this.states.set(wallKey, { status: 'ok', message: '', at });
      for (const listener of this.listeners) listener(wallKey);
      return result;
    } catch (error) {
      throw this.#failed(wallKey, error);
    }
  }

  #failed(wallKey, error) {
    const known = error instanceof SyncError ? error : new SyncError('server', 'Something went wrong while syncing.');
    if (!(error instanceof SyncError)) console.error(error);
    if (known.kind === 'offline') this.#setState(wallKey, { status: 'offline', message: 'Offline. New climbs arrive when you are back online.' });
    else this.#setState(wallKey, { status: 'error', kind: known.kind, message: known.message });
    return known;
  }

  // ---- uploading ----

  /**
   * Uploads one of your drafts to its wall's board. Afterwards it cannot be edited or deleted. Throws a SyncError saying
   * why not if it is not yours, not a draft, or there is no board or connection.
   */
  upload(climbId) {
    return this.#exclusive(() => this.#upload(climbId));
  }

  async #upload(climbId) {
    this.#need();
    const climb = await this.repo.getClimb(climbId);
    if (!climb) throw new SyncError('mine', 'That climb is not on this phone any more.');
    if (isUploaded(climb)) throw new SyncError('mine', 'That climb is already uploaded.');
    const account = await this.remote.account();
    if (!account) throw new SyncError('signin', 'Sign in to your account to upload.');
    if (!sameName(climb.author, account.username)) throw new SyncError('mine', `Only climbs made under your username (${account.username}) can be uploaded.`);
    const setup = await this.repo.getSyncSetup(climb.wallKey);
    if (!setup) throw new SyncError('board', 'Start or join a board for this wall first (share button, Sync with friends).');
    try {
      await this.remote.createClimb(setup.code, climb.id, toRecord(climb));
    } catch (error) {
      // Already there: an earlier try got through even though its answer was lost. That is the outcome wanted.
      const alreadyThere = error.kind === 'exists' || (error.kind === 'denied' && (await this.remote.hasClimb(setup.code, climb.id).catch(() => false)));
      if (!alreadyThere) throw this.#failed(climb.wallKey, error);
    }
    await this.repo.markPublished(climb.id);
    this.#setState(climb.wallKey, { status: 'ok', at: this.now() });
    return climb.id;
  }

  // ---- when to look for new climbs ----

  /** Fetches now and then from here on: after changes, when the app comes back, when the connection returns, and every
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
