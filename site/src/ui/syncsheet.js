import { app } from '../app.js';
import { askForAccount } from './account.js';
import { SyncError, showBoardCode } from '../domain/sync.js';
import { confirmDialog, copyText, h, openSheet, shareText, toast } from './dom.js';

const ago = (then, now = Date.now()) => {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} days ago`;
};

/** One line saying how the wall's sync is doing. */
export function syncStatusText(state, setup, now = Date.now()) {
  if (!setup) return '';
  if (state.status === 'syncing') return 'Syncing…';
  if (state.status === 'offline') return state.message;
  if (state.status === 'error') return state.message;
  const at = state.at || setup.lastSyncedAt;
  return at ? `Synced ${ago(at, now)}` : 'Not synced yet';
}

/** The "Sync with friends" panel for the wall being climbed on. */
export async function openSyncSheet() {
  const { repo, sync } = app;
  const wall = await repo.activeWall();
  if (!wall) return toast('Set up a wall first.');

  const body = h('div', { class: 'sheet-body' });
  let sheet;
  let busy = false;
  let problem = '';
  const stopListening = sync.onState((key) => (key === wall.key || key === null) && render());

  const run = async (work) => {
    if (busy) return;
    busy = true;
    problem = '';
    render();
    try {
      await work();
    } catch (error) {
      problem = error instanceof SyncError ? error.message : 'Something went wrong.';
      if (!(error instanceof SyncError)) console.error(error);
    }
    busy = false;
    render();
  };

  async function render() {
    if (!body.isConnected && sheet) return; // closed
    const setup = await repo.getSyncSetup(wall.key);
    const account = sync.available ? await sync.account() : null;
    const pieces = [];
    if (!sync.available) {
      pieces.push(h('p', {}, 'Sync is not switched on in this copy of SprayWall yet.'));
    } else if (!account) {
      pieces.push(
        h('p', {}, 'Boards need your account, so that every climb has its maker\'s username on it and nobody can pass as somebody else. Your username is unique and works on any phone.'),
        h('div', { class: 'row-buttons' }, h('button', { type: 'button', class: 'btn primary', onclick: async () => { await askForAccount({ sync, canSkip: true }); render(); } }, 'Sign in or create account')),
      );
    } else if (!setup) {
      const codeInput = h('input', { class: 'field', type: 'text', placeholder: 'k7f2-9xqm-c4ta-p8dn', 'aria-label': 'Board code', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' });
      pieces.push(
        h('p', {}, `A board lets friends share climbs on “${wall.name}”. Climbs you make stay on your phone as drafts. When one is ready, press Upload on it and everyone on the board gets it. New climbs from friends arrive by themselves whenever the app is open and online.`),
        h('p', { class: 'note' }, 'An uploaded climb can never be edited or deleted, by anyone. Star ratings stay on each person’s own phone.'),
        h('div', { class: 'row-buttons' }, h('button', { type: 'button', class: 'btn primary', disabled: busy, onclick: () => run(async () => { await sync.createBoard(wall.key); }) }, 'Start a board')),
        h('h3', {}, 'Or join a friend’s board'),
        h('label', { class: 'field-label' }, 'Board code', codeInput),
        h('div', { class: 'row-buttons' }, h('button', { type: 'button', class: 'btn', disabled: busy, onclick: () => run(async () => { await sync.joinBoard(wall.key, codeInput.value); }) }, 'Join')),
      );
    } else {
      const state = sync.stateOf(wall.key);
      const code = showBoardCode(setup.code);
      pieces.push(
        h('div', { class: 'board-code-label' }, 'Board code'),
        h('div', { class: 'board-code' }, code),
        h('div', { class: 'row-buttons' },
          h('button', { type: 'button', class: 'btn', onclick: async () => toast((await copyText(code)) ? 'Code copied.' : 'Could not copy the code.') }, 'Copy'),
          h('button', { type: 'button', class: 'btn', onclick: () => shareText(`Join my SprayWall board for “${wall.name}”: ${code}\nIn SprayWall tap the share button, then Sync with friends, then Join.`, 'SprayWall board') }, 'Share')),
        h('p', { class: 'note' }, 'Anyone who has this code can see the climbs on this board and upload their own. Uploaded climbs can never be edited or deleted. Only give the code to people you trust.'),
        h('div', { class: state.status === 'error' ? 'sync-status bad' : 'sync-status' }, syncStatusText(state, setup)),
        h('div', { class: 'row-buttons' }, h('button', { type: 'button', class: 'btn', disabled: busy || state.status === 'syncing', onclick: () => run(() => sync.syncWall(wall.key)) }, 'Check for new climbs')),
        h('div', { class: 'row-buttons' }, h('button', { type: 'button', class: 'text-btn danger', onclick: stopSyncing }, 'Stop syncing on this phone')),
      );
    }
    if (busy) pieces.push(h('div', { class: 'sync-status' }, 'Working…'));
    if (problem && (!setup || problem !== sync.stateOf(wall.key).message)) pieces.push(h('div', { class: 'sync-status bad' }, problem));
    body.replaceChildren(...pieces);
  }

  async function stopSyncing() {
    if (!(await confirmDialog({ title: 'Stop syncing?', text: 'Climbs on this phone stay, uploaded ones too. You just stop getting new ones and cannot upload. You can rejoin later with the board code.', confirmLabel: 'Stop syncing', danger: true }))) return;
    await sync.stop(wall.key);
    render();
  }

  sheet = openSheet('Sync with friends', body, { onClose: stopListening });
  await render();
}
