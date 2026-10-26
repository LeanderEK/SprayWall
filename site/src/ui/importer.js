import { app, wallPicture } from '../app.js';
import { gradeLabel, marksOf } from '../domain/climbs.js';
import { hasFaces, thumbCrop } from '../domain/faces.js';
import { ShareError, unpackShare } from '../domain/share.js';
import { h, isIos, isStandalone, toast } from './dom.js';
import { appBar } from './list.js';
import { PAINT, WallView, drawThumb } from './wallview.js';

const STATUS_TEXT = {
  new: ['New', 'ok'],
  update: ['Newer than yours', 'ok'],
  same: ['You already have this', 'muted'],
  older: ['You have a newer version', 'muted'],
  deleted: ['You deleted this one', 'muted'],
};

/** Looks over climbs that arrived by file, link or paste, and lets you decide to add them. Nothing is saved until you tap Import. */
export async function mountImporter(root, { payload }) {
  const { repo, nav } = app;
  let alive = true;
  let parsed = null;
  let problem = '';
  try {
    parsed = payload ? await unpackShare(payload) : app.pending;
  } catch (error) {
    parsed = null;
    problem = error instanceof ShareError ? error.message : 'Could not read that link.';
  }
  app.pending = null;
  if (!parsed) {
    root.append(appBar({ title: 'Import climbs', back: () => nav.replace('/') }), h('div', { class: 'empty' }, h('h2', {}, 'Nothing to import'), h('p', {}, problem || 'Open a link, or choose a file from the share button on the list.'), h('button', { type: 'button', class: 'btn', onclick: () => nav.replace('/') }, 'Back to the list')));
    return {};
  }

  const plan = await repo.planImport(parsed);
  const wall = plan.wallKnown ? await repo.getWall(plan.wallKey) : null;
  const picture = wall ? await wallPicture(wall) : null;
  const importable = plan.items.filter((item) => item.status === 'new' || item.status === 'update');

  const rows = plan.items.map(({ climb, status }) => {
    const [label, tone] = STATUS_TEXT[status];
    const thumb = h('canvas', { class: 'thumb', style: { width: '56px', height: '72px' } });
    if (wall) queueMicrotask(() => requestAnimationFrame(() => alive && thumb.isConnected && drawThumb(thumb, wall, picture, marksOf(climb), PAINT.thumb, thumbCrop(wall, marksOf(climb), 56 / 72))));
    return h('div', { class: 'row static' }, wall ? thumb : null, h('div', { class: 'row-text' }, h('div', { class: 'row-name' }, climb.name), climb.author ? h('div', { class: 'row-author' }, `by ${climb.author}`) : null, h('span', { class: `badge ${tone}` }, label)), h('div', { class: 'row-grade' }, gradeLabel(climb.grade)));
  });

  let preview = null;
  if (wall && plan.items.length === 1) {
    preview = new WallView();
    preview.setWall(wall, picture);
    preview.setPaint(PAINT.climb);
    preview.setMarks(marksOf(plan.items[0].climb));
    if (hasFaces(wall)) preview.focusOnMarks(marksOf(plan.items[0].climb));
  }

  const wallNote = !plan.wallKnown
    ? h('div', { class: 'banner warn' }, h('div', {}, `These climbs are for the wall “${plan.wallName}”, which is not on this phone yet. Import that wall's pack first (Walls), then open the link again.`), h('button', { type: 'button', class: 'text-btn', onclick: () => nav.replace('/walls') }, 'Walls'))
    : null;
  const iosNote = isIos() && !isStandalone() ? h('p', { class: 'note' }, 'Using SprayWall from your Home Screen? Links open in Safari, which keeps its own separate copy of your climbs. To add this to the Home Screen app instead, copy the link, open the app, and paste it under Share and import.') : null;
  const skipped = parsed.skipped > 0 ? h('p', { class: 'note' }, `${parsed.skipped} climb${parsed.skipped === 1 ? ' was' : 's were'} left out because ${parsed.skipped === 1 ? 'it' : 'they'} could not be read.`) : null;

  const importButton = h('button', { type: 'button', class: 'btn primary wide', disabled: importable.length === 0 || !plan.wallKnown, onclick: async () => {
    importButton.disabled = true;
    try {
      const result = await repo.applyImport(plan);
      const parts = [];
      if (result.added) parts.push(`added ${result.added}`);
      if (result.updated) parts.push(`updated ${result.updated}`);
      toast(`Done: ${parts.join(' and ')}.`);
      await repo.setActiveWall(plan.wallKey);
      if (importable.length === 1) nav.replace(`/climb/${importable[0].climb.id}`);
      else nav.replace('/');
    } catch (error) {
      importButton.disabled = false;
      toast(error?.message || 'Could not import those climbs.');
    }
  } }, importable.length === 0 ? 'Nothing new to import' : `Import ${importable.length} climb${importable.length === 1 ? '' : 's'}`);

  root.append(
    appBar({ title: 'Import climbs', subtitle: plan.wallName, back: () => nav.replace('/') }),
    h('div', { class: 'scroll pad' }, wallNote, preview ? h('div', { class: 'import-preview' }, preview.el) : null, h('div', { class: 'rows' }, rows), skipped, iosNote, h('div', { class: 'row-buttons' }, importButton, h('button', { type: 'button', class: 'text-btn', onclick: () => nav.replace('/') }, 'Cancel'))),
  );
  return {
    destroy() {
      alive = false;
      preview?.destroy();
    },
  };
}
