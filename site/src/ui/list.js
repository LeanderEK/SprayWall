import { app, wallPicture } from '../app.js';
import { MAX_GRADE, SCOPES, SORTS, applyQuery, defaultQuery, filterCount, gradeFiltered, gradeLabel, isMine, isUploaded, marksOf } from '../domain/climbs.js';
import { h, icon, iconButton, isIos, isStandalone, openSheet, stars } from './dom.js';
import { openSharingSheet } from './sharing.js';
import { PAINT, drawThumb } from './wallview.js';

const THUMB_HEIGHT = 96;

/** The top bar every screen has. */
export function appBar({ title, subtitle = null, back = null, actions = [] }) {
  return h(
    'header',
    { class: 'bar' },
    back ? iconButton('back', 'Back', back) : null,
    h('div', { class: 'bar-title' }, h('div', { class: 'bar-name' }, title), subtitle ? h('div', { class: 'bar-sub' }, subtitle) : null),
    h('div', { class: 'bar-actions' }, actions),
  );
}

export function filterSummary(query) {
  const parts = [];
  if (gradeFiltered(query)) parts.push(query.minGrade === query.maxGrade ? gradeLabel(query.minGrade) : `${gradeLabel(query.minGrade)}–${gradeLabel(query.maxGrade)}`);
  if (query.minStars > 0) parts.push(`${query.minStars}★+`);
  if (query.scope && query.scope !== 'all') parts.push(SCOPES.find(([value]) => value === query.scope)?.[1] ?? query.scope);
  return parts.length ? parts.join(' · ') : 'Filters';
}

