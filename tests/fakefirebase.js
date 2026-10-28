// A stand-in for Firebase, good enough to run the real sync code against: it answers the same web requests, in the same
// shapes, that data/firestore.js sends (create an account, sign in with a password, token refresh, create a board, read a
// board, add a climb with a server time stamp, read one, run the "newer than" query). It also checks what the real
// database's rules would check: only a signed-in account may use it, climbs can only be added, never changed or deleted,
// and a climb's author has to be the account that adds it.
// It is written from Google's documentation; the live project is the final proof (tools/firebase_check.py).

export class FakeFirebase {
  constructor({ apiKey = 'test-key', projectId = 'test-project', clock = { now: 1_800_000_000_000 } } = {}) {
    Object.assign(this, { apiKey, projectId, clock });
    this.docs = new Map(); // path under "documents/" -> { fields }
    this.users = new Map(); // email -> { password, uid }
    this.idTokens = new Map(); // token -> { email, until }
    this.refreshTokens = new Map(); // token -> email
    this.counter = 0;
    this.lastStamp = 0;
    this.offline = false;
    this.passwordSignInDisabled = false;
    this.quotaUsedUp = false;
    this.requests = []; // short descriptions, for tests that count what was asked
  }

  /** Makes every sign-in token stop working (an hour has passed). */
  expireTokens() {
    for (const [token, info] of this.idTokens) this.idTokens.set(token, { ...info, until: 0 });
  }

  /** Forgets all refresh tokens. */
  revokeRefreshTokens() {
    this.refreshTokens.clear();
  }

  /** Removes an account, as the project owner can in the Firebase console. */
  deleteUser(email) {
    this.users.delete(email);
    for (const [token, owner] of [...this.refreshTokens]) if (owner === email) this.refreshTokens.delete(token);
    for (const [token, info] of [...this.idTokens]) if (info.email === email) this.idTokens.delete(token);
  }

  fetch = async (url, init = {}) => {
    if (this.offline) throw new TypeError('Failed to fetch');
    const address = new URL(url);
    const body = init.body ? init.body : '';
    const headers = new Headers(init.headers || {});
    this.requests.push(`${init.method || 'GET'} ${address.pathname}`);
    if (address.host === 'identitytoolkit.googleapis.com') return this.#accounts(address, body);
    if (address.host === 'securetoken.googleapis.com') return this.#refresh(address, body);
    if (address.host === 'firestore.googleapis.com') return this.#firestore(address, init.method || 'GET', body, headers);
    return reply(404, { error: { message: 'unknown host' } });
  };

