// DOM helpers, formatting, toasts, modals, and the small form-control kit used by every view.
import { icon } from './icons.js';

/* ------------------------------------------------------------------ DOM */
const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'indeterminate', 'innerHTML', 'textContent', 'scrollTop', 'readOnly', 'spellcheck']);

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
      } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  add(el, kids);
  return el;
}

export function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function mount(el, ...kids) { clear(el); return add(el, kids); }

export const debounce = (fn, ms = 300) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = (...a) => { clearTimeout(t); fn(...a); }; d.cancel = () => clearTimeout(t); return d; };
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ formatting */
export function fmtBytes(n) {
  if (n === null || n === undefined) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}
export function fmtMem(mb) { return mb >= 1024 ? `${+(mb / 1024).toFixed(mb % 1024 ? 1 : 0)} GB` : `${mb} MB`; }
export function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), hr = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${hr}h`;
  if (hr) return `${hr}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
export function timeAgo(ts) {
  if (!ts) return 'never';
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const hr = Math.floor(m / 60); if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24); if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}
export const fmtDate = (ts) => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/* ------------------------------------------------------------------ Minecraft text (§ / & colour codes) */
const MC = { 0: '#000000', 1: '#0000aa', 2: '#00aa00', 3: '#00aaaa', 4: '#aa0000', 5: '#aa00aa', 6: '#ffaa00', 7: '#aaaaaa', 8: '#555555', 9: '#5555ff', a: '#55ff55', b: '#55ffff', c: '#ff5555', d: '#ff55ff', e: '#ffff55', f: '#ffffff' };
export const MC_COLORS = MC;

/** Render a MOTD-style string. Accepts both "§" and "&" codes and real newlines. */
export function mcText(str, { defaultColor } = {}) {
  const root = h('span', { class: 'mc-text' });
  const text = String(str || '').replace(/&([0-9a-fk-or])/gi, '§$1');
  let st = { color: null, b: false, i: false, u: false, s: false, k: false };
  const parts = text.split(/(§[0-9a-fk-or])/i);
  for (const part of parts) {
    const m = /^§([0-9a-fk-or])$/i.exec(part);
    if (m) {
      const c = m[1].toLowerCase();
      if (MC[c]) st = { color: MC[c], b: false, i: false, u: false, s: false, k: false };
      else if (c === 'l') st.b = true; else if (c === 'o') st.i = true; else if (c === 'n') st.u = true;
      else if (c === 'm') st.s = true; else if (c === 'k') st.k = true; else if (c === 'r') st = { color: null, b: false, i: false, u: false, s: false, k: false };
      continue;
    }
    if (!part) continue;
    const lines = part.split('\n');
    lines.forEach((ln, idx) => {
      if (idx > 0) root.append(document.createElement('br'));
      if (!ln) return;
      const s = h('span', { style: { color: st.color || defaultColor || '' } }, ln);
      if (st.b) s.style.fontWeight = '800';
      if (st.i) s.style.fontStyle = 'italic';
      if (st.u || st.s) s.style.textDecoration = [st.u && 'underline', st.s && 'line-through'].filter(Boolean).join(' ');
      root.append(s);
    });
  }
  return root;
}

/* ------------------------------------------------------------------ toasts */
let toastRoot;
export function toast(message, { type = 'info', timeout = 4200, action, title } = {}) {
  toastRoot = toastRoot || document.getElementById('toasts');
  const ic = { success: 'check', error: 'warn', info: 'info', warn: 'warn' }[type] || 'info';
  const el = h('div', { class: `toast ${type}` },
    h('div', { class: 'toast-ic' }, icon(ic, 18)),
    h('div', { class: 'toast-body' }, title ? h('b', null, title) : null, h('div', null, message)),
    action ? h('button', { class: 'btn sm ghost', onclick: () => { action.onClick(); dismiss(); } }, action.label) : null,
    h('button', { class: 'icon-btn sm', title: 'Dismiss', onclick: () => dismiss() }, icon('x', 14)));
  const dismiss = () => { el.classList.add('out'); setTimeout(() => el.remove(), 220); };
  toastRoot.append(el);
  if (timeout) setTimeout(dismiss, timeout);
  return dismiss;
}

