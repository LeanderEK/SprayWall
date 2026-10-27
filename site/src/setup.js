import { cleanUsername } from './domain/climbs.js';
import { DEFAULTS, MEMORY } from './defaults.js';
import { importWallPack } from './data/wallimport.js';

// What happens when the app opens: working out who you are, then putting the default wall and board in place (defaults.js).

/**
 * Everyone has a username. With a Firebase project it comes from an account (unique, and the same on every phone): the
 * account dialog is shown (with a "Later" button) unless the person already skipped it or is signed in. Without a Firebase
 * project a name on this phone is all there is. Returns 'account', 'skipped' or 'local'.
 */
export async function ensureIdentity({ repo, sync, askForAccount, askForUsername }) {
  const account = await sync.account();
  if (account) {
    await repo.setUsername(account.username, { force: true, renameDrafts: false });
    return 'account';
  }
  const local = cleanUsername(await repo.authorName());
  if (!sync.available) {
    if (local) await repo.setUsername(local); // climbs from before usernames (no name on them) are the owner's, so they take it
    else await askForUsername((name) => repo.setUsername(name));
    return 'local';
  }
  if (local) await repo.setUsername(local);
  if (await repo.getMeta('accountSkipped')) return 'skipped';
  const done = await askForAccount({ sync, suggest: local || '', canSkip: true });
  if (done === null) {
    await repo.setMetaQuietly('accountSkipped', true);
    return 'skipped';
  }
  return 'account';
}

/** Downloads a file that is part of the site (a minute at most), as a Blob. */
export async function downloadPack(url, { fetchImpl = (...args) => globalThis.fetch(...args), base = globalThis.location?.href } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetchImpl(new URL(url, base), { signal: controller.signal });
    if (!response.ok) throw new Error(`the download failed (${response.status})`);
    return await response.blob();
  } finally {
    clearTimeout(timer);
  }
}

const problemOf = (error) => (error?.name === 'AbortError' ? 'the download took too long' : error?.message || 'something went wrong');

/** Downloads the default wall and saves it, whether or not it was added before. Returns the wall. Throws with a readable message. */
export async function installDefaultWall({ repo, config = DEFAULTS, fetchPack = downloadPack, importPack = importWallPack, progress = () => {} }) {
  progress('Downloading the AV wall…');
  let pack;
  try {
    pack = await fetchPack(config.wall.pack);
  } catch (error) {
    throw new Error(`Could not download the wall: ${problemOf(error)}.`);
  }
  progress('Adding the AV wall…');
  const { wall } = await importPack(pack, repo);
  await repo.setMetaQuietly(MEMORY.wall, true);
  if (config.wall.version) await repo.setMetaQuietly(MEMORY.wallVersion, config.wall.version);
  return wall;
}

/**
 * Brings the AV wall on this phone up to date with the pack published next to the app, once per new version of the pack: the pack is
 * fetched and imported over the wall (which keeps its name and every climb), and the wall you are climbing on stays the current one.
 * It only touches a wall this app put there: one recorded as an earlier version, or, for phones set up before there were versions,
 * one that is exactly the first published wall (`config.wall.replaces`). A wall you deleted stays deleted, and a wall of your own
 * under the same key is left alone. If the download fails nothing changes and it is tried again next time.
 * Returns 'updated', 'current' or 'failed'.
 */
export async function refreshDefaultWall({ repo, config = DEFAULTS, fetchPack = downloadPack, importPack = importWallPack }) {
  const version = config.wall.version;
  if (!version) return 'current';
  const wall = await repo.getWall(config.wall.key);
  if (!wall) return 'current';
  const had = await repo.getMeta(MEMORY.wallVersion);
  if (had >= version) return 'current';
  if (!(had < version) && !config.wall.replaces?.(wall)) return 'current';
  const before = await repo.activeWall();
  try {
    await importPack(await fetchPack(config.wall.pack), repo);
  } catch {
    return 'failed';
  }
  if (before && before.key !== config.wall.key) await repo.setActiveWall(before.key);
  await repo.setMetaQuietly(MEMORY.wallVersion, version);
  return 'updated';
}

/**
 * Puts the default wall and board in place, once. It is safe to call whenever something changes (it is called when the app opens
 * and again after signing in), because each step only happens if it has not been done:
 *   - the wall is downloaded and imported unless this phone has it, or has had it (so a wall you deleted does not come back);
 *   - the board is joined once there is a wall and an account, unless this phone already has a board for it, or you stopped
 *     using one (so leaving the board is final).
 * Returns { wall, board, problem }: wall is 'had', 'imported', 'failed' or 'skipped'; board is 'had', 'joined', 'waiting'
 * (for an account), 'stopped', 'failed' or 'skipped'.
 */
export async function ensureDefaults({ repo, sync, config = DEFAULTS, fetchPack, importPack, progress = () => {} }) {
  const result = { wall: 'skipped', board: 'skipped', problem: '' };
  let wall = await repo.getWall(config.wall.key);
  if (wall) {
    await repo.setMetaQuietly(MEMORY.wall, true);
    result.wall = 'had';
  } else if (!(await repo.getMeta(MEMORY.wall))) {
    try {
      wall = await installDefaultWall({ repo, config, fetchPack, importPack, progress });
      result.wall = 'imported';
    } catch (error) {
      result.wall = 'failed';
      result.problem = error.message;
      return result;
    }
  }
  if (!wall || !config.board || !sync?.available) return result;
  const memory = await repo.getMeta(MEMORY.board);
  if (memory) {
    result.board = memory === 'stopped' ? 'stopped' : 'had';
    return result;
  }
  if (await repo.getSyncSetup(wall.key)) {
    await repo.setMetaQuietly(MEMORY.board, 'done');
    result.board = 'had';
    return result;
  }
  if (!(await sync.account())) {
    result.board = 'waiting';
    return result;
  }
  progress('Joining the AV board…');
  try {
    await sync.joinBoard(wall.key, config.board.code);
    await repo.setMetaQuietly(MEMORY.board, 'done');
    result.board = 'joined';
  } catch (error) {
    result.board = 'failed';
    result.problem = error.message;
  }
  return result;
}
