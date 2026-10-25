import { MAX_USERNAME, cleanUsername } from '../domain/climbs.js';
import { h } from './dom.js';

/**
 * Asks for a username, and does not go away until one is given: it is shown on every climb you upload, so every user has to
 * have one. Resolves with the cleaned name once it has been saved by `save` (which may throw an Error to say why not).
 */
export function askForUsername(save) {
  return new Promise((resolve) => {
    const problem = h('div', { class: 'sync-status bad', role: 'alert' });
    const input = h('input', { class: 'field', type: 'text', maxlength: MAX_USERNAME, 'aria-label': 'Username', placeholder: 'Username', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', onkeydown: (event) => event.key === 'Enter' && go() });
    const button = h('button', { type: 'button', class: 'btn primary wide', onclick: go }, 'Continue');
    const backdrop = h('div', { class: 'backdrop' });
    const dialog = h(
      'div',
      { class: 'dialog', role: 'dialog', 'aria-label': 'Choose a username' },
      h('h2', {}, 'Choose a username'),
      h('p', {}, 'It is shown on every climb you upload, so friends know who set it. Once you have uploaded a climb it cannot be changed.'),
      input,
      problem,
      h('div', { class: 'dialog-actions' }, button),
    );
    async function go() {
      const name = cleanUsername(input.value);
      if (name === null) {
        problem.textContent = `Use 2 to ${MAX_USERNAME} letters, digits, spaces, dots, dashes or underscores.`;
        return;
      }
      button.disabled = true;
      try {
        const saved = await save(name);
        backdrop.remove();
        dialog.remove();
        resolve(saved);
      } catch (error) {
        problem.textContent = error?.message || 'Could not save that.';
        button.disabled = false;
      }
    }
    document.body.append(backdrop, dialog);
    input.focus();
  });
}
