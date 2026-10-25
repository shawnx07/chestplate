// Chestplate front-end: boot, authentication, shell (top nav + router) and app-wide popups.
import { get, post, state, loadBootstrap, connectEvents, on, serverList, api } from './api.js';
import { h, mount, toast, openModal, confirmDialog, avatar, $, $$, add, clear, openRevealWindow } from './core.js';
import { icon, LOGO } from './icons.js';
import { applyAppearance } from './theme.js';
import { renderOnboarding, renderLogin } from './views/onboarding.js';
import { renderServers } from './views/servers.js';
import { renderServer } from './views/server.js';
import { renderAppearance } from './views/appearance.js';
import { renderSettings } from './views/settings.js';

const root = document.getElementById('root');
let shell = null;
let cleanup = null;
let booted = false;

/* ---------------------------------------------------------------- routing */
export function navigate(hash) { if (location.hash === hash) route(); else location.hash = hash; }
window.navigate = navigate;

function parseRoute() {
  const parts = (location.hash.replace(/^#\/?/, '') || 'servers').split('/').map(decodeURIComponent);
  return { name: parts[0], a: parts[1], b: parts[2] };
}

function route() {
  if (!shell) return;
  const r = parseRoute();
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  const page = shell.page;
  clear(page);
  openRevealWindow();
  let view;
  try {
    if (r.name === 'server' && r.a) view = renderServer(r.a, r.b || 'console');
    else if (r.name === 'appearance') view = renderAppearance();
    else if (r.name === 'settings') view = renderSettings(r.a || 'general');
    else view = renderServers();
  } catch (e) {
    console.error(e);
    view = { el: h('div', { class: 'page' }, h('div', { class: 'card glass' }, h('h3', null, 'Something went wrong'), h('p', { class: 'muted' }, String(e.message || e)))) };
  }
  page.append(view.el);
  cleanup = view.cleanup || null;
  page.scrollTop = 0;
  highlightNav();
  document.title = view.title ? `${view.title} · Chestplate` : 'Chestplate';
}

function highlightNav() {
  if (!shell) return;
  const r = parseRoute();
  const key = r.name === 'server' ? 'servers' : r.name || 'servers';
  $$('.nav-link', shell.el).forEach((n) => n.classList.toggle('active', n.dataset.route === key));
  moveIndicator();
}

/** The highlighted box behind the active sidebar item slides between items. */
function moveIndicator() {
  if (!shell) return;
  const active = shell.nav.querySelector('.nav-link.active');
  const ind = shell.indicator;
  if (!active || !active.offsetHeight) { ind.classList.remove('on'); return; }
  ind.style.height = `${active.offsetHeight}px`;
  ind.style.transform = `translateY(${active.offsetTop}px)`;
  ind.classList.add('on');
  if (!ind.classList.contains('ready')) requestAnimationFrame(() => requestAnimationFrame(() => ind.classList.add('ready')));
}

window.addEventListener('hashchange', route);
window.addEventListener('resize', () => moveIndicator());

/* ---------------------------------------------------------------- shell */
function buildShell() {
  const link = (route, label, ic, count) => h('button', { class: 'nav-link', title: label, dataset: { route }, onclick: () => navigate(`#/${route}`) },
    icon(ic, 20), h('span', { class: 'label' }, label), count ? h('span', { class: 'count', id: 'nav-count' }, '0') : null);
  const indicator = h('span', { class: 'nav-indicator', 'aria-hidden': 'true' });
  const navEl = h('nav', { class: 'nav' }, indicator, link('servers', 'Servers', 'server', true), link('appearance', 'Appearance', 'palette'), link('settings', 'Settings', 'cog'));
  const who = h('button', { class: 'side-user', title: 'Account', onclick: accountMenu });
  const sidebar = h('aside', { class: 'sidebar' },
    h('button', { class: 'brand', title: 'Servers', onclick: () => navigate('#/servers') }, h('span', { class: 'brand-mark', innerHTML: LOGO }), h('span', { class: 'brand-word' }, 'Chestplate')),
    navEl, h('div', { class: 'side-spacer' }), who,
    h('div', { class: 'side-ver' }, `Chestplate v${state.version}`, h('br'), platformLabel()));
  const page = h('main', { class: 'main' });
  const el = h('div', { class: 'app' }, sidebar, page);
  shell = { el, page, nav: navEl, indicator, who };
  paintWho();
  paintSideServers();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveIndicator);
  return el;
}

function platformLabel() {
  const p = (state.system && state.system.platform) || navigator.platform || '';
  return /darwin|mac/i.test(p) ? 'macOS' : /win/i.test(p) ? 'Windows' : /linux/i.test(p) ? 'Linux' : 'Local';
}

function paintWho() {
  if (!shell) return;
  mount(shell.who, avatar(state.account.username, { size: 32 }), h('div', { class: 'who' }, h('b', null, state.account.username), h('small', null, 'Local account')));
}

function paintSideServers() {
  if (!shell) return;
  const count = shell.el.querySelector('#nav-count');
  if (count) count.textContent = String(serverList().length);
}

async function accountMenu() {
  const m = openModal({
    title: state.account.username, subtitle: 'Local Chestplate account', size: 'sm', icon: 'user',
    body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '.6rem' } },
      h('button', { class: 'btn block', onclick: () => { m.close(); navigate('#/settings/account'); } }, icon('cog', 16), 'Account settings'),
      h('button', { class: 'btn block', onclick: async () => { await post('/api/logout'); location.hash = ''; location.reload(); } }, icon('logout', 16), 'Sign out'),
      h('button', { class: 'btn danger block', onclick: async () => {
        m.close();
        const running = serverList().filter((s) => s.state !== 'stopped' && s.state !== 'crashed' && s.state !== 'failed').length;
        const ok = await confirmDialog({ title: 'Quit Chestplate?', message: running ? `${running} server${running > 1 ? 's are' : ' is'} still running and will be stopped safely first.` : 'Chestplate will close.', confirmText: 'Quit', danger: true, icon: 'power' });
        if (!ok) return;
        try { await post('/api/app/quit'); } catch { /* server exits mid-response */ }
        document.body.innerHTML = '<div style="display:grid;place-items:center;height:100vh;color:#aaa;font-family:system-ui">Chestplate has quit. You can close this window.</div>';
        setTimeout(() => window.close(), 400);
      } }, icon('power', 16), 'Quit Chestplate')),
  });
}

