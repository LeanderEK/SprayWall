import { defaultQuery } from './domain/climbs.js';

// The few things every screen shares: the database, the list's search and filters (the viewer swipes through the same
// climbs in the same order), a share waiting to be reviewed, and the loaded wall pictures.

export const app = {
  repo: null,
  nav: null,
  sync: null, // the SyncService (see data/sync.js)
  query: defaultQuery(),
  pending: null, // a share (already checked) waiting on the import screen
  leaveGuard: null, // set by the editor while it has unsaved changes: () => Promise<boolean>
};

const pictures = new Map();

/** The wall's picture, ready to draw. Kept in memory so changing screens does not decode it again. */
export function wallPicture(wall) {
  const id = `${wall.key}@${wall.updatedAt}`;
  let picture = pictures.get(id);
  if (!picture) {
    for (const [oldId, old] of pictures) {
      if (oldId.startsWith(`${wall.key}@`)) {
        old.then((bitmap) => bitmap?.close?.()).catch(() => {});
        pictures.delete(oldId);
      }
    }
    picture = createImageBitmap(wall.image).catch(() => null);
    pictures.set(id, picture);
  }
  return picture;
}