/* ------------------------------------------------------------------ modals */
const modalStack = [];
export function openModal({ title, subtitle, body, actions = [], size = 'md', dismissable = true, onClose, icon: ic, className = '' } = {}) {
  const root = document.getElementById('modals');
  const backdrop = h('div', { class: 'backdrop' });
  const closeBtn = dismissable ? h('button', { class: 'icon-btn', title: 'Close', onclick: () => api.close() }, icon('x', 18)) : null;
  const head = title ? h('div', { class: 'modal-head' },
    ic ? h('div', { class: 'modal-ic' }, icon(ic, 20)) : null,
    h('div', { class: 'grow' }, h('h2', null, title), subtitle ? h('p', { class: 'muted' }, subtitle) : null),
    closeBtn) : null;
  const bodyEl = h('div', { class: 'modal-body' }, body);
  const foot = h('div', { class: 'modal-foot' }, actions);
  const dialog = h('div', { class: `modal ${size} ${className}`, role: 'dialog', 'aria-modal': 'true' }, head, bodyEl, foot);
  backdrop.append(dialog);
  root.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));
  const api = {
    el: dialog, body: bodyEl, foot, backdrop,
    setActions(list) { clear(foot); add(foot, list); },
    close(result) {
      if (api.closed) return;
      api.closed = true;
      backdrop.classList.remove('show');
      modalStack.splice(modalStack.indexOf(api), 1);
      setTimeout(() => backdrop.remove(), 200);
      if (onClose) onClose(result);
    },
  };
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop && dismissable) api.close(); });
  modalStack.push(api);
  setTimeout(() => { const f = dialog.querySelector('[autofocus], input:not([type=hidden]), textarea'); if (f) f.focus(); }, 60);
  return api;
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalStack.length) { const top = modalStack[modalStack.length - 1]; if (top.backdrop.querySelector('.modal-head .icon-btn')) top.close(); }
});

export function confirmDialog({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', danger = false, requireText, icon: ic, extra }) {
  return new Promise((resolve) => {
    let input;
    const ok = h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => { m.close(); resolve(true); } }, confirmText);
    if (requireText) {
      ok.disabled = true;
      input = h('input', { class: 'input', placeholder: requireText, autofocus: true, oninput: () => { ok.disabled = input.value.trim() !== requireText; } });
    }
    const m = openModal({
      title, icon: ic || (danger ? 'warn' : 'info'), size: 'sm',
      body: [h('p', { class: 'dialog-msg' }, message), extra || null, requireText ? h('div', { class: 'field' }, h('label', null, `Type “${requireText}” to confirm`), input) : null],
      actions: [h('button', { class: 'btn ghost', onclick: () => { m.close(); resolve(false); } }, cancelText), ok],
      onClose: () => resolve(false),
      className: danger ? 'danger' : '',
    });
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !ok.disabled) ok.click(); });
  });
}

/* ------------------------------------------------------------------ form controls */
export function toggle({ checked = false, onChange, disabled = false, label } = {}) {
  const input = h('input', { type: 'checkbox', checked, disabled, onchange: () => onChange && onChange(input.checked) });
  const el = h('label', { class: 'switch', title: label || '' }, input, h('span', { class: 'knob' }));
  el.input = input;
  el.set = (v) => { input.checked = !!v; };
  return el;
}

export function slider({ value, min, max, step = 1, onInput, format = (v) => v, className = '' }) {
  const out = h('span', { class: 'slider-val' }, format(value));
  const input = h('input', { type: 'range', min, max, step, value, class: 'range' });
  const paint = () => { const pct = ((input.value - min) / (max - min)) * 100; input.style.setProperty('--pct', `${pct}%`); out.textContent = format(Number(input.value)); };
  input.addEventListener('input', () => { paint(); onInput && onInput(Number(input.value)); });
  paint();
  const el = h('div', { class: `slider ${className}` }, input, out);
  el.input = input; el.set = (v) => { input.value = v; paint(); };
  return el;
}

/** Segmented tab strip with a highlighted option that slides between choices. Items: [{value,label,icon,title}] */
export function pillTabs({ options, value, onChange, className = 'tabs', label = '' }) {
  const pill = h('span', { class: 'pill', 'aria-hidden': 'true' });
  const el = h('div', { class: className, role: 'tablist', 'aria-label': label }, pill);
  let cur = value;
  const btns = options.map((o) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(o.value === cur), tabindex: o.value === cur ? 0 : -1, title: o.title || o.label || '', dataset: { value: String(o.value) },
    onclick: () => select_(o.value, true), onkeydown: (e) => {
      const i = options.findIndex((x) => x.value === cur);
      const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
      if (n === null) return;
      e.preventDefault();
      const nx = options[(n + options.length) % options.length];
      select_(nx.value, true); btns[options.indexOf(nx)].focus();
    } }, o.icon ? icon(o.icon, 16) : null, o.label ? h('span', null, o.label) : null));
  add(el, btns);
  function place() {
    const b = btns[options.findIndex((o) => o.value === cur)];
    if (!b || !b.offsetWidth) return false;
    pill.style.width = `${b.offsetWidth}px`;
    pill.style.transform = `translateX(${b.offsetLeft}px)`;
    return true;
  }
  function select_(v, fire) {
    if (v === cur && fire) return;
    cur = v;
    options.forEach((o, i) => { const on = o.value === cur; btns[i].setAttribute('aria-selected', String(on)); btns[i].tabIndex = on ? 0 : -1; });
    place();
    const b = btns[options.findIndex((o) => o.value === cur)];
    if (b && b.scrollIntoView && el.scrollWidth > el.clientWidth) b.scrollIntoView({ block: 'nearest', inline: 'center' });
    if (fire && onChange) onChange(v);
  }
  // measure once attached (and whenever the size changes, e.g. fonts finishing loading)
  let first = true;
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (place() && first) { first = false; requestAnimationFrame(() => requestAnimationFrame(() => pill.classList.add('ready'))); }
    }).observe(el);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
  el.set = (v) => select_(v, false);
  return el;
}

