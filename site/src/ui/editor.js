import { app, wallPicture } from '../app.js';
import { MAX_GRADE, gradeLabel, gradeToStop, marksOf, stopToGrade } from '../domain/climbs.js';
import { hasFaces } from '../domain/faces.js';
import { formatMarks } from '../domain/holds.js';
import { ROLES } from '../domain/roles.js';
import { confirmDialog, h, icon, iconButton, openSheet, toast } from './dom.js';
import { FaceBar } from './facebar.js';
import { appBar } from './list.js';
import { PAINT, WallView } from './wallview.js';

const MAX_UNDO = 200;

/** Setting a climb (or changing one): pick a hold type, then tap all the holds that should be that type. */
export async function mountEditor(root, { id }) {
  const { repo, nav } = app;
  const isNew = id === 'new';
  const existing = isNew ? null : await repo.getClimb(id);
  const wall = isNew ? await repo.activeWall() : existing ? await repo.getWall(existing.wallKey) : null;
  if (!wall) {
    root.append(appBar({ title: isNew ? 'New climb' : 'Edit climb', back: () => nav.back('/') }), h('div', { class: 'empty' }, h('h2', {}, isNew ? 'Set up a wall first' : 'This climb is not here any more'), h('button', { type: 'button', class: 'btn', onclick: () => nav.replace(isNew ? '/walls' : '/') }, isNew ? 'Go to Walls' : 'Back to the list')));
    return {};
  }
  if (existing?.publishedAt) {
    // A climb on a shared board is final. (The viewer does not offer Edit for it; this is for a stale or typed address.)
    root.append(appBar({ title: 'Edit climb', back: () => nav.back('/') }), h('div', { class: 'empty' }, h('h2', {}, 'This climb is uploaded'), h('p', {}, 'Once a climb is on a shared board nobody can change or delete it.'), h('button', { type: 'button', class: 'btn', onclick: () => nav.replace(`/climb/${existing.id}`) }, 'Back to the climb')));
    return {};
  }
  const picture = await wallPicture(wall);

  const state = {
    marks: existing ? marksOf(existing) : {},
    brush: 'start', // a role code, or null for the eraser
    undo: [],
    name: existing ? existing.name : '',
    grade: existing ? existing.grade : null,
    comment: existing ? existing.comment : '',
    dirty: false,
    outlines: true,
    saving: false,
  };
  const count = () => Object.keys(state.marks).length;

  const view = new WallView({ onTapHold: tap });
  view.setWall(wall, picture);
  view.setPaint(PAINT.editor);
  view.setMarks(state.marks);
  // On a long wall the editor opens zoomed in: on the climb being changed, or on the first face for a new one.
  const facebar = hasFaces(wall) ? new FaceBar({ wall, picture, view }) : null;
  if (facebar) view.focusOnMarks(state.marks);

  const undoButton = iconButton('undo', 'Undo', undo);
  const outlinesButton = iconButton('eye', 'Hide hold outlines', toggleOutlines);
  const saveButton = h('button', { type: 'button', class: 'text-btn', onclick: openSave }, 'Save');
  const bar = h('header', { class: 'bar' }, iconButton('close', 'Close', leave), h('div', { class: 'bar-title' }, h('div', { class: 'bar-name' }, isNew ? 'New climb' : 'Edit climb')), h('div', { class: 'bar-actions' }, outlinesButton, undoButton, saveButton));
  const hint = h('div', { class: 'brush-hint' });
  const clearButton = h('button', { type: 'button', class: 'text-btn', onclick: clearAll }, 'Clear all');
  const brushButtons = [...ROLES.map((role) => ({ code: role.code, label: role.label, color: role.color })), { code: null, label: 'Erase', color: '#B0B4BC' }].map((item) => {
    const button = h('button', { type: 'button', class: 'brush', 'aria-label': item.label, onclick: () => { state.brush = item.code; refresh(); } }, h('span', { class: 'brush-dot', style: { '--c': item.color } }, item.code === null ? icon('close', 22) : null), h('span', { class: 'brush-label' }, item.label));
    return { ...item, button };
  });
  const panel = h('div', { class: 'brush-panel' }, h('div', { class: 'brush-top' }, hint, clearButton), h('div', { class: 'brush-row' }, brushButtons.map((item) => item.button)));
  root.append(bar, ...(facebar ? [facebar.el] : []), h('div', { class: 'stage' }, view.el), panel);

  function refresh() {
    hint.textContent = count() === 0 ? 'Pick a type, then tap holds on the wall.' : 'Tap a lit hold again to unlight it.';
    clearButton.style.visibility = count() === 0 ? 'hidden' : 'visible';
    undoButton.disabled = state.undo.length === 0;
    saveButton.disabled = count() === 0;
    for (const item of brushButtons) item.button.classList.toggle('selected', item.code === state.brush);
    view.setMarks(state.marks);
    facebar?.setMarks(state.marks);
  }

  function change(next) {
    state.undo.push(state.marks);
    if (state.undo.length > MAX_UNDO) state.undo.shift();
    state.marks = next;
    state.dirty = true;
    app.leaveGuard = guard;
    refresh();
  }

  function tap(hold) {
    const now = state.marks[hold.id];
    const next = { ...state.marks };
    if (state.brush === null || now === state.brush) delete next[hold.id];
    else next[hold.id] = state.brush;
    if (JSON.stringify(next) !== JSON.stringify(state.marks)) change(next);
  }

  function undo() {
    const previous = state.undo.pop();
    if (!previous) return;
    state.marks = previous;
    state.dirty = true;
    refresh();
  }

  function clearAll() {
    if (count() > 0) change({});
  }

  function toggleOutlines() {
    state.outlines = !state.outlines;
    view.setPaint(state.outlines ? PAINT.editor : PAINT.editorClean);
    outlinesButton.replaceChildren(icon(state.outlines ? 'eye' : 'eyeOff'));
    outlinesButton.setAttribute('aria-label', state.outlines ? 'Hide hold outlines' : 'Show hold outlines');
  }

  const guard = async () => {
    if (!state.dirty || state.saving) return true;
    return confirmDialog({ title: 'Discard your changes?', text: 'This climb has changes that are not saved.', confirmLabel: 'Discard', cancelLabel: 'Keep editing', danger: true });
  };

  async function leave() {
    if (await guard()) {
      app.leaveGuard = null;
      nav.back(existing ? `/climb/${existing.id}` : '/');
    }
  }

  function openSave() {
    if (count() === 0) return;
    const nameInput = h('input', { class: 'field', type: 'text', maxlength: 80, value: state.name, 'aria-label': 'Name', autocomplete: 'off', oninput: () => { state.name = nameInput.value; state.dirty = true; app.leaveGuard = guard; update(); } });
    const gradeText = h('div', { class: 'grade-value' });
    const slider = h('input', { type: 'range', min: 0, max: MAX_GRADE + 1, step: 1, value: gradeToStop(state.grade), 'aria-label': 'Grade', oninput: () => { state.grade = stopToGrade(Number(slider.value)); state.dirty = true; app.leaveGuard = guard; update(); } });
    const commentInput = h('textarea', { class: 'field', rows: 3, maxlength: 2000, 'aria-label': 'Comment', placeholder: 'Comment (optional)', oninput: () => { state.comment = commentInput.value; state.dirty = true; app.leaveGuard = guard; } }, state.comment);
    const saveBtn = h('button', { type: 'button', class: 'btn primary wide', onclick: save }, 'Save');
    function update() {
      gradeText.textContent = state.grade === null ? 'None' : gradeLabel(state.grade);
      saveBtn.disabled = state.name.trim() === '' || state.saving;
    }
    async function save() {
      if (state.name.trim() === '' || state.saving) return;
      state.saving = true;
      update();
      try {
        const saved = await repo.saveClimb({ id: existing?.id, wallKey: wall.key, name: state.name, grade: state.grade, comment: state.comment, holds: formatMarks(state.marks) });
        state.dirty = false;
        app.leaveGuard = null;
        sheet.close();
        if (existing) nav.back(`/climb/${saved.id}`);
        else nav.replace(`/climb/${saved.id}`);
      } catch (error) {
        state.saving = false;
        update();
        toast('Could not save the climb. ' + (error?.message || ''));
      }
    }
    update();
    const sheet = openSheet('Save climb', h('div', { class: 'sheet-body' }, h('label', { class: 'field-label' }, 'Name', nameInput), h('div', { class: 'row-between' }, h('h3', {}, 'Grade'), gradeText), slider, commentInput, h('p', { class: 'note' }, 'Saved on this phone as a draft. You can upload it from the climb when it is ready; after that it cannot be changed.'), saveBtn));
    nameInput.focus({ preventScroll: true });
  }

  refresh();
  return {
    guard,
    destroy() {
      if (app.leaveGuard === guard) app.leaveGuard = null;
      facebar?.destroy();
      view.destroy();
    },
  };
}
