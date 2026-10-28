import { cleanUsername, usernameProblem } from '../domain/climbs.js';
import { SyncError, passwordProblem } from '../domain/sync.js';
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
    const rules = h(
      'div',
      { class: 'note rules' },
      h('p', {}, h('strong', {}, 'Username: '), '3 to 20 letters, digits, dashes (-) or underscores (_), starting with a letter or a digit. Capitals become small letters. No spaces or other symbols.'),
      h('p', {}, h('strong', {}, 'Password: '), 'at least 8 characters. Any characters are allowed.'),
    );
    // A box is marked (and the rest of the dialog says why) until the person types in it again.
    const field = (props) => h('input', { class: 'field', oninput: (event) => event.target.removeAttribute('aria-invalid'), ...props });
    const hint = h('div', { class: 'field-hint', 'aria-live': 'polite' });
    // No length limit on the box itself, so a name that is too long is explained instead of being cut short without a word.
    const username = field({ type: 'text', name: 'username', maxlength: 64, 'aria-label': 'Username', placeholder: 'Username', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', value: suggest, oninput: (event) => { event.target.removeAttribute('aria-invalid'); hint.textContent = usernameProblem(event.target.value, { typing: true }) ?? ''; } });
    const password = field({ type: 'password', name: 'password', 'aria-label': 'Password', placeholder: 'Password', maxlength: 200 });
    const again = field({ type: 'password', name: 'password-again', 'aria-label': 'Password again', placeholder: 'Password again', maxlength: 200, autocomplete: 'new-password' });
    const submit = h('button', { type: 'submit', class: 'btn primary wide' });
    const switcher = h('button', { type: 'button', class: 'text-btn', onclick: () => { creating = !creating; problem.textContent = ''; show(); } });
    const fail = (text, box) => {
      problem.textContent = text;
      box.setAttribute('aria-invalid', 'true');
      box.focus();
    };
    const cancel = canSkip ? h('button', { type: 'button', class: 'text-btn', onclick: () => finish(null) }, 'Cancel') : null;
    const form = h('form', { onsubmit: (event) => { event.preventDefault(); go(); } }, username, hint, password, again, problem, h('div', { class: 'dialog-actions spread' }, switcher, cancel, submit));
    const backdrop = h('div', { class: 'backdrop' });
    const dialog = h('div', { class: 'dialog account', role: 'dialog', 'aria-label': 'Your account' }, title, intro, rules, form);

    function show() {
      title.textContent = creating ? 'Create your account' : 'Sign in';
      intro.textContent = creating
        ? 'Your username is unique and shown on every climb you upload. The same username and password sign you in on any phone. There is no way to reset a lost password.'
        : 'Sign in with the username and password of your account.';
      rules.hidden = !creating;
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
      const nameProblem = usernameProblem(username.value);
      if (nameProblem) return fail(nameProblem, username);
      const secretProblem = passwordProblem(password.value);
      if (secretProblem) return fail(secretProblem, password);
      if (creating && password.value !== again.value) return fail('The two passwords are not the same.', again);
      const name = cleanUsername(username.value);
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
