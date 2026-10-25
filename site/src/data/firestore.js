import { SyncError, emailFor, fromFields, idFromName, toFields } from '../domain/sync.js';

// The board's database, spoken to over plain web requests (Google's "REST" interface), so the app needs no library.
// Firebase is Google's free service for this. Two things are used:
//   - Authentication: an account is a username and a password (the username becomes an email-style name, see
//     domain/sync.js). Signing up fails if the username is taken, so usernames are unique. Signing in on any phone with the
//     same username and password gives that phone the account. The phone keeps a token, not the password;
//   - Firestore, the database: boards/<code> holds the board, boards/<code>/climbs/<id> holds one climb each.
// Who may do what is decided by the rules in firebase/firestore.rules, which are pasted into the Firebase console:
// anyone signed in who knows a board's code may read its climbs, and add climbs under their own username; nobody may
// change or delete one.

const SIGN_UP = 'https://identitytoolkit.googleapis.com/v1/accounts:signUp';
const SIGN_IN = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';
const REFRESH = 'https://securetoken.googleapis.com/v1/token';
const PAGE = 300; // climbs asked for at a time

export class FirestoreRemote {
  /**
   * `config` is { apiKey, projectId } of the Firebase project. `tokens` saves the sign-in between visits:
   * { load(): the saved value or undefined, save(value) }. `fetchImpl` and `now` are for testing.
   */
  constructor({ config, tokens, fetchImpl = (...args) => globalThis.fetch(...args), now = () => Date.now() }) {
    this.config = config;
    this.tokens = tokens;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.auth = undefined; // { idToken, refreshToken, expiresAt, username } once signed in, null when not
  }

  get #documents() {
    return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.config.projectId)}/databases/(default)/documents`;
  }

  // ---- sending requests ----

  async #send(url, { method = 'POST', json = null, form = null, token = null } = {}) {
    const headers = {};
    let body;
    if (json !== null) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form !== null) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    }
    if (token) headers.Authorization = `Bearer ${token}`;
    let response;
    try {
      response = await this.fetchImpl(url, { method, headers, body });
    } catch {
      throw new SyncError('offline', 'There is no connection right now.');
    }
    let data = null;
    try {
      data = await response.json();
    } catch {
      /* no body */
    }
    if (response.ok) return data;
    throw explain(response.status, data);
  }

  // ---- accounts ----

  /** Makes a new account. Throws SyncError('taken') if the username already has one. Returns the username. */
  async signUp(username, password) {
    return this.#password(SIGN_UP, username, password);
  }

  /** Signs in to an existing account (on any phone). Throws SyncError('credentials') if the username or password is wrong. */
  async signIn(username, password) {
    return this.#password(SIGN_IN, username, password);
  }

  async #password(url, username, password) {
    const data = await this.#send(`${url}?key=${encodeURIComponent(this.config.apiKey)}`, { json: { email: emailFor(username), password, returnSecureToken: true } });
    await this.#keep({ idToken: data.idToken, refreshToken: data.refreshToken, lifetime: Number(data.expiresIn), username });
    return username;
  }

  /** Forgets the sign-in on this phone. The account itself is untouched. */
  async signOut() {
    this.auth = null;
    await this.tokens.save(undefined);
  }

  /** { username } of the account signed in on this phone, or null. */
  async account() {
    if (this.auth === undefined) this.auth = (await this.tokens.load()) || null;
    return this.auth?.username ? { username: this.auth.username } : null;
  }

  async #refresh(refreshToken, username) {
    const data = await this.#send(`${REFRESH}?key=${encodeURIComponent(this.config.apiKey)}`, { form: { grant_type: 'refresh_token', refresh_token: refreshToken } });
    return this.#keep({ idToken: data.id_token, refreshToken: data.refresh_token, lifetime: Number(data.expires_in), username });
  }

  async #keep({ idToken, refreshToken, lifetime, username }) {
    if (typeof idToken !== 'string' || typeof refreshToken !== 'string') throw new SyncError('server', 'Firebase sent back something unexpected when signing in.');
    this.auth = { idToken, refreshToken, expiresAt: this.now() + (Number.isFinite(lifetime) ? lifetime : 3600) * 1000, username };
    await this.tokens.save(this.auth);
    return this.auth.idToken;
  }

  /** A token that is good for the next minute at least: the saved one, or a renewed one. Throws SyncError('signin') if not signed in. */
  async #token(force = false) {
    await this.account();
    if (!this.auth?.username) throw new SyncError('signin', 'Sign in to your account first.');
    if (!force && this.auth.expiresAt - 60_000 > this.now()) return this.auth.idToken;
    try {
      return await this.#refresh(this.auth.refreshToken, this.auth.username);
    } catch (error) {
      if (error.kind === 'offline') throw error;
      // The saved sign-in no longer works (the account was removed or switched off): it has to be done again.
      await this.signOut();
      throw new SyncError('signin', 'You have been signed out. Sign in again.');
    }
  }

  async #call(url, options = {}) {
    try {
      return await this.#send(url, { ...options, token: await this.#token() });
    } catch (error) {
      if (error.kind !== 'denied' || !this.auth?.username) throw error;
    }
    // Refused: the token may have just run out. Try once more with a new one.
    return this.#send(url, { ...options, token: await this.#token(true) });
  }

  // ---- the board ----

  /** Makes the board. Throws SyncError('exists') if there already is one with that code. */
  async createBoard(code, { wallKey, wallName }) {
    const fields = toFields({ wallKey, wallName, createdAt: this.now() });
    await this.#call(`${this.#documents}/boards?documentId=${encodeURIComponent(code)}`, { json: { fields } });
  }

  /** { wallKey, wallName }, or null if no board has that code. */
  async getBoard(code) {
    try {
      const doc = await this.#call(`${this.#documents}/boards/${encodeURIComponent(code)}`, { method: 'GET' });
      const fields = doc?.fields || {};
      const text = (key) => (typeof fields[key]?.stringValue === 'string' ? fields[key].stringValue : '');
      return { wallKey: text('wallKey'), wallName: text('wallName') };
    } catch (error) {
      if (error.kind === 'notfound') return null;
      throw error;
    }
  }

  // ---- the climbs ----

  /**
   * Adds a climb to the board (the plain record from toRecord). The database stamps it with its own clock as `serverTime`.
   * It can only be added, never replaced: a climb with this id that is already there gives SyncError('exists').
   */
  async createClimb(code, id, record) {
    const project = encodeURIComponent(this.config.projectId);
    const write = {
      update: { name: `projects/${project}/databases/(default)/documents/boards/${code}/climbs/${id}`, fields: toFields(record) },
      updateTransforms: [{ fieldPath: 'serverTime', setToServerValue: 'REQUEST_TIME' }],
      currentDocument: { exists: false },
    };
    await this.#call(`${this.#documents}:commit`, { json: { writes: [write] } });
  }

  /** Whether the board has a climb with this id. */
  async hasClimb(code, id) {
    try {
      await this.#call(`${this.#documents}/boards/${encodeURIComponent(code)}/climbs/${encodeURIComponent(id)}`, { method: 'GET' });
      return true;
    } catch (error) {
      if (error.kind === 'notfound') return false;
      throw error;
    }
  }

  /**
   * Climbs stamped after `since` (everything if it is null), oldest first, at most one page. `inclusive` includes the
   * stamp itself, to carry on after a full page. Each record has its `id` and `serverTime`; remember the last stamp as the new `since`.
   */
  async fetchClimbs(code, since, { inclusive = false } = {}) {
    const query = {
      from: [{ collectionId: 'climbs' }],
      orderBy: [{ field: { fieldPath: 'serverTime' }, direction: 'ASCENDING' }],
      limit: PAGE,
    };
    if (since) query.where = { fieldFilter: { field: { fieldPath: 'serverTime' }, op: inclusive ? 'GREATER_THAN_OR_EQUAL' : 'GREATER_THAN', value: { timestampValue: since } } };
    const answer = await this.#call(`${this.#documents}/boards/${encodeURIComponent(code)}:runQuery`, { json: { structuredQuery: query } });
    const records = (Array.isArray(answer) ? answer : [])
      .filter((item) => item && item.document)
      .map((item) => ({ id: idFromName(item.document.name), ...fromFields(item.document.fields) }));
    return { records, full: records.length >= PAGE };
  }
}

