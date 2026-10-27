import { app } from './app.js';
import { IdbStore, askToKeepData } from './data/db.js';
import { FirestoreRemote } from './data/firestore.js';
import { Repo } from './data/repo.js';
import { SyncService } from './data/sync.js';
import { FIREBASE } from './sync-config.js';
import { h, toast } from './ui/dom.js';
import { mountEditor } from './ui/editor.js';
import { mountImporter } from './ui/importer.js';
import { mountList } from './ui/list.js';
import { ensureDefaults, ensureIdentity, refreshDefaultWall } from './setup.js';
import { askForAccount } from './ui/account.js';
import { askForUsername } from './ui/username.js';
import { mountViewer } from './ui/viewer.js';
import { mountWalls } from './ui/walls.js';

// Screens are chosen by the part of the address after the "#", so every screen has its own link and the phone's back
// gesture works. Each screen function builds itself inside #app and returns { destroy() } (and may set a leave guard).

const routes = [
  [/^\/?$/, () => mountList],
  [/^\/walls$/, () => mountWalls],
  [/^\/climb\/([\w-]+)$/, (m) => (root) => mountViewer(root, { id: m[1] })],
  [/^\/edit\/([\w-]+)$/, (m) => (root) => mountEditor(root, { id: m[1] })],
  [/^\/import(?:\/(.+))?$/, (m) => (root) => mountImporter(root, { payload: m[1] || null })],
];

const root = document.getElementById('app');
let screen = null;
let showing = 0;
let renderedPath = null; // the address of the screen being shown
let handlingPop = false; // true while a back/forward step is being dealt with
let depth = 0; // how many screens deep we are in this visit, so the back arrow knows whether it can step back