export function segmented({ options, value, onChange, className = '' }) {
  return pillTabs({ options, value, onChange, className: `seg ${className}` });
}

export function select({ options, value, onChange, className = '', disabled = false }) {
  const el = h('select', { class: `input select ${className}`, disabled, onchange: () => onChange && onChange(el.value) },
    options.map((o) => { const op = typeof o === 'object' ? o : { value: o, label: o }; return h('option', { value: op.value, selected: String(op.value) === String(value) }, op.label); }));
  el.value = value;
  return el;
}

export function field(label, control, hint) {
  return h('div', { class: 'field' }, label ? h('label', null, label) : null, control, hint ? h('p', { class: 'hint' }, hint) : null);
}

export function row(title, desc, control, { className = '' } = {}) {
  return h('div', { class: `row ${className}` }, h('div', { class: 'row-text' }, h('div', { class: 'row-title' }, title), desc ? h('div', { class: 'row-desc' }, desc) : null), h('div', { class: 'row-control' }, control));
}

export function card(title, subtitle, ...body) {
  const el = h('section', { class: 'card glass flush' },
    title ? h('header', { class: 'card-head' }, h('div', null, h('h3', null, title), subtitle ? h('p', { class: 'muted' }, subtitle) : null)) : null,
    h('div', { class: 'card-body' }, body));
  reveal(el);
  return el;
}

export function copyText(text, msg = 'Copied to clipboard') {
  const done = () => toast(msg, { type: 'success', timeout: 1800 });
  if (navigator.clipboard && window.isSecureContext !== false) navigator.clipboard.writeText(text).then(done, fallback);
  else fallback();
  function fallback() {
    const t = h('textarea', { value: text, style: { position: 'fixed', opacity: 0 } });
    document.body.append(t); t.select(); try { document.execCommand('copy'); done(); } catch { toast('Copy failed', { type: 'error' }); } t.remove();
  }
}

/** Resize any image file to a 64x64 PNG data URL (what Minecraft wants for server-icon.png). */
export function imageToIcon(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const ctx = c.getContext('2d');
      const s = Math.min(img.width, img.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 64, 64);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file isn\'t an image the browser can read.')); };
    img.src = url;
  });
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    document.body.append(input); input.click();
  });
}

export function avatarUrl(name, size = 64) { return `https://mc-heads.net/avatar/${encodeURIComponent(name)}/${size}`; }

export function avatar(name, { size = 32, enabled = true, className = '' } = {}) {
  const fallback = () => h('span', { class: `avatar-fallback ${className}`, style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.46)}px` } }, (name || '?')[0].toUpperCase());
  if (!enabled || !name) return fallback();
  const wrap = h('span', { class: `avatar ${className}`, style: { width: `${size}px`, height: `${size}px` } });
  const img = h('img', { src: avatarUrl(name, Math.max(32, size * 2)), alt: '', width: size, height: size, onerror: () => { wrap.replaceWith(fallback()); } });
  wrap.append(img);
  return wrap;
}

/* ------------------------------------------------------------------ page header + gentle reveal */
let revealUntil = 0;
let io = null;

/** Elements created in the next `ms` get the small rise-in; later repaints (live updates) don't flicker. */
export function openRevealWindow(ms = 1200) { revealUntil = performance.now() + ms; }

export function reveal(els, { step = 0.05, max = 8 } = {}) {
  const list = [els].flat(Infinity).filter(Boolean);
  if (typeof IntersectionObserver === 'undefined' || performance.now() > revealUntil || document.documentElement.dataset.anim === 'off') return;
  io = io || new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
  }, { root: document.querySelector('.main'), threshold: 0.02 });
  list.forEach((el, i) => {
    el.style.setProperty('--d', `${(Math.min(i, max) * step).toFixed(2)}s`);
    el.setAttribute('data-reveal', '');
    io.observe(el);
  });
}

/** Standard page header: title (+ subtitle) on the left, action buttons on the right. */
export function pageHeader(title, sub, ...actions) {
  return h('header', { class: 'page-head' },
    h('div', { class: 'grow' }, h('h1', null, title), sub ? h('p', null, sub) : null),
    actions.length ? h('div', { class: 'actions' }, actions) : null);
}