export async function mountList(root) {
  const { repo, nav } = app;
  let wall = null;
  let picture = null;
  let climbs = [];
  let me = '';
  let alive = true;

  const rows = h('div', { class: 'rows' });
  const filtersChip = h('button', { type: 'button', class: 'chip', onclick: openFilters });
  const sortSelect = h('select', { class: 'chip', 'aria-label': 'Sort', onchange: () => { app.query.sort = sortSelect.value; renderRows(); } }, SORTS.map(([value, label]) => h('option', { value }, label)));
  const search = h('input', { class: 'search', type: 'search', placeholder: 'Search climbs', 'aria-label': 'Search climbs', value: app.query.text, autocomplete: 'off', oninput: () => { app.query.text = search.value; renderRows(); } });
  const hint = h('div', { class: 'hint-slot' });
  const title = h('div', { class: 'bar-name' }, 'SprayWall');
  const header = h('header', { class: 'bar' }, h('div', { class: 'bar-title' }, title), h('div', { class: 'bar-actions' }, iconButton('share', 'Share and import', openSharingSheet), iconButton('mountain', 'Walls', () => nav.go('/walls'))));
  const toolbar = h('div', { class: 'toolbar' }, h('div', { class: 'search-wrap' }, icon('search', 20), search), h('div', { class: 'chip-row' }, sortSelect, filtersChip));
  const fab = h('button', { type: 'button', class: 'fab', onclick: () => nav.go('/edit/new') }, icon('plus', 22), 'Set a climb');
  const body = h('div', { class: 'scroll' }, toolbar, hint, rows);
  root.append(header, body, fab);

  function openFilters() {
    const q = app.query;
    const gradeText = h('div', { class: 'filter-value' });
    const minSlider = h('input', { type: 'range', min: 0, max: MAX_GRADE, step: 1, value: q.minGrade, 'aria-label': 'Easiest grade' });
    const maxSlider = h('input', { type: 'range', min: 0, max: MAX_GRADE, step: 1, value: q.maxGrade, 'aria-label': 'Hardest grade' });
    const starChips = h('div', { class: 'chip-row wrap' });
    const scopeChips = h('div', { class: 'chip-row wrap' });
    const refresh = () => {
      scopeChips.replaceChildren(...SCOPES.map(([value, label]) => h('button', { type: 'button', class: value === (q.scope || 'all') ? 'chip selected' : 'chip', onclick: () => { q.scope = value; refresh(); renderRows(); } }, label)));
      gradeText.textContent = gradeFiltered(q) ? `${gradeLabel(q.minGrade)} – ${gradeLabel(q.maxGrade)}` : 'any';
      starChips.replaceChildren(...[0, 1, 2, 3, 4, 5].map((n) => h('button', { type: 'button', class: n === q.minStars ? 'chip selected' : 'chip', onclick: () => { q.minStars = n; refresh(); renderRows(); } }, n === 0 ? 'Any' : `${n}★+`)));
      renderRows();
    };
    minSlider.addEventListener('input', () => { q.minGrade = Math.min(Number(minSlider.value), q.maxGrade); minSlider.value = q.minGrade; refresh(); });
    maxSlider.addEventListener('input', () => { q.maxGrade = Math.max(Number(maxSlider.value), q.minGrade); maxSlider.value = q.maxGrade; refresh(); });
    const reset = () => {
      Object.assign(q, { minGrade: 0, maxGrade: MAX_GRADE, minStars: 0, scope: 'all' });
      minSlider.value = 0;
      maxSlider.value = MAX_GRADE;
      refresh();
    };
    openSheet('Filters', h('div', { class: 'sheet-body' }, h('div', { class: 'row-between' }, h('h3', {}, 'Grade'), gradeText), h('div', { class: 'range-pair' }, h('span', {}, 'Easiest'), minSlider, h('span', {}, 'Hardest'), maxSlider), h('h3', {}, 'Your stars'), starChips, h('h3', {}, 'Show'), scopeChips, h('div', { class: 'row-buttons' }, h('button', { type: 'button', class: 'text-btn', onclick: reset }, 'Reset'))));
    refresh();
  }

  function emptyState(heading, text, label, onclick) {
    return h('div', { class: 'empty' }, h('h2', {}, heading), h('p', {}, text), h('button', { type: 'button', class: 'btn', onclick }, label));
  }

  function renderRows() {
    if (!alive) return;
    filtersChip.replaceChildren(icon('tune', 18), filterSummary(app.query));
    filtersChip.classList.toggle('selected', filterCount(app.query) > 0);
    sortSelect.value = app.query.sort;
    if (!wall) {
      rows.replaceChildren(emptyState('No wall yet', 'Import your wall pack to get started. It is the .zip with your wall photo and the hold map.', 'Set up a wall', () => nav.go('/walls')));
      fab.hidden = true;
      return;
    }
    fab.hidden = false;
    const shown = applyQuery(climbs, app.query, me);
    if (climbs.length === 0) {
      rows.replaceChildren(emptyState('No climbs yet', 'Pick a hold type, tap the holds on your wall, and save the climb. Or import climbs a friend sent you.', 'Set the first climb', () => nav.go('/edit/new')));
      return;
    }
    if (shown.length === 0) {
      rows.replaceChildren(emptyState('Nothing matches', `${climbs.length} climbs on this wall, but none fit the search and filters.`, 'Clear filters', () => { app.query = { ...defaultQuery(), sort: app.query.sort }; search.value = ''; renderRows(); }));
      return;
    }
    const aspect = Math.min(2.5, Math.max(0.4, wall.imageWidth / wall.imageHeight));
    const items = shown.map((climb) => {
      const thumb = h('canvas', { class: 'thumb', style: { width: `${Math.round(THUMB_HEIGHT * aspect)}px`, height: `${THUMB_HEIGHT}px` } });
      queueMicrotask(() => requestAnimationFrame(() => alive && thumb.isConnected && drawThumb(thumb, wall, picture, marksOf(climb), PAINT.thumb)));
      return h(
        'button',
        { type: 'button', class: 'row', onclick: () => nav.go(`/climb/${climb.id}`) },
        thumb,
        h('div', { class: 'row-text' }, h('div', { class: 'row-name' }, climb.name), stars(climb.stars, { size: 16 }), climb.comment ? h('div', { class: 'row-comment' }, climb.comment) : null, climb.author || !isUploaded(climb) ? h('div', { class: 'row-author' }, climb.author ? `by ${climb.author}` : '', isMine(climb, me) && !isUploaded(climb) ? h('span', { class: 'badge muted' }, 'Draft') : null) : null),
        h('div', { class: 'row-grade' }, gradeLabel(climb.grade)),
      );
    });
    rows.replaceChildren(...items);
  }

  async function load() {
    wall = await repo.activeWall();
    title.textContent = wall ? wall.name : 'SprayWall';
    me = await repo.authorName();
    const ratings = await repo.getRatings();
    climbs = wall ? (await repo.listClimbs(wall.key)).map((climb) => ({ ...climb, stars: ratings.get(climb.id) || 0 })) : [];
    picture = wall ? await wallPicture(wall) : null;
    renderRows();
  }

  // On an iPhone or iPad the app only works offline once it is on the Home Screen.
  if (isIos() && !isStandalone() && !(await repo.getMeta('installHintSeen'))) {
    hint.append(
      h('div', { class: 'banner' }, h('div', {}, 'To use SprayWall offline, tap Share in Safari, then “Add to Home Screen”.'), h('button', { type: 'button', class: 'text-btn', onclick: async () => { hint.replaceChildren(); await repo.setMeta('installHintSeen', true); } }, 'Got it')),
    );
  }

  const stop = repo.onChange(load);
  await load();
  return {
    destroy() {
      alive = false;
      stop();
    },
  };
}