/* ---------------------------------------------------------------- app-wide popups */
function installGlobalHandlers() {
  const needsRepaint = () => { paintSideServers(); highlightNav(); };
  on('servers', needsRepaint);

  on('installed', (d) => toast(`${d.name} is ready to start.`, { type: 'success', title: 'Server created', action: { label: 'Open', onClick: () => navigate(`#/server/${d.id}`) } }));
  on('java', (d) => {
    if (d.phase === 'done') toast(d.message, { type: 'success' });
    else if (d.phase === 'error') toast(d.message, { type: 'error', title: 'Java install failed', timeout: 9000 });
  });
  on('eula', (d) => eulaPopup(d));
  on('firstStart', (d) => firstStartPopup(d));
  let wasConnected = false;
  on('connected', () => { if (wasConnected) toast('Reconnected', { type: 'success', timeout: 1500 }); wasConnected = true; });
  on('disconnected', () => { if (wasConnected) toast('Connection to Chestplate lost — retrying…', { type: 'warn', timeout: 2500 }); });
  const lastState = new Map();
  on('servers', (id) => {
    if (!id) return;
    const s = state.servers.get(id); if (!s) return;
    const prev = lastState.get(id);
    lastState.set(id, s.state);
    if (prev && prev !== s.state && s.state === 'crashed') toast(`${s.name} stopped unexpectedly.`, { type: 'error', title: 'Server crashed', action: { label: 'View console', onClick: () => navigate(`#/server/${id}/console`) }, timeout: 9000 });
    if (prev === 'starting' && s.state === 'running') toast(`${s.name} is online on port ${s.port}.`, { type: 'success', title: 'Server started', timeout: 3500 });
  });
}

const openEula = new Set();
function eulaPopup(d) {
  if (openEula.has(d.id)) return;
  openEula.add(d.id);
  const m = openModal({
    title: 'Accept the Minecraft EULA', icon: 'file-text', size: 'sm', dismissable: true, onClose: () => openEula.delete(d.id),
    subtitle: d.name,
    body: [h('p', { class: 'dialog-msg' }, 'Mojang requires you to agree to the Minecraft End User License Agreement before a server can run.'),
      h('p', null, h('a', { href: 'https://aka.ms/MinecraftEULA', target: '_blank', rel: 'noreferrer' }, 'Read the EULA'))],
    actions: [h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Not now'),
      h('button', { class: 'btn primary', onclick: async () => {
        try { await post(`/api/servers/${d.id}/eula`); await post(`/api/servers/${d.id}/start`); toast('EULA accepted — starting the server.', { type: 'success' }); m.close(); } catch (e) { toast(e.message, { type: 'error' }); }
      } }, 'I agree, start server')],
  });
}

