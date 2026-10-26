import { app, wallPicture } from '../app.js';
import { WallPackError, importWallPack } from '../data/wallimport.js';
import { DEFAULTS } from '../defaults.js';
import { facesOf } from '../domain/faces.js';
import { ZipError } from '../domain/zip.js';
import { ensureDefaults, installDefaultWall } from '../setup.js';
import { confirmDialog, filePickerButton, h, iconButton, promptDialog, toast } from './dom.js';
import { appBar } from './list.js';
import { PAINT, drawThumb } from './wallview.js';

/** The walls on this phone: add one from a wall pack, rename, delete, pick which one you climb on. */
export async function mountWalls(root) {
  const { repo, nav } = app;
  let alive = true;
  const list = h('div', { class: 'rows' });
  const busy = h('div', { class: 'busy', hidden: true }, 'Importing the wall… this takes a few seconds.');

  async function importPack(files) {
    busy.hidden = false;
    try {
      const { wall, updated } = await importWallPack(files[0], repo);
      toast(`${updated ? 'Updated' : 'Added'} ${wall.name} with ${wall.holds.length} holds`);
    } catch (error) {
      toast(error instanceof WallPackError || error instanceof ZipError ? error.message : `Could not import that: ${error?.message || 'unknown problem'}`);
    } finally {
      busy.hidden = true;
    }
  }

  const getDefault = h('button', { type: 'button', class: 'btn', onclick: getDefaultWall }, 'Get the AV wall');

  /** Downloads the AV wall (the one every new install starts with), and joins its shared board if that has not been done. */
  async function getDefaultWall() {
    busy.hidden = false;
    try {
      const wall = await installDefaultWall({ repo, ...app.setupHooks, progress: (text) => { busy.textContent = text; } });
      toast(`Added ${wall.name} with ${wall.holds.length} holds`);
      const result = await ensureDefaults({ repo, sync: app.sync, ...app.setupHooks });
      if (result.problem) toast(result.problem);
    } catch (error) {
      toast(error instanceof WallPackError || error instanceof ZipError ? error.message : error?.message || 'Could not get the AV wall.');
    } finally {
      busy.hidden = true;
      busy.textContent = 'Importing the wall… this takes a few seconds.';
    }
  }

  async function render() {
    if (!alive) return;
    const walls = await repo.listWalls();
    getDefault.hidden = walls.some((wall) => wall.key === DEFAULTS.wall.key);
    const active = await repo.activeWall();
    const items = await Promise.all(
      walls.map(async (wall) => {
        const picture = await wallPicture(wall);
        const aspect = Math.min(2.5, Math.max(0.4, wall.imageWidth / wall.imageHeight));
        const thumb = h('canvas', { class: 'thumb', style: { width: `${Math.round(72 * aspect)}px`, height: '72px' } });
        queueMicrotask(() => requestAnimationFrame(() => alive && thumb.isConnected && drawThumb(thumb, wall, picture, {}, PAINT.thumbPlain)));
        const angle = wall.angle ? ` · ${wall.angle}°` : '';
        const faces = facesOf(wall).length;
        return h(
          'div',
          { class: 'row wall-row' },
          thumb,
          h('div', { class: 'row-text' }, h('div', { class: 'row-name' }, wall.name), h('div', { class: 'row-comment' }, `${wall.holds.length} holds${faces ? ` · ${faces} faces` : ''}${angle}`)),
          h('input', { type: 'radio', name: 'active', checked: active?.key === wall.key, 'aria-label': `Use ${wall.name}`, onchange: () => repo.setActiveWall(wall.key).then(render) }),
          iconButton('edit', `Rename ${wall.name}`, async () => {
            const name = await promptDialog({ title: 'Rename wall', label: 'Name', value: wall.name, maxLength: 40 });
            if (name !== null && (await repo.renameWall(wall.key, name))) toast(`Renamed to ${(await repo.getWall(wall.key)).name}`);
          }),
          iconButton('trash', `Delete ${wall.name}`, async () => {
            const climbs = await repo.countClimbs(wall.key);
            const text = climbs === 0 ? 'The wall photo and hold map will be removed.' : `The wall photo, hold map and its ${climbs} climb${climbs === 1 ? '' : 's'} will be removed. This cannot be undone.`;
            if (await confirmDialog({ title: `Delete ${wall.name}?`, text, confirmLabel: 'Delete', danger: true })) {
              await repo.deleteWall(wall.key);
              toast(`Deleted ${wall.name}`);
            }
          }),
        );
      }),
    );
    list.replaceChildren(...items);
  }

  root.append(
    appBar({ title: 'Walls', back: () => nav.back('/') }),
    h(
      'div',
      { class: 'scroll pad' },
      h('p', { class: 'note' }, 'A wall pack is a .zip with the wall photo and a holds.json that says where every hold is. Importing a pack for a wall you already have updates it and keeps its climbs.'),
      h('div', { class: 'row-buttons' }, filePickerButton('Import wall pack', { accept: '.zip,application/zip,application/x-zip-compressed', className: 'btn primary', onFiles: importPack }), getDefault),
      busy,
      list,
    ),
  );
  const stop = repo.onChange(render);
  await render();
  return {
    destroy() {
      alive = false;
      stop();
    },
  };
}
