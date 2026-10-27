// Small helpers for building the screens. Text is always put in with textContent / text nodes, never as HTML, so a name
// or comment that arrives in a shared climb can never run as code.

import { MAX_STARS } from '../domain/climbs.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** h('div', { class: 'row', onclick: fn }, 'text', otherElement, [more, children]) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'class') el.className = value;
    else if (name === 'style' && typeof value === 'object') {
      for (const [property, setting] of Object.entries(value)) {
        // Custom properties like --c have to be set this way; the plain style object ignores them.
        if (property.startsWith('--')) el.style.setProperty(property, setting);
        else el.style[property] = setting;
      }
    }
    else if (name.startsWith('on') && typeof value === 'function') el.addEventListener(name.slice(2).toLowerCase(), value);
    else if (name === 'value') el.value = value;
    else if (value === true) el.setAttribute(name, '');
    else el.setAttribute(name, String(value));
  }
  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export const clear = (el) => {
  el.replaceChildren();
  return el;
};

const svgEl = (tag, attrs) => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  return el;
};

// Simple line icons, drawn on a 24 x 24 grid.
const ICONS = {
  back: [['path', { d: 'M15 5l-7 7 7 7' }]],
  forward: [['path', { d: 'M9 5l7 7-7 7' }]],
  close: [['path', { d: 'M6 6l12 12M18 6L6 18' }]],
  search: [['circle', { cx: 10.5, cy: 10.5, r: 6 }], ['path', { d: 'M15 15l5 5' }]],
  eye: [['path', { d: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z' }], ['circle', { cx: 12, cy: 12, r: 3 }]],
  eyeOff: [['path', { d: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z' }], ['circle', { cx: 12, cy: 12, r: 3 }], ['path', { d: 'M4 4l16 16' }]],
  edit: [['path', { d: 'M4 20l1-4L16 5l3 3L8 19z' }], ['path', { d: 'M14 7l3 3' }]],
  trash: [['path', { d: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13' }]],
  undo: [['path', { d: 'M9 14L4 9l5-5' }], ['path', { d: 'M4 9h10a6 6 0 010 12h-3' }]],
  info: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 11v6M12 7.5h.01' }]],
  share: [['path', { d: 'M12 15V3M8 7l4-4 4 4' }], ['path', { d: 'M5 12v8h14v-8' }]],
  tune: [['path', { d: 'M4 7h9M19 7h1M4 17h1M11 17h9' }], ['circle', { cx: 16, cy: 7, r: 2.5 }], ['circle', { cx: 8, cy: 17, r: 2.5 }]],
  mountain: [['path', { d: 'M2 20L9 8l4 6 3-4 6 10z' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  file: [['path', { d: 'M6 3h8l4 4v14H6z' }], ['path', { d: 'M14 3v4h4' }]],
  heart: [['path', { d: 'M12 20.5S3.5 15.3 2.6 9.9C2.1 6.6 4.2 4 7 4c2 0 3.6 1.1 5 3.1C13.4 5.1 15 4 17 4c2.8 0 4.9 2.6 4.4 5.9-.9 5.4-9.4 10.6-9.4 10.6z' }]],
  star: [['path', { d: 'M12 3l2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8z' }]],
  link: [['path', { d: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1' }], ['path', { d: 'M14 10a4 4 0 00-5.7 0l-3 3A4 4 0 0011 18.7l1-1' }]],
};

export function icon(name, size = 24) {
  const svg = svgEl('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  for (const [tag, attrs] of ICONS[name]) svg.append(svgEl(tag, attrs));
  return svg;
}

/** A round icon button. */
export function iconButton(name, label, onclick, extra = {}) {
  return h('button', { class: 'icon-btn', type: 'button', 'aria-label': label, title: label, onclick, ...extra }, icon(name));
}

/** The stars of a climb; with onSelect they can be tapped, and tapping the current rating clears it. */
export function stars(count, { size = 18, onSelect = null } = {}) {
  const row = h('div', { class: onSelect ? 'stars stars-input' : 'stars' });
  for (let i = 1; i <= MAX_STARS; i++) {
    const star = icon('star', size);
    star.classList.add(i <= count ? 'star-on' : 'star-off');
    if (onSelect) {
      row.append(h('button', { type: 'button', class: 'star-btn', 'aria-label': `${i} star${i > 1 ? 's' : ''}`, onclick: () => onSelect(i === count ? 0 : i) }, star));
    } else {
      row.append(star);
    }
  }
  return row;
}

// ---- messages and dialogs ----

let toastTimer = null;

/** A short message at the bottom of the screen. With an action, it stays a little longer. */
export function toast(message, action = null) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast', role: 'status' }, h('span', {}, message));
  if (action) el.append(h('button', { type: 'button', class: 'toast-action', onclick: () => { el.remove(); action.run(); } }, action.label));
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), action ? 12000 : 3800);
}

// ---- the keyboard ----

// Where the part of the screen the phone's keyboard leaves free is. A phone's browser does not shrink the page when the keyboard opens (the
// page stays as tall as it was and the keyboard covers its lower part), so a panel fixed to the bottom of the page would sit behind the keyboard
// and hide what is being typed. `keyboard.viewport` is that visible part (the visual viewport); the tests swap it for a pretend one.
export const keyboard = { viewport: () => window.visualViewport ?? null };

/** How far up from the bottom of the page the visible part ends, and where it starts and how tall it is (all in pixels). Zero `lift` = no keyboard. */
export function visibleArea(viewport, pageHeight) {
  const top = viewport.offsetTop || 0;
  return { top, height: viewport.height, lift: Math.max(0, Math.round(pageHeight - top - viewport.height)) };
}

/**
 * Keeps a sheet (stuck to the bottom) or a dialog (in the middle, with `centered`) inside the part of the screen the keyboard leaves free,
 * and scrolls whatever is being typed into view. Returns a function that stops it.
 */
export function followKeyboard(el, { centered = false } = {}) {
  const viewport = keyboard.viewport();
  if (!viewport) return () => {};
  const fit = () => {
    const area = visibleArea(viewport, window.innerHeight);
    if (area.lift < 1) {
      el.style.bottom = el.style.top = el.style.maxHeight = '';
      if (centered) el.style.overflowY = '';
      return;
    }
    if (centered) {
      el.style.top = `${area.top + area.height / 2}px`;
      el.style.maxHeight = `${Math.max(120, area.height - 24)}px`;
      el.style.overflowY = 'auto';
    } else {
      el.style.bottom = `${area.lift}px`;
      el.style.maxHeight = `${Math.max(120, area.height - 8)}px`;
    }
    const typing = el.querySelector(':focus');
    if (typing) typing.scrollIntoView({ block: 'center' });
  };
  const focused = (event) => {
    if (event.target.matches?.('input, textarea')) setTimeout(() => { fit(); event.target.scrollIntoView({ block: 'center' }); }, 300);
  };
  viewport.addEventListener('resize', fit);
  viewport.addEventListener('scroll', fit);
  el.addEventListener('focusin', focused);
  fit();
  return () => {
    viewport.removeEventListener('resize', fit);
    viewport.removeEventListener('scroll', fit);
    el.removeEventListener('focusin', focused);
  };
}

/**
 * A slider with a tick mark at every stop (no numbers). The slider's own thumb is drawn at a known size so that the ticks line up with it.
 */
export function tickedSlider(input, { stops }) {
  const ticks = h('div', { class: 'slider-ticks', 'aria-hidden': 'true' });
  for (let stop = 0; stop < stops; stop++) {
    ticks.append(h('span', { class: 'tick', style: { left: `calc(var(--thumb) / 2 + (100% - var(--thumb)) * ${stops > 1 ? stop / (stops - 1) : 0})` } }));
  }
  return h('div', { class: 'slider' }, input, ticks);
}

/** A panel that slides up from the bottom. Returns { close }. */
export function openSheet(title, content, { onClose = null } = {}) {
  const backdrop = h('div', { class: 'backdrop' });
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-label': title }, h('div', { class: 'sheet-grip' }), title ? h('h2', {}, title) : null, content);
  const stopFollowing = followKeyboard(panel);
  const close = () => {
    stopFollowing();
    backdrop.remove();
    panel.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (event) => event.key === 'Escape' && close();
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop, panel);
  return { close, panel };
}

/** A question in the middle of the screen. Resolves true for the main button, false otherwise. */
export function confirmDialog({ title, text, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false, onTop = false }) {
  return new Promise((resolve) => {
    const finish = (answer) => {
      backdrop.remove();
      dialog.remove();
      resolve(answer);
    };
    const backdrop = h('div', { class: onTop ? 'backdrop top' : 'backdrop', onclick: () => finish(false) });
    const dialog = h(
      'div',
      { class: onTop ? 'dialog top' : 'dialog', role: 'alertdialog', 'aria-label': title },
      h('h2', {}, title),
      text ? h('p', {}, text) : null,
      h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'text-btn', onclick: () => finish(false) }, cancelLabel), h('button', { type: 'button', class: danger ? 'text-btn danger' : 'text-btn', onclick: () => finish(true) }, confirmLabel)),
    );
    document.body.append(backdrop, dialog);
  });
}

/** Asks for a line of text. Resolves with the text, or null if cancelled. */
export function promptDialog({ title, label, value = '', confirmLabel = 'Save', maxLength = 80 }) {
  return new Promise((resolve) => {
    const finish = (answer) => {
      stopFollowing();
      backdrop.remove();
      dialog.remove();
      resolve(answer);
    };
    const input = h('input', { type: 'text', class: 'field', value, maxlength: maxLength, 'aria-label': label, autocomplete: 'off', onkeydown: (event) => event.key === 'Enter' && finish(input.value) });
    const backdrop = h('div', { class: 'backdrop', onclick: () => finish(null) });
    const dialog = h('div', { class: 'dialog', role: 'dialog', 'aria-label': title }, h('h2', {}, title), h('label', { class: 'field-label' }, label, input), h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'text-btn', onclick: () => finish(null) }, 'Cancel'), h('button', { type: 'button', class: 'text-btn', onclick: () => finish(input.value) }, confirmLabel)));
    document.body.append(backdrop, dialog);
    const stopFollowing = followKeyboard(dialog, { centered: true });
    input.focus();
    input.select();
  });
}

/** A button that opens the phone's file picker. `onFiles` gets the chosen files. */
export function filePickerButton(label, { accept, multiple = false, onFiles, className = 'btn' }) {
  const input = h('input', { type: 'file', accept, multiple, class: 'visually-hidden', tabindex: '-1', onchange: () => {
    const files = [...input.files];
    input.value = '';
    if (files.length) onFiles(files);
  } });
  const button = h('button', { type: 'button', class: className, onclick: () => input.click() }, label);
  return h('span', { class: 'file-picker' }, button, input);
}

export const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

/** Saves text as a file, using the phone's share sheet where there is one (AirDrop, Messages...), else a download. */
export async function shareFile(filename, text, title) {
  const file = new File([text], filename, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(file);
  const link = h('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

/** Shares a link with the phone's share sheet, or copies it. */
export async function shareLink(url, title) {
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
    }
  }
  return (await copyText(url)) ? 'copied' : 'failed';
}

/** Shares a piece of text with the phone's share sheet, or copies it. */
export async function shareText(text, title) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
    }
  }
  return (await copyText(text)) ? 'copied' : 'failed';
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = h('textarea', { class: 'visually-hidden', readonly: true }, text);
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}
