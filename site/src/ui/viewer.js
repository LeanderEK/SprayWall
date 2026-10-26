import { app, wallPicture } from '../app.js';
import { browseIds, gradeLabel, isMine, isUploaded, marksOf } from '../domain/climbs.js';
import { hasFaces } from '../domain/faces.js';
import { SyncError } from '../domain/sync.js';
import { confirmDialog, h, icon, iconButton, openSheet, stars, toast } from './dom.js';
import { appBar } from './list.js';
import { copyClimbLink, shareClimbFile, shareClimbLink } from './sharing.js';
import { askForAccount } from './account.js';
import { FaceBar } from './facebar.js';
import { openSyncSheet } from './syncsheet.js';
import { PAINT, WallView } from './wallview.js';

/**
 * Looking at a climb. Swiping left or right goes to the next or previous climb in the list (with its search, filters and sort).
 * On a long wall (one with faces) the view opens zoomed in on the climb instead, a drag moves about on the wall, and the
 * climbs are changed with buttons next to the map of the wall.
 */
export async function mountViewer(root, { id }) {
  const { repo, nav } = app;
  const start = await repo.getClimb(id);
  const wall = start ? await repo.getWall(start.wallKey) : null;
  if (!start || !wall) {
    root.append(appBar({ title: 'Climb', back: () => nav.back('/') }), h('div', { class: 'empty' }, h('h2', {}, 'This climb is not here any more'), h('button', { type: 'button', class: 'btn', onclick: () => nav.replace('/') }, 'Back to the list')));
    return {};
  }
  // Each climb carries your own star rating as `stars` and when you sent it as `sent` (both are kept on this phone only).
  const ratings = await repo.getRatings();
  const sentMarks = await repo.getSent();
  const me = await repo.authorName();
  const all = (await repo.listClimbs(wall.key)).map((climb) => ({ ...climb, stars: ratings.get(climb.id) || 0, sent: sentMarks.get(climb.id) || 0 }));
  const byId = new Map(all.map((climb) => [climb.id, climb]));
  const ids = browseIds(all, app.query, id, me);
  const picture = await wallPicture(wall);
  let index = ids.indexOf(id);
  let showWhole = false;
  let animating = false;
  let width = 0;

  const climbAt = (i) => byId.get(ids[i]);
  const current = () => climbAt(index);

  const long = hasFaces(wall);
  const left = new WallView({ interactive: false });
  const right = new WallView({ interactive: false });
  const center = new WallView(long ? {} : { pager: { onDrag, onEnd } });
  const views = [left, center, right];
  for (const view of views) view.setWall(wall, picture);
  const facebar = long ? new FaceBar({ wall, picture, view: center, onPrev: () => go(-1), onNext: () => go(1) }) : null;
  const track = h('div', { class: 'track' }, ...views.map((view) => h('div', { class: 'slide' }, view.el)));
  const pager = h('div', { class: 'pager' }, track);

  const count = h('div', { class: 'bar-count' });
  const eye = iconButton('eye', 'Show the whole wall', toggleWhole);
  // A climb on a shared board can no longer be changed or deleted, so those two buttons only show for drafts.
  const editButton = iconButton('edit', 'Edit climb', () => nav.go(`/edit/${current().id}`));
  const deleteButton = iconButton('trash', 'Delete climb', remove);
  const bar = h('header', { class: 'bar' }, iconButton('back', 'Back', () => nav.back('/')), h('div', { class: 'bar-title' }, count), h('div', { class: 'bar-actions' }, eye, iconButton('info', 'Climb info', showDetails), iconButton('share', 'Share this climb', share), editButton, deleteButton));
  // The name and grade sit in a small strip above the wall; the rest (your stars, who set it, the comment) is behind the info button.
  const nameEl = h('div', { class: 'caption-name' });
  const gradeEl = h('div', { class: 'caption-grade' });
  const sentButton = h('button', { type: 'button', class: 'pill-btn', onclick: toggleSent });
  const uploadSlot = h('div', { class: 'caption-upload' });
  const caption = h('div', { class: 'caption' }, nameEl, uploadSlot, gradeEl);
  root.append(bar, caption, ...(facebar ? [facebar.el] : []), pager);

  function setTrack(dx, animate) {
    track.style.transition = animate ? 'transform 0.22s ease-out' : 'none';
    track.style.transform = `translate3d(${-width + dx}px, 0, 0)`;
  }

  function fill({ refocus = true } = {}) {
    const paint = showWhole ? PAINT.climbBright : PAINT.climb;
    views.forEach((view, slot) => {
      const climb = climbAt(index + slot - 1);
      const marks = climb ? marksOf(climb) : {};
      view.setPaint(paint);
      view.setMarks(marks);
      if (long && refocus) view.focusOnMarks(marks);
      view.el.parentElement.style.visibility = climb ? 'visible' : 'hidden';
    });
    if (!long) center.resetView();
  }

  function showInfo() {
    const climb = current();
    nameEl.textContent = climb.name;
    gradeEl.textContent = gradeLabel(climb.grade);
    const uploaded = isUploaded(climb);
    editButton.hidden = uploaded;
    deleteButton.hidden = uploaded;
    sentButton.textContent = climb.sent ? '✓ Sent' : 'Mark sent';
    sentButton.classList.toggle('on', Boolean(climb.sent));
    sentButton.setAttribute('aria-pressed', String(Boolean(climb.sent)));
    uploadSlot.replaceChildren(sentButton, uploaded ? h('span', { class: 'tag' }, 'Uploaded') : isMine(climb, me) ? h('button', { type: 'button', class: 'pill-btn', onclick: uploadCurrent }, 'Upload') : null);
    count.textContent = ids.length > 1 ? `${index + 1} of ${ids.length}` : '';
    if (facebar) {
      facebar.setMarks(marksOf(climb));
      facebar.setNav({ prev: Boolean(climbAt(index - 1)), next: Boolean(climbAt(index + 1)) });
    }
    eye.setAttribute('aria-label', showWhole ? 'Dim the wall again' : 'Show the whole wall');
  }

  /** The info button: grade, stars, who set it and the comment, for the climb on screen. */
  function showDetails() {
    const climb = current();
    const ratingBox = h('div', {});
    const paintRating = () => ratingBox.replaceChildren(stars(climb.stars, { size: 30, onSelect: async (value) => { climb.stars = await repo.setRating(climb.id, value); paintRating(); } }));
    paintRating();
    openSheet(
      climb.name,
      h(
        'div',
        { class: 'sheet-body' },
        h('div', { class: 'detail-head' }, h('div', { class: 'detail-grade' }, gradeLabel(climb.grade)), h('div', { class: 'detail-by' }, climb.author ? `by ${climb.author}` : '', isUploaded(climb) ? h('span', { class: 'tag' }, 'Uploaded') : isMine(climb, me) ? h('span', { class: 'tag draft' }, 'Draft') : null)),
        h('div', { class: 'detail-rate' }, h('div', { class: 'detail-label' }, 'Your rating (only on this phone)'), ratingBox),
        h('div', { class: 'detail-rate' }, h('div', { class: 'detail-label' }, 'Sent (only on this phone)'), h('div', {}, climb.sent ? `You sent it on ${new Date(climb.sent).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}.` : 'Not sent yet.')),
        h('div', { class: climb.comment ? 'detail-comment' : 'detail-comment none' }, climb.comment || 'No comment.'),
      ),
    );
  }

  /** Marks the climb on screen as sent (completed), or takes the mark away. Only you see it: it stays on this phone. */
  async function toggleSent() {
    const climb = current();
    climb.sent = await repo.setSent(climb.id, !climb.sent);
    showInfo();
    toast(climb.sent ? 'Marked as sent. Well done!' : 'Marked as not sent.');
  }

  /** Uploads the draft on screen to the shared board, after asking: it cannot be changed or deleted afterwards. */
  async function uploadCurrent() {
    const climb = current();
    if (!app.sync?.available) return toast('Uploading needs a shared board, which is not switched on in this app yet.');
    if (!(await app.sync.account())) {
      toast('Sign in to your account to upload.');
      const done = await askForAccount({ sync: app.sync, mode: 'signin', canSkip: true });
      if (!done) return;
    }
    if (!(await repo.getSyncSetup(climb.wallKey))) {
      toast('Start or join a board for this wall first.');
      return openSyncSheet();
    }
    const sure = await confirmDialog({ title: 'Upload this climb?', text: `“${climb.name}” will be shared with everyone on the board as ${climb.author}. After that nobody can edit or delete it, you included.`, confirmLabel: 'Upload' });
    if (!sure) return;
    try {
      await app.sync.upload(climb.id);
      byId.set(climb.id, { ...(await repo.getClimb(climb.id)), stars: climb.stars });
      showInfo();
      toast('Uploaded. It is on the board now.');
    } catch (error) {
      toast(error instanceof SyncError ? error.message : 'Could not upload that climb.');
    }
  }

  function settle(direction) {
    animating = false;
    index += direction;
    fill();
    showInfo();
    setTrack(0, false);
    for (const view of views) view.renderNow(); // draw in the same moment the track jumps back, so nothing flickers
  }

  function go(direction) {
    if (animating || !climbAt(index + direction)) return;
    animating = true;
    track.style.transition = 'transform 0.22s ease-out';
    track.style.transform = `translate3d(${-width - direction * width}px, 0, 0)`;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      track.removeEventListener('transitionend', finish);
      settle(direction);
    };
    track.addEventListener('transitionend', finish);
    setTimeout(finish, 400);
  }

  function onDrag(dx) {
    if (animating) return;
    const direction = dx < 0 ? 1 : -1;
    const resisted = climbAt(index + direction) ? dx : dx * 0.3;
    setTrack(resisted, false);
  }

  function onEnd(dx, velocity, cancelled) {
    if (animating) return;
    const direction = dx < 0 ? 1 : -1;
    const far = Math.abs(dx) > width * 0.25;
    const flick = Math.abs(velocity) > 0.4 && Math.sign(velocity) === Math.sign(dx);
    if (!cancelled && (far || flick) && climbAt(index + direction)) go(direction);
    else setTrack(0, true);
  }

  function toggleWhole() {
    showWhole = !showWhole;
    fill({ refocus: !long }); // on a long wall, showing the whole wall should not throw away where you were looking
    showInfo();
    eye.replaceChildren(icon(showWhole ? 'eyeOff' : 'eye'));
  }

  function share() {
    const climb = current();
    let sheet;
    const item = (label, run) => h('button', { type: 'button', class: 'btn wide', onclick: async () => { sheet.close(); await run(climb, wall); } }, label);
    sheet = openSheet(`Share “${climb.name}”`, h('div', { class: 'sheet-body' }, item('Share a link', shareClimbLink), item('Copy the link', copyClimbLink), item('Share as a file', shareClimbFile), h('p', { class: 'note' }, 'A link or file carries the climb itself, so it works without the internet. The other person needs this wall (the same wall pack) in their app first.')));
  }

  async function remove() {
    const climb = current();
    if (!(await confirmDialog({ title: 'Delete this climb?', text: `“${climb.name}” will be removed. This cannot be undone.`, confirmLabel: 'Delete', danger: true }))) return;
    await repo.deleteClimb(climb.id);
    toast('Climb deleted');
    nav.back('/');
  }

  const onKey = (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key === 'ArrowLeft') go(-1);
    else if (event.key === 'ArrowRight') go(1);
  };
  document.addEventListener('keydown', onKey);

  const observer = new ResizeObserver(() => {
    if (pager.clientWidth === width) return;
    width = pager.clientWidth;
    track.style.width = `${width * 3}px`;
    for (const slide of track.children) slide.style.width = `${width}px`;
    setTrack(0, false);
  });
  observer.observe(pager);
  width = pager.clientWidth;
  track.style.width = `${width * 3}px`;
  for (const slide of track.children) slide.style.width = `${width}px`;
  setTrack(0, false);
  fill();
  showInfo();

  return {
    destroy() {
      document.removeEventListener('keydown', onKey);
      observer.disconnect();
      facebar?.destroy();
      for (const view of views) view.destroy();
    },
  };
}
