import { MAX_USERNAME, USERNAME_HELP, cleanUsername } from '../domain/climbs.js';
import { MIN_PASSWORD, SyncError } from '../domain/sync.js';
import { followKeyboard, h } from './dom.js';

/**
 * The account dialog: create an account (a unique username and a password) or sign in to one you already have, on this
 * or any phone. It is asked for when an account is needed (to upload a climb or start a board). With `canSkip` there is a
 * Cancel button; without it the dialog stays until it is done. Resolves with the username, or null if it was cancelled.
 *
 * `sync` is the SyncService (it does the signing up and in); `suggest` is a username to start with.
 */
export function askForAccount({ sync, suggest = '', canSkip = false, mode = 'create' }) {
  return new Promise((resolve) => {
    let creating = mode === 'create';
    let busy = false;
    const problem = h('div', { class: 'sync-status bad', role: 'alert' });
    const title = h('h2', {});
    const intro = h('p', {});
    const username = h('input', { class: 'field', type: 'text', name: 'username', maxlength: MAX_USERNAME, 'aria-label': 'Username', placeholder: 'Username', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', value: suggest });
    const password = h('input', { class: 'field', type: 'password', name: 'password', 'aria-label': 'Password', placeholder: 'Password', maxlength: 128 });
    const again = h('input', { class: 'field', type: 'password', name: 'password-again', 'aria-label': 'Password again', placeholder: 'Password again', maxlength: 128, autocomplete: 'new-password' });
    const submit = h('button', { type: 'submit', class: 'btn primary wide' });
    const switcher = h('button', { type: 'button', class: 'text-btn', onclick: () => { creating = !creating; problem.textContent = ''; show(); } });
    const cancel = canSkip ? h('button', { type: 'button', class: 'text-btn', onclick: () => finish(null) }, 'Cancel') : null;
    const form = h('form', { onsubmit: (event) => { event.preventDefault(); go(); } }, username, password, again, problem, h('div', { class: 'dialog-actions spread' }, switcher, cancel, submit));
    const backdrop = h('div', { class: 'backdrop' });
    const dialog = h('div', { class: 'dialog account', role: 'dialog', 'aria-label': 'Your account' }, title, intro, form);

    function show() {
      title.textContent = creating ? 'Create your account' : 'Sign in';
      intro.textContent = creating
        ? 'Choose a username (it is unique, and shown on every climb you upload) and a password. Use them to sign in on any phone. There is no way to reset a lost password, so pick one you will remember.'
        : 'Sign in with the username and password of your account.';
      again.hidden = !creating;
      password.autocomplete = creating ? 'new-password' : 'current-password';
      submit.textContent = creating ? 'Create account' : 'Sign in';
      switcher.textContent = creating ? 'I already have an account' : 'Create an account';
    }

    function finish(result) {
      stopFollowing();
      backdrop.remove();
      dialog.remove();
      resolve(result);
    }

    async function go() {
      if (busy) return;
      const name = cleanUsername(username.value);
      if (name === null) {
        problem.textContent = USERNAME_HELP;
        return;
      }
      if (password.value.length < MIN_PASSWORD) {
        problem.textContent = `The password needs at least ${MIN_PASSWORD} characters.`;
        return;
      }
      if (creating && password.value !== again.value) {
        problem.textContent = 'The two passwords are not the same.';
        return;
      }
      busy = true;
      submit.disabled = true;
      problem.textContent = '';
      try {
        finish(await (creating ? sync.signUp(name, password.value) : sync.signIn(name, password.value)));
      } catch (error) {
        problem.textContent = error instanceof SyncError ? error.message : 'Something went wrong. Try again.';
        if (!(error instanceof SyncError)) console.error(error);
        busy = false;
        submit.disabled = false;
      }
    }

    show();
    document.body.append(backdrop, dialog);
    const stopFollowing = followKeyboard(dialog, { centered: true });
    (suggest ? password : username).focus();
  });
}