/** A readable SyncError for a failed web request. */
function explain(status, data) {
  const code = String(data?.error?.message || '');
  const state = String(data?.error?.status || '');
  if (/OPERATION_NOT_ALLOWED|ADMIN_ONLY_OPERATION/.test(code)) return new SyncError('setup', 'Email/Password sign-in is not switched on in the Firebase project (Authentication, Sign-in method).');
  if (/EMAIL_EXISTS/.test(code)) return new SyncError('taken', 'That username is taken. Pick another, or sign in if it is yours.');
  if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/.test(code)) return new SyncError('credentials', 'Wrong username or password.');
  if (/WEAK_PASSWORD/.test(code)) return new SyncError('weak', 'That password is too weak. Use at least 8 characters.');
  if (/USER_DISABLED/.test(code)) return new SyncError('disabled', 'This account has been switched off.');
  if (/TOO_MANY_ATTEMPTS/.test(code)) return new SyncError('tooMany', 'Too many tries. Wait a few minutes and try again.');
  if (/INVALID_EMAIL/.test(code)) return new SyncError('username', 'That username cannot be used. Try another.');
  if (/API key not valid|API_KEY_INVALID|INVALID_API_KEY/i.test(code) || /API_KEY/.test(state)) return new SyncError('setup', 'The Firebase API key in the app is not accepted.');
  if (status === 429 || state === 'RESOURCE_EXHAUSTED' || /QUOTA|TOO_MANY/.test(code)) return new SyncError('quota', 'The free daily limit of the shared database has been used up. It works again tomorrow.');
  if (status === 404 || state === 'NOT_FOUND') return new SyncError('notfound', 'Not found.');
  if (status === 409 || state === 'ALREADY_EXISTS') return new SyncError('exists', 'That already exists.');
  const detail = code ? ` (${code.slice(0, 140)})` : '';
  if (status === 401 || status === 403 || state === 'PERMISSION_DENIED' || state === 'UNAUTHENTICATED') return new SyncError('denied', `The shared database refused this. Its rules may not be set up yet.${detail}`);
  return new SyncError('server', `The shared database had a problem (${status}).${detail}`);
}
