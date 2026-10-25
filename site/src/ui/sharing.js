import { app } from '../app.js';
import { makeShare, packShare, parseShare, linkFor, shareToText, ShareError, unpackShare } from '../domain/share.js';
import { copyText, filePickerButton, h, isIos, isStandalone, openSheet, shareFile, shareLink, toast } from './dom.js';
import { openSyncSheet, syncStatusText } from './syncsheet.js';

// Everything about getting climbs to and from other people: files, links, pasted links, and a backup of everything.

const today = () => new Date().toISOString().slice(0, 10);
const fileSafe = (text) => text.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'climb';

/** The address of the app itself, without any "#..." on the end. */
const appAddress = () => location.href.split('#')[0];

/** Opens the review screen for something that arrived as a file, link or paste. */
export function reviewImport(parsed) {
  app.pending = parsed;
  app.nav.go('/import');
}

/** Reads one or more climb files (.json). All of them must be for the same wall. */
export async function importFiles(files) {
  try {
    let merged = null;
    for (const file of files) {
      if (file.size > 5_000_000) throw new ShareError(`"${file.name}" is too big to be a climbs file.`);
      const parsed = parseShare(await file.text());
      if (!merged) merged = parsed;
      else if (merged.wallKey !== parsed.wallKey) throw new ShareError('Those files are for different walls. Open them one at a time.');
      else {
        const byId = new Map(merged.climbs.map((climb) => [climb.id, climb]));
        for (const climb of parsed.climbs) if (!byId.has(climb.id) || byId.get(climb.id).updatedAt < climb.updatedAt) byId.set(climb.id, climb);
        merged = { ...merged, climbs: [...byId.values()], skipped: merged.skipped + parsed.skipped };
      }
    }
    reviewImport(merged);
  } catch (error) {
    toast(error instanceof ShareError ? error.message : 'Could not read that file.');
  }
}

export async function importPasted(text) {
  try {
    reviewImport(await unpackShare(text));
  } catch (error) {
    toast(error instanceof ShareError ? error.message : 'Could not read that link.');
  }
}

/** Shares one climb as a link. */
export async function shareClimbLink(climb, wall) {
  const payload = await packShare(makeShare(wall, [climb]));
  const url = linkFor(appAddress(), payload);
  const result = await shareLink(url, climb.name);
  if (result === 'copied') toast('Link copied. Paste it into a message.');
  else if (result === 'failed') toast('Could not share or copy the link.');
}

export async function copyClimbLink(climb, wall) {
  const payload = await packShare(makeShare(wall, [climb]));
  toast((await copyText(linkFor(appAddress(), payload))) ? 'Link copied. Paste it into a message.' : 'Could not copy the link.');
}

/** Shares one climb as a file. */
export async function shareClimbFile(climb, wall) {
  const result = await shareFile(`${fileSafe(climb.name)}.spraywall.json`, shareToText(makeShare(wall, [climb])), climb.name);
  if (result === 'downloaded') toast('Saved the climb as a file.');
}

/** Everything on the wall as one file: a backup, or a way to hand your whole set to a friend. */
export async function shareEverything(wall) {
  const climbs = await app.repo.listClimbs(wall.key);
  if (climbs.length === 0) return toast('There are no climbs to share yet.');
  const result = await shareFile(`spraywall-${fileSafe(wall.name)}-${today()}.spraywall.json`, shareToText(makeShare(wall, climbs)), `${wall.name} climbs`);
  if (result === 'downloaded') toast(`Saved ${climbs.length} climb${climbs.length === 1 ? '' : 's'} as a file.`);
}

/** The "Share and import" panel on the list. */
export async function openSharingSheet() {
  const wall = await app.repo.activeWall();
  const name = await app.repo.authorName();
  const setup = wall && app.sync?.available ? await app.repo.getSyncSetup(wall.key) : null;
  const syncLine = setup ? `Synced with a board. ${syncStatusText(app.sync.stateOf(wall.key), setup)}` : '';
  const nameInput = h('input', { class: 'field', type: 'text', maxlength: 40, value: name, placeholder: 'Your name', 'aria-label': 'Your name', autocomplete: 'off' });
  nameInput.addEventListener('change', () => app.repo.setMeta('author', nameInput.value.trim().slice(0, 40)));
  const pasteBox = h('textarea', { class: 'field', rows: 2, placeholder: 'Paste a SprayWall link here', 'aria-label': 'Pasted link' });
  let sheet;
  const openPasted = () => {
    const text = pasteBox.value;
    if (text.trim() === '') return toast('Paste a link first.');
    sheet.close();
    importPasted(text);
  };
  const content = h(
    'div',
    { class: 'sheet-body' },
    h('label', { class: 'field-label' }, 'Your name, shown on climbs you set', nameInput),
    h('h3', {}, 'Import climbs'),
    h('div', { class: 'row-buttons' }, filePickerButton('From a file', { accept: '.json,application/json,.spraywall', multiple: true, onFiles: (files) => { sheet.close(); importFiles(files); } })),
    h('label', { class: 'field-label' }, 'Or paste a link', pasteBox),
    h('div', { class: 'row-buttons' }, h('button', { type: 'button', class: 'btn', onclick: openPasted }, 'Open pasted link')),
    isIos() && !isStandalone() ? h('p', { class: 'note' }, 'Tip: on an iPhone, links open in Safari, which keeps its own copy of your climbs. If you use the app from your Home Screen, copy the link, open the app, and paste it here.') : null,
    h('h3', {}, 'Share your climbs'),
    h('div', { class: 'row-buttons' }, h('button', { type: 'button', class: 'btn', disabled: !wall, onclick: () => { sheet.close(); shareEverything(wall); } }, 'Share all as a file')),
    h('p', { class: 'note' }, 'To share one climb, open it and tap the share button. Saving all climbs as a file also makes a backup.'),
    app.sync?.available
      ? [
          h('h3', {}, 'Sync with friends'),
          h('p', { class: 'note' }, syncLine || 'Keep the climbs the same on every phone, automatically.'),
          h('div', { class: 'row-buttons' }, h('button', { type: 'button', class: 'btn', disabled: !wall, onclick: () => { sheet.close(); openSyncSheet(); } }, syncLine ? 'Sync settings' : 'Set up sync')),
        ]
      : null,
  );
  sheet = openSheet('Share and import', content);
}