  #accounts(address, body) {
    if (address.searchParams.get('key') !== this.apiKey) return reply(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } });
    if (this.passwordSignInDisabled) return reply(400, { error: { code: 400, message: 'OPERATION_NOT_ALLOWED' } });
    const { email, password } = body ? JSON.parse(body) : {};
    if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply(400, { error: { code: 400, message: 'INVALID_EMAIL' } });
    if (address.pathname.endsWith(':signUp')) {
      if (this.users.has(email)) return reply(400, { error: { code: 400, message: 'EMAIL_EXISTS' } });
      if (typeof password !== 'string' || password.length < 6) return reply(400, { error: { code: 400, message: 'WEAK_PASSWORD : Password should be at least 6 characters' } });
      this.users.set(email, { password, uid: `user-${this.users.size + 1}` });
    } else if (address.pathname.endsWith(':signInWithPassword')) {
      if (this.users.get(email)?.password !== password) return reply(400, { error: { code: 400, message: 'INVALID_LOGIN_CREDENTIALS' } });
    } else {
      return reply(404, { error: { code: 404, message: 'unknown call' } });
    }
    return reply(200, { ...this.#newTokens(email, 'idToken', 'refreshToken', true), email });
  }

  #refresh(address, body) {
    if (address.searchParams.get('key') !== this.apiKey) return reply(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } });
    const form = new URLSearchParams(body);
    const email = this.refreshTokens.get(form.get('refresh_token'));
    if (form.get('grant_type') !== 'refresh_token' || !email) return reply(400, { error: { code: 400, message: 'TOKEN_EXPIRED' } });
    if (!this.users.has(email)) return reply(400, { error: { code: 400, message: 'USER_NOT_FOUND' } });
    return reply(200, this.#newTokens(email, 'id_token', 'refresh_token', false));
  }

  #newTokens(email, idName, refreshName, camel) {
    const id = `id-${++this.counter}`;
    const refresh = `refresh-${this.counter}`;
    this.idTokens.set(id, { email, until: this.clock.now + 3600_000 });
    this.refreshTokens.set(refresh, email);
    return { [idName]: id, [refreshName]: refresh, [camel ? 'expiresIn' : 'expires_in']: '3600', [camel ? 'localId' : 'user_id']: this.users.get(email).uid };
  }

  /** The email of the account the request is signed in as, or null. */
  #signedIn(headers) {
    const token = /^Bearer (.+)$/.exec(headers.get('Authorization') || '')?.[1];
    const info = token === undefined ? undefined : this.idTokens.get(token);
    return info && info.until > this.clock.now ? info.email : null;
  }

  #stamp() {
    this.lastStamp = Math.max(this.clock.now, this.lastStamp + 1);
    return `${new Date(this.lastStamp).toISOString().slice(0, -1)}${String(this.lastStamp % 1000).padStart(3, '0')}Z`; // 6 decimals, like the real one
  }

  #firestore(address, method, body, headers) {
    const root = `/v1/projects/${this.projectId}/databases/(default)/documents`;
    if (!address.pathname.startsWith(root)) return reply(404, { error: { status: 'NOT_FOUND', message: 'wrong project' } });
    const email = this.#signedIn(headers);
    // A token that is sent but no longer good is refused outright, even where the rules would let anybody in (like the real database).
    if (!email && headers.get('Authorization')) return reply(401, { error: { code: 401, status: 'UNAUTHENTICATED', message: 'Missing or invalid authentication' } });
    if (this.quotaUsedUp) return reply(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded.' } });
    const path = decodeURIComponent(address.pathname.slice(root.length)).replace(/^\//, '');
    const json = body ? JSON.parse(body) : {};

    // Reading needs no account; everything that writes does.
    if (!email && ((method === 'POST' && (path === 'boards' || path === ':commit')) || method === 'PATCH' || method === 'DELETE' || method === 'PUT')) return reply(403, DENIED);

    if (method === 'POST' && path === 'boards') {
      const code = address.searchParams.get('documentId');
      const fields = json.fields || {};
      const keys = Object.keys(fields);
      const ok = /^[a-z2-9]{16}$/.test(code || '') && keys.every((key) => ['wallKey', 'wallName', 'createdAt'].includes(key)) && fields.wallKey?.stringValue !== undefined && fields.wallName?.stringValue !== undefined && fields.createdAt?.integerValue !== undefined;
      if (!ok) return reply(403, DENIED);
      if (this.docs.has(`boards/${code}`)) return reply(409, { error: { code: 409, status: 'ALREADY_EXISTS', message: 'Document already exists' } });
      this.docs.set(`boards/${code}`, { fields });
      return reply(200, { name: `projects/${this.projectId}/databases/(default)/documents/boards/${code}`, fields });
    }

    if (method === 'GET' && /^boards\/[^/]+$/.test(path)) {
      const doc = this.docs.get(path);
      return doc ? reply(200, { name: `projects/${this.projectId}/databases/(default)/documents/${path}`, fields: doc.fields }) : reply(404, { error: { code: 404, status: 'NOT_FOUND', message: 'Document not found' } });
    }

    if (method === 'GET' && /^boards\/[^/]+\/climbs\/[^/]+$/.test(path)) {
      const doc = this.docs.get(path);
      return doc ? reply(200, { name: `projects/${this.projectId}/databases/(default)/documents/${path}`, fields: doc.fields }) : reply(404, { error: { code: 404, status: 'NOT_FOUND', message: 'Document not found' } });
    }

    if (method === 'POST' && path === ':commit') {
      const stamp = this.#stamp();
      const staged = [];
      for (const write of json.writes || []) {
        const name = write.update?.name || '';
        const match = /\/documents\/(boards\/([a-z2-9]{16})\/climbs\/([^/]+))$/.exec(name);
        const transforms = write.updateTransforms || [];
        const fields = { ...(write.update?.fields || {}) };
        if (!match || transforms.length !== 1 || transforms[0].fieldPath !== 'serverTime' || transforms[0].setToServerValue !== 'REQUEST_TIME') return reply(403, DENIED);
        // Only adding is allowed: without "does not exist yet" it could be a replacement, and the rules have no such rule.
        if (write.currentDocument?.exists !== false) return reply(403, DENIED);
        if (this.docs.has(match[1])) return reply(409, { error: { code: 409, status: 'ALREADY_EXISTS', message: 'Document already exists' } });
        fields.serverTime = { timestampValue: stamp };
        if (!climbIsValid(fields, match[3], email)) return reply(403, DENIED);
        staged.push([match[1], { fields }]);
      }
      for (const [docPath, doc] of staged) this.docs.set(docPath, doc);
      return reply(200, { writeResults: staged.map(() => ({ updateTime: stamp })), commitTime: stamp });
    }

    if (method === 'PATCH' || method === 'DELETE' || method === 'PUT') return reply(403, DENIED); // nothing is ever changed or deleted

    const query = /^boards\/([a-z2-9]{16}):runQuery$/.exec(path);
    if (method === 'POST' && query) {
      const q = json.structuredQuery;
      if (q?.from?.[0]?.collectionId !== 'climbs') return reply(400, { error: { code: 400, status: 'INVALID_ARGUMENT' } });
      const prefix = `boards/${query[1]}/climbs/`;
      let docs = [...this.docs].filter(([docPath]) => docPath.startsWith(prefix));
      const filter = q.where?.fieldFilter;
      if (filter) {
        const limit = filter.value.timestampValue;
        docs = docs.filter(([, doc]) => (filter.op === 'GREATER_THAN' ? doc.fields.serverTime.timestampValue > limit : doc.fields.serverTime.timestampValue >= limit));
      }
      docs.sort((a, b) => (a[1].fields.serverTime.timestampValue < b[1].fields.serverTime.timestampValue ? -1 : a[1].fields.serverTime.timestampValue > b[1].fields.serverTime.timestampValue ? 1 : a[0] < b[0] ? -1 : 1));
      docs = docs.slice(0, q.limit || 100);
      const readTime = this.#stamp();
      if (docs.length === 0) return reply(200, [{ readTime }]);
      return reply(200, docs.map(([docPath, doc]) => ({ document: { name: `projects/${this.projectId}/databases/(default)/documents/${docPath}`, fields: doc.fields }, readTime })));
    }

    return reply(404, { error: { code: 404, status: 'NOT_FOUND', message: `no such call: ${method} ${path}` } });
  }
}

