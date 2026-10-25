import { app, wallPicture } from '../app.js';
import { browseIds, gradeLabel, marksOf } from '../domain/climbs.js';
import { confirmDialog, h, icon, iconButton, openSheet, stars, toast } from './dom.js';
import { appBar } from './list.js';
import { copyClimbLink, shareClimbFile, shareClimbLink } from './sharing.js';
import { PAINT, WallView } from './wallview.js';

/** Looking at a climb. Swiping left or right goes to the next or previous climb in the list (with its search, filters and sort). */
export async function mountViewer(root, { id }) {
  const { repo, nav } = app;
  const start = await repo.getClimb(id);
  const wall = start ? await repo.getWall(start.wallKey) : null;
  if (!start || !wall) {
    root.append(appBar({ title: 'Climb', back: () => nav.back('/') }), h('div', { class: 'empty' }, h('h2', {}, 'This climb is not here any more'), h('button', { type: 'button', class: 'btn', onclick: () => nav.replace('/') }, 'Back to the list')));
    return {};
  }
  const all = await repo.listClimbs(wall.key);
  const byId = new Map(all.map((climb) => [climb.id, climb]));
  const ids = browseIds(all, app.query, id);
  const picture = await wallPicture(wall);
  let index = ids.indexOf(id);
  let showWhole = false;
  let animating = false;
  let width = 0;

  const climbAt = (i) => byId.get(ids[i]);
  const current = () => climbAt(index);

  const left = new WallView({ interactive: false });
  const right = new WallView({ interactive: false });
  const center = new WallView({ pager: { onDrag, onEnd } });
  const views = [left, center, right];
  for (const view of views) view.setWall(wall, picture);
  const track = h('div', { class: 'track' }, ...views.map((view) => h('div', { class: 'slide' }, view.el)));
  const pager = h('div', { class: 'pager' }, track);

  const count = h('div', { class: 'bar-count' });
  const eye = iconButton('eye', 'Show the whole wall', toggleWhole);
  const bar = h('header', { class: 'bar' }, iconButton('back', 'Back', () => nav.back('/')), h('div', { class: 'bar-title' }, count), h('div', { class: 'bar-actions' }, eye, iconButton('info', 'Climb info', showDetails), iconButton('share', 'Share this climb', share), iconButton('edit', 'Edit climb', () => nav.go(`/edit/${current().id}`)), iconButton('trash', 'Delete climb', remove)));
  // The name and grade sit in a small strip above the wall; the rest (stars, who set it, the comment) is behind the info button.
  const nameEl = h('div', { class: 'caption-name' });
  const gradeEl = h('div', { class: 'caption-grade' });
  const caption = h('div', { class: 'caption' }, nameEl, gradeEl);
  root.append(bar, caption, pager);

  function setTrack(dx, animate) {
    track.style.transition = animate ? 'transform 0.22s ease-out' : 'none';
    track.style.transform = `translate3d(${-width + dx}px, 0, 0)`;
  }

  function fill() {
    const paint = showWhole ? PAINT.climbBright : PAINT.climb;
    views.forEach((view, slot) => {
      const climb = climbAt(index + slot - 1);
      view.setPaint(paint);
      view.setMarks(climb ? marksOf(climb) : {});
      view.el.parentElement.style.visibility = climb ? 'visible' : 'hidden';
    });
    center.resetView();
  }

  function showInfo() {
    const climb = current();
    nameEl.textContent = climb.name;
    gradeEl.textContent = gradeLabel(climb.grade);
    count.textContent = ids.length > 1 ? `${index + 1} of ${ids.length}` : '';
    eye.setAttribute('aria-label', showWhole ? 'Dim the wall again' : 'Show the whole wall');
  }

  /** The info button: grade, stars, who set it and the comment, for the climb on screen. */
  function showDetails() {
    const climb = current();
    openSheet(
      climb.name,
      h(
        'div',
        { class: 'sheet-body' },
        h('div', { class: 'detail-head' }, h('div', { class: 'detail-grade' }, gradeLabel(climb.grade)), stars(climb.stars, { size: 22 })),
        climb.author ? h('div', { class: 'detail-author' }, `by ${climb.author}`) : null,
        h('div', { class: climb.comment ? 'detail-comment' : 'detail-comment none' }, climb.comment || 'No comment.'),
      ),
    );
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
    fill();
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
      for (const view of views) view.destroy();
    },
  };
}