const pathNow = () => location.hash.replace(/^#/, '');
const hashFor = (path) => `${location.pathname}${location.search}#${path}`;

async function render() {
  const ticket = ++showing;
  const path = pathNow();
  renderedPath = path;
  screen?.destroy?.();
  screen = null;
  root.replaceChildren();
  window.scrollTo(0, 0);
  for (const [pattern, make] of routes) {
    const match = pattern.exec(path);
    if (!match) continue;
    const wrapper = h('div', { class: 'screen' });
    root.append(wrapper);
    try {
      const mounted = await make(match)(wrapper);
      if (ticket !== showing) mounted?.destroy?.();
      else screen = mounted || {};
    } catch (error) {
      console.error(error);
      wrapper.replaceChildren(h('div', { class: 'empty' }, h('h2', {}, 'Something went wrong'), h('p', {}, String(error?.message || error)), h('button', { type: 'button', class: 'btn', onclick: () => app.nav.replace('/') }, 'Back to the list')));
    }
    return;
  }
  app.nav.replace('/');
}

async function canLeave() {
  if (!app.leaveGuard) return true;
  const ok = await app.leaveGuard();
  if (ok) app.leaveGuard = null;
  return ok;
}

app.nav = {
  /** Opens a screen on top of this one. */
  async go(path) {
    if (!(await canLeave())) return;
    depth++;
    history.pushState({ depth }, '', hashFor(path));
    render();
  },
  /** Swaps this screen for another, so back does not return here. */
  async replace(path) {
    if (!(await canLeave())) return;
    history.replaceState({ depth }, '', hashFor(path));
    render();
  },
  /** Back to the screen we came from, or to `fallback` if there is none (a link opened straight into this screen). */
  async back(fallback = '/') {
    if (!(await canLeave())) return;
    if (depth > 0) history.back();
    else this.replace(fallback);
  },
};

let reverting = false;
window.addEventListener('popstate', async (event) => {
  const target = event.state?.depth ?? 0;
  if (reverting) {
    reverting = false;
    depth = target;
    return;
  }
  handlingPop = true;
  try {
    if (app.leaveGuard) {
      // The back gesture already happened. If the screen has unsaved work and you want to keep it, step forward again.
      const delta = target - depth;
      if (!(await app.leaveGuard())) {
        reverting = true;
        history.go(-delta);
        return;
      }
      app.leaveGuard = null;
    }
    depth = target;
    render();
  } finally {
    handlingPop = false;
  }
});

// The address was changed after the "#" without going back or forward: a link pasted into a tab that already has the app
// open, or a hand-typed address. Back and forward also cause this event, but those are dealt with above.
window.addEventListener('hashchange', async () => {
  if (handlingPop || pathNow() === renderedPath) return;
  const wanted = pathNow();
  if (!(await canLeave())) {
    history.replaceState(history.state, '', hashFor(renderedPath));
    return;
  }
  depth++;
  history.replaceState({ depth }, '', hashFor(wanted));
  render();
});

async function start() {
  try {
    app.repo = new Repo(await IdbStore.open());
  } catch (error) {
    root.replaceChildren(h('div', { class: 'empty' }, h('h2', {}, 'SprayWall cannot save data here'), h('p', {}, String(error?.message || error))));
    return;
  }
  askToKeepData();
  await app.repo.upgradeData();
  startSync();
  await ensureIdentity({ repo: app.repo, sync: app.sync, askForAccount, askForUsername });
  await setUpDefaults({ first: true });
  // Signing in (or out) later: a phone that skipped the account joins the board as soon as it has one.
  app.sync.onState((key) => key === null && setUpDefaults({ first: false }));
  depth = history.state?.depth ?? 0;
  if (history.state === null) history.replaceState({ depth: 0 }, '', location.href);
  await render();
  registerServiceWorker();
}

let settingUp = null;

/**
 * Puts the default wall and board in place (see setup.js) behind a "setting up" screen, and says in a message if something
 * could not be done (it is tried again the next time the app opens). Switched off by ?nosync or ?nodefaults in the address.
 */
function setUpDefaults({ first }) {
  const params = new URLSearchParams(location.search);
  if (params.has('nosync') || params.has('nodefaults')) return Promise.resolve();
  settingUp ??= (async () => {
    const screen = h('div', { class: 'setup-screen', role: 'status' }, h('div', { class: 'setup-box' }, h('div', { class: 'spinner' }), h('p', {}, 'Setting up…')));
    const say = (text) => { screen.querySelector('p').textContent = text; };
    let shown = false;
    const progress = (text) => {
      if (!shown) { document.body.append(screen); shown = true; }
      say(text);
    };
    try {
      const result = await ensureDefaults({ repo: app.repo, sync: app.sync, progress });
      // A phone that has an older AV wall gets the new pack in the background, without holding up the app or showing the setting up screen.
      if (result.wall === 'had') refreshDefaultWall({ repo: app.repo }).then((outcome) => outcome === 'updated' && toast('The AV wall has been updated.')).catch(() => {});
      if (result.problem) toast(`${result.problem} It will try again next time, or use Walls → Get the AV wall.`);
      else if (first && result.wall === 'imported') toast(result.board === 'joined' ? 'The AV wall and its shared climbs are ready.' : 'The AV wall is ready.');
    } catch (error) {
      console.error(error);
    } finally {
      screen.remove();
      settingUp = null;
    }
  })();
  return settingUp;
}

/** Keeps walls that have a shared board in step with it. Without a Firebase project in sync-config.js there is no sync. */
function startSync() {
  const tokens = { load: () => app.repo.getMeta('syncAuth'), save: (auth) => app.repo.setMetaQuietly('syncAuth', auth) };
  // `?nosync` leaves the shared boards off (for developing and for the checks that must not touch the real database).
  const remote = FIREBASE && !new URLSearchParams(location.search).has('nosync') ? new FirestoreRemote({ config: FIREBASE, tokens }) : null;
  app.sync = new SyncService({ repo: app.repo, remote });
  app.sync.start();
}

/** Saves the app on the phone so it opens with no signal, and offers new versions when they arrive. */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) return;
  if (new URLSearchParams(location.search).has('nosw')) {
    // For developing: turn the offline copy off, so changed files show up straight away.
    navigator.serviceWorker.getRegistrations().then((all) => all.forEach((registration) => registration.unregister()));
    caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
    return;
  }
  navigator.serviceWorker.register('sw.js').then((registration) => {
    const offer = (worker) => toast('A new version of SprayWall is ready.', { label: 'Update', run: () => worker.postMessage('skip-waiting') });
    if (registration.waiting && navigator.serviceWorker.controller) offer(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
      });
    });
  }).catch(() => {});
  // When a new version takes over, reload once so the page and its files match. (Not on the very first visit, when the
  // worker is only now taking control of a page that was already loaded fine.)
  let reloaded = false;
  const hadWorker = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !hadWorker) return;
    reloaded = true;
    location.reload();
  });
}

start();