const DENIED = { error: { code: 403, status: 'PERMISSION_DENIED', message: 'Missing or insufficient permissions.' } };

/** What firebase/firestore.rules asks of a climb. */
function climbIsValid(fields, id, email) {
  const allowed = ['name', 'grade', 'comment', 'author', 'holds', 'createdAt', 'serverTime'];
  const keys = Object.keys(fields);
  if (!keys.every((key) => allowed.includes(key))) return false;
  if (!['name', 'author', 'holds', 'createdAt', 'serverTime'].every((key) => keys.includes(key))) return false;
  const text = (key, min, max) => fields[key] === undefined || (typeof fields[key].stringValue === 'string' && fields[key].stringValue.length >= min && fields[key].stringValue.length <= max);
  const whole = (key, low, high) => fields[key] === undefined || (fields[key].integerValue !== undefined && Number(fields[key].integerValue) >= low && Number(fields[key].integerValue) <= high);
  const holds = fields.holds.stringValue ?? '';
  const author = fields.author.stringValue ?? '';
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) && /^[a-z0-9][a-z0-9_-]{2,19}$/.test(author) && email === `${author}@spraywall.example.com` && text('name', 1, 80) && text('author', 3, 20) && text('holds', 0, 20000) && text('comment', 0, 2000)
    && /^[0-9]+:(start|hand|foot|finish)(,[0-9]+:(start|hand|foot|finish))*$/.test(holds)
    && whole('grade', 0, 17) && whole('createdAt', 0, Infinity) && fields.createdAt.integerValue !== undefined;
}

function reply(status, data) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