const openFirst = new Set();
function firstStartPopup(d) {
  if (openFirst.has(d.id)) return;
  openFirst.add(d.id);
  const user = state.account.username;
  const checks = {};
  const opts = [
    ['op', `Make ${user} an operator (OP)`, 'Gives you full admin permissions in-game.', d.options.op],
    ['whitelist', `Add ${user} to the whitelist`, 'Lets you join even if the whitelist is turned on.', d.options.whitelist],
    ['enableWhitelist', 'Turn the whitelist on', 'Only whitelisted players will be able to join.', d.options.enableWhitelist],
  ].filter((o) => o[3]);
  const body = [h('div', { class: 'who-preview', style: { justifyContent: 'flex-start', margin: '0 0 .8rem' } }, avatar(user, { size: 48 }), h('div', null, h('b', null, user), h('div', { class: 'muted', style: { fontSize: '.82rem' } }, 'Your server finished starting for the first time.'))),
    ...opts.map(([k, t, desc]) => {
      const input = h('input', { type: 'checkbox', checked: k !== 'enableWhitelist' });
      checks[k] = input;
      return h('label', { class: 'row', style: { cursor: 'pointer' } }, h('div', { class: 'row-text' }, h('div', { class: 'row-title' }, t), h('div', { class: 'row-desc' }, desc)), h('div', { class: 'row-control' }, h('span', { class: 'switch' }, input, h('span', { class: 'knob' }))));
    })];
  const m = openModal({
    title: `${d.name} is ready!`, icon: 'rocket', size: 'sm', onClose: () => openFirst.delete(d.id), body,
    actions: [h('button', { class: 'btn ghost', onclick: async () => { await post(`/api/servers/${d.id}/first-run/dismiss`).catch(() => {}); m.close(); } }, 'Skip'),
      h('button', { class: 'btn primary', onclick: async () => {
        try { await post(`/api/servers/${d.id}/first-run`, { op: !!checks.op?.checked, whitelist: !!checks.whitelist?.checked, enableWhitelist: !!checks.enableWhitelist?.checked }); toast('Done! Commands sent to the server.', { type: 'success' }); } catch (e) { toast(e.message, { type: 'error' }); }
        m.close();
      } }, 'Apply')],
  });
}

/* ---------------------------------------------------------------- boot */
async function start() {
  let session;
  try { session = await get('/api/session'); } catch {
    mount(root, h('div', { class: 'center-screen' }, h('div', { class: 'welcome glass' }, h('h1', null, 'Chestplate'), h('p', null, 'Can\'t reach the Chestplate service. Start Chestplate again and reload this page.'))));
    return;
  }
    if (!booted) { try { const a = await fetch('/api/session'); void a; } catch { /* noop */ } }

  if (session.setup) {
    applyAppearance({ ...defaultLookup(), });
    return renderOnboarding(root, () => start());
  }
  if (!session.authenticated) {
    if (session.welcome && !session.welcome.hasPin) {
      try { await post('/api/login', {}); return start(); } catch { /* fall through to login screen */ }
    }
    applyAppearance({ ...defaultLookup() });
    return renderLogin(root, session.welcome, () => start());
  }

  await loadBootstrap();
  applyAppearance(state.appearance);
  mount(root, buildShell());
  if (!booted) { installGlobalHandlers(); booted = true; }
  connectEvents();
  window.addEventListener('cp:unauthorized', () => location.reload(), { once: true });
  if (!location.hash) location.hash = '#/servers';
  route();
}

function defaultLookup() {
  return {
    styleVersion: 4, theme: 'oled', sidebar: 'classic', accent: '#3d8bff', accent2: '#2f62e0', gradientEnabled: true, gradientAngle: 135, gradientTargets: { accent: true, background: true, headings: false },
    background: 'glow', bgColor: '#0a0a0a', bgImage: '', starDensity: 60, nebula: 65, shootingStars: true, parallax: true, glass: false, glassOpacity: 70, blur: 18,
    radius: 12, density: 'comfortable', fontScale: 100, animations: true, layout: 'grid', sort: 'recent',
  };
}

start();
export { paintSideServers };
