// First-run account creation and the PIN sign-in screen.
import { post } from '../api.js';
import { h, mount, avatar, debounce, toggle } from '../core.js';
import { icon, LOGO } from '../icons.js';

const USERNAME = /^[A-Za-z0-9_]{3,16}$/;

function logoBlock() { return h('div', { class: 'logo-big', innerHTML: LOGO.replace('width="30" height="30"', 'width="84" height="84"') }); }

export function renderOnboarding(root, done) {
  const input = h('input', { class: 'input', placeholder: 'Your Minecraft username', maxlength: 16, autofocus: true, autocomplete: 'off', spellcheck: false });
  const preview = h('div', { class: 'who-preview' });
  const err = h('div', { class: 'error-text', style: { minHeight: '1.3rem', marginTop: '.4rem', textAlign: 'left' } });
  let usePin = false;
  const pin = h('input', { class: 'input', type: 'password', inputmode: 'numeric', placeholder: '4–12 digit PIN', maxlength: 12, autocomplete: 'off' });
  const pinField = h('div', { class: 'field hidden', style: { marginTop: '.7rem' } }, pin);
  const pinToggle = toggle({ checked: false, onChange: (v) => { usePin = v; pinField.classList.toggle('hidden', !v); if (v) pin.focus(); } });
  const btn = h('button', { class: 'btn primary lg block go', disabled: true }, 'Get started', icon('arrow', 18));

  const paint = debounce(() => {
    const v = input.value.trim();
    mount(preview, v && USERNAME.test(v) ? [avatar(v, { size: 64 }), h('div', { style: { textAlign: 'left' } }, h('b', { style: { fontSize: '1.15rem' } }, v), h('div', { class: 'muted', style: { fontSize: '.82rem' } }, 'Looking good!'))]
      : [h('div', { class: 'muted', style: { fontSize: '.85rem' } }, 'Your skin shows up here once you type a valid name.')]);
  }, 200);

  const validate = () => {
    const v = input.value.trim();
    const okName = USERNAME.test(v);
    btn.disabled = !okName;
    err.textContent = v && !okName ? 'Usernames are 3–16 characters: letters, numbers and underscores.' : '';
    paint();
  };
  input.addEventListener('input', validate);
  paint();

  const submit = async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      await post('/api/account', { username: input.value.trim(), pin: usePin ? pin.value : undefined });
      done();
    } catch (e) { err.textContent = e.message; btn.disabled = false; }
  };
  btn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  mount(root, h('div', { class: 'center-screen' }, h('div', { class: 'welcome glass' },
    logoBlock(), h('h1', null, 'Welcome to Chestplate'),
    h('p', null, 'Create and run Minecraft servers on this PC — no start.bat, no jar hunting, no console.'),
    preview,
    h('div', { class: 'field' }, h('label', null, 'Minecraft username'), input),
    err,
    h('div', { class: 'row', style: { borderTop: 0, padding: '.4rem 0 0', textAlign: 'left' } }, h('div', { class: 'row-text' }, h('div', { class: 'row-title', style: { fontSize: '.9rem' } }, 'Protect with a PIN'), h('div', { class: 'row-desc' }, 'Optional. Asked when you open Chestplate.')), h('div', { class: 'row-control' }, pinToggle)),
    pinField, btn,
    h('p', { class: 'fine' }, 'Your account lives only on this computer. Your username is used for quick OP and whitelist buttons.'))));
  setTimeout(() => input.focus(), 80);
}

export function renderLogin(root, welcome, done) {
  const pin = h('input', { class: 'input', type: 'password', inputmode: 'numeric', placeholder: 'PIN', maxlength: 12, autofocus: true, style: { textAlign: 'center', letterSpacing: '.3em', fontSize: '1.2rem' } });
  const err = h('div', { class: 'error-text', style: { minHeight: '1.3rem', marginTop: '.5rem' } });
  const btn = h('button', { class: 'btn primary lg block go' }, 'Unlock', icon('unlock', 18));
  const submit = async () => {
    btn.disabled = true;
    try { await post('/api/login', { pin: pin.value }); done(); } catch (e) { err.textContent = e.message; btn.disabled = false; pin.select(); }
  };
  btn.addEventListener('click', submit);
  pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  mount(root, h('div', { class: 'center-screen' }, h('div', { class: 'welcome glass' },
    logoBlock(), h('div', { class: 'who-preview' }, avatar(welcome.username, { size: 64 })),
    h('h1', null, `Welcome back, ${welcome.username}`), h('p', null, 'Enter your PIN to continue.'),
    h('div', { class: 'field' }, pin), err, btn)));
  setTimeout(() => pin.focus(), 80);
}
