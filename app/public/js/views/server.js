// Server detail page: header, live stats, and the Console / Players / Files / Backups tabs.
import { get, post, put, del, state, on } from '../api.js';
import { h, mount, clear, toast, openModal, openRevealWindow, pillTabs, reveal, confirmDialog, copyText, field, avatar, fmtBytes, fmtMem, fmtDuration, fmtDate, timeAgo, debounce, mcText, card, toggle } from '../core.js';
import { icon } from '../icons.js';
import { navigate } from '../app.js';
import { stateChip, typeLabel, verLabel } from './servers.js';
import { renderServerSettings } from './server-settings.js';

const TABS = [
  { id: 'console', label: 'Console', icon: 'terminal' },
  { id: 'players', label: 'Players', icon: 'users' },
  { id: 'files', label: 'Files', icon: 'folder' },
  { id: 'backups', label: 'Backups', icon: 'archive' },
  { id: 'settings', label: 'Settings', icon: 'sliders' },
];

export function renderServer(id, initialTab) {
  const get_ = () => state.servers.get(id);
  if (!get_()) {
    return { title: 'Not found', el: h('div', { class: 'empty' }, h('h2', null, 'Server not found'), h('p', null, 'It may have been deleted.'), h('button', { class: 'btn primary', onclick: () => navigate('#/servers') }, 'Back to servers')) };
  }
  let tab = TABS.some((t) => t.id === initialTab) ? initialTab : 'console';
  let panelCleanup = null;
  let lastMode = '';
  const head = h('div');
  const stats = h('div');
  const banners = h('div');
  let tabsEl = null;
  const tabsHost = h('div');
  const panel = h('div', { class: 'tab-panel' });
  const installBox = h('div');

  /* ---------------------------------------------------------------- header */
  function paintHead() {
    const s = get_();
    if (!s) return;
    const run = ['running', 'starting'].includes(s.state);
    const act = (path, label, ic, cls, extra = {}) => h('button', { class: `btn ${cls} ${path === 'start' ? 'lg' : ''}`, ...extra, onclick: async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { await post(`/api/servers/${id}/${path}`); } catch (err) { toast(err.message, { type: 'error', title: path === 'start' ? 'Couldn\'t start the server' : 'Action failed' }); }
      b.disabled = false;
    } }, icon(ic, 16), label);
    const actions = [];
    if (s.state === 'installing') actions.push(h('button', { class: 'btn', disabled: true }, icon('refresh', 16), 'Installing…'));
    else if (s.state === 'stopping') actions.push(act('kill', 'Force stop', 'power', 'danger'));
    else if (run) { actions.push(act('restart', 'Restart', 'restart', 'warn', { disabled: s.state === 'starting' }), act('stop', s.state === 'starting' ? 'Cancel' : 'Stop', 'stop', 'danger')); } else if (s.state === 'failed') actions.push(act('start', 'Start', 'play', 'ok', { disabled: true }));
    else actions.push(act('start', 'Start', 'play', 'ok'));
    actions.push(h('button', { class: 'btn', title: 'Open the server folder', onclick: () => post(`/api/servers/${id}/open-folder`).catch((e) => toast(e.message, { type: 'error' })) }, icon('folder', 16)));

    mount(head, h('div', null,
      h('button', { class: 'back-link', onclick: () => navigate('#/servers') }, icon('back', 14), 'All servers'),
      h('div', { class: 'server-head glass' },
        h('img', { class: 'big-icon', src: `/api/servers/${id}/icon?v=${s.iconVersion}`, alt: '', onerror: (e) => { e.target.style.visibility = 'hidden'; } }),
        h('div', { class: 'grow' },
          h('h1', null, s.name, stateChip(s.state)),
          h('div', { class: 'motd-preview', style: { margin: '10px 0 0', padding: '5px 12px', display: 'inline-block', minHeight: 0, maxWidth: '100%' } }, mcText(s.description || 'A Minecraft Server')),
          h('div', { class: 'server-sub' },
            h('span', { class: 'chip accent' }, icon('layers', 12), `${verLabel(s)}${s.build ? ` · build ${s.build}` : ''}`),
            h('span', { class: 'chip', title: 'Server folder' }, icon('folder', 12), s.folder),
            s.customLocation ? h('span', { class: 'chip warn', title: s.dir }, 'Custom location') : null)),
        h('div', { class: 'head-actions' }, actions))));

    const bn = [];
    if (s.state === 'crashed') bn.push(banner('bad', 'warn', 'The server stopped unexpectedly. Check the console for the cause.', h('button', { class: 'btn sm', onclick: () => switchTab('console') }, 'Open console')));
    if (s.state === 'failed') bn.push(banner('bad', 'warn', s.error || 'Something went wrong while setting up this server.', h('button', { class: 'btn sm primary', onclick: () => reinstallFlow(id) }, 'Reinstall')));
    if (s.error && !['failed', 'installing'].includes(s.state)) bn.push(banner('warn', 'warn', s.error, h('button', { class: 'btn sm', onclick: () => switchTab('settings') }, 'Settings')));
    if (s.needsEula && s.state !== 'running') bn.push(banner('info', 'file-text', 'This server needs the Minecraft EULA accepted before it can run.', h('button', { class: 'btn sm primary', onclick: async () => { await post(`/api/servers/${id}/eula`).catch((e) => toast(e.message, { type: 'error' })); toast('EULA accepted. You can start the server now.', { type: 'success' }); } }, 'Accept EULA')));
    mount(banners, bn);
  }

  function banner(kind, ic, text, action) { return h('div', { class: `banner ${kind}` }, icon(ic, 20), h('div', { class: 'grow' }, text), action); }

  /* ---------------------------------------------------------------- stats */
  function paintStats() {
    const s = get_();
    if (!s) return;
    const running = s.state === 'running' || s.state === 'starting';
    const used = s.memUsed / 1048576;
    const pct = running ? Math.min(100, (used / s.memory.max) * 100) : 0;
    const addr = `localhost:${s.port}`;
    const st = (k, ic, v, extra) => h('div', { class: 'stat glass' }, h('div', { class: 'k' }, icon(ic, 14), k), h('div', { class: 'v' }, v), extra);
    const fresh = !stats.firstChild;
    mount(stats, h('div', { class: 'stats' },
      st('Players', 'users', [running ? s.players.length : '—', h('small', null, ` / ${s.maxPlayers}`)], h('div', { class: 'meter', style: { '--v': `${running ? (s.players.length / Math.max(1, s.maxPlayers)) * 100 : 0}%` } }, h('i'))),
      st('Memory', 'ram', running ? [fmtMem(Math.round(used)), h('small', null, ` / ${fmtMem(s.memory.max)}`)] : [fmtMem(s.memory.max), h('small', null, ' max')], h('div', { class: `meter ${pct > 90 ? 'bad' : pct > 75 ? 'warn' : ''}`, style: { '--v': `${pct}%` } }, h('i'))),
      st('Uptime', 'clock', s.state === 'running' ? fmtDuration(s.uptime) : '—'),
      h('div', { class: 'stat glass', title: 'Click to copy' }, h('div', { class: 'k' }, icon('globe', 14), 'Address'), h('div', { class: 'v copyable', onclick: () => copyText(addr, 'Address copied') }, addr, h('small', null, ' ⧉'))),
      st('Disk', 'disk', s.diskBytes === null ? '…' : fmtBytes(s.diskBytes), s.advanced.maxStorageMB > 0 ? h('div', { class: 'meter', style: { '--v': `${Math.min(100, ((s.diskBytes || 0) / 1048576 / s.advanced.maxStorageMB) * 100)}%` } }, h('i')) : null)));
    if (fresh) reveal([...stats.querySelectorAll('.stat')]);
  }

  /* ---------------------------------------------------------------- tabs */
  function paintTabs() {
    tabsEl = pillTabs({ options: TABS.map((t) => ({ value: t.id, label: t.label, icon: t.icon })), value: tab, onChange: (t) => switchTab(t), label: 'Server sections' });
    tabsHost.replaceChildren(tabsEl);
  }

  function switchTab(t) {
    tab = t;
    history.replaceState(null, '', `#/server/${id}/${t}`);
    tabsEl.set(t); openRevealWindow(); paintPanel();
  }

  function paintPanel() {
    if (panelCleanup) { try { panelCleanup(); } catch (e) { console.error(e); } panelCleanup = null; }
    clear(panel);
    const s = get_();
    if (s.state === 'installing') { panel.append(installView()); return; }
    const make = { console: consolePanel, players: playersPanel, files: filesPanel, backups: backupsPanel, settings: renderServerSettings }[tab];
    const v = make(id);
    panel.append(v.el);
    panelCleanup = v.cleanup || null;
    reveal([...panel.querySelectorAll('.card, .open-folder, .quick, .console, details.adv, .cols-2 > *')].filter((e) => !e.hasAttribute('data-reveal')));
  }

  function installView() {
    const s = get_();
    const inst = s.install || { message: 'Getting ready…', percent: 0 };
    const pct = Math.max(2, Math.min(100, inst.percent || 0));
    return h('div', { class: 'install-panel glass' }, h('div', { class: 'spinner' }), h('h2', null, s.name ? `Setting up ${s.name}` : 'Setting up your server'),
      h('p', { class: 'muted', id: 'inst-msg' }, inst.message),
      h('div', { class: 'meter', id: 'inst-meter', style: { '--v': `${pct}%` } }, h('i')),
      h('p', { class: 'hint', id: 'inst-bytes' }, inst.total ? `${fmtBytes(inst.received)} of ${fmtBytes(inst.total)}` : ''),
      h('p', { class: 'hint', style: { marginTop: '1rem' } }, 'Downloads the server, makes sure the right Java is available, and writes your settings.'));
  }

  function liveInstall() {
    const s = get_();
    const inst = s && s.install;
    const msg = panel.querySelector('#inst-msg');
    if (!inst || !msg) return;
    msg.textContent = inst.message;
    panel.querySelector('#inst-meter').style.setProperty('--v', `${Math.max(2, Math.min(100, inst.percent || 0))}%`);
    panel.querySelector('#inst-bytes').textContent = inst.total ? `${fmtBytes(inst.received)} of ${fmtBytes(inst.total)}` : '';
  }

  const offs = [
    on('servers', (sid) => {
      if (sid && sid !== id) return;
      const s = get_();
      if (!s) { navigate('#/servers'); return; }
      paintHead(); paintStats();
      const mode = s.state === 'installing' ? 'installing' : 'normal';
      tabsHost.classList.toggle('hidden', mode === 'installing');
      if (mode !== lastMode) { lastMode = mode; paintPanel(); } else if (mode === 'installing') liveInstall();
    }),
    on('stats', (sid) => { if (sid === id) paintStats(); }),
    on('removed', (d) => { if (d.id === id) navigate('#/servers'); }),
  ];
  const diskTimer = setInterval(() => get(`/api/servers/${id}`).then((r) => { const s = get_(); if (s) { s.diskBytes = r.server.diskBytes; paintStats(); } }).catch(() => {}), 20000);

  paintHead(); paintStats(); paintTabs();
  lastMode = get_().state === 'installing' ? 'installing' : 'normal';
  tabsHost.classList.toggle('hidden', lastMode === 'installing');
  paintPanel();
  get(`/api/servers/${id}`).then((r) => { if (get_()) { Object.assign(get_(), r.server); paintStats(); } }).catch(() => {});

  return {
    title: get_().name,
    el: h('div', { class: 'page' }, head, stats, banners, tabsHost, panel),
    cleanup: () => { offs.forEach((f) => f()); clearInterval(diskTimer); if (panelCleanup) panelCleanup(); },
  };
}

/* ================================================================== Console */
function consolePanel(id) {
  const settings = state.settings.console;
  const user = state.account.username;
  const getS = () => state.servers.get(id);
  const logEl = h('div', { class: `console-log ${settings.wrap ? '' : 'nowrap'}` });
  const filter = h('input', { class: 'input', placeholder: 'Filter output…', oninput: () => applyFilter() });
  const input = h('input', { placeholder: 'Type a command…', autocomplete: 'off', spellcheck: false });
  const jump = h('button', { class: 'btn sm primary jump hidden', onclick: () => { stick = true; logEl.scrollTop = logEl.scrollHeight; jump.classList.add('hidden'); } }, icon('down', 14), 'Latest');
  let stick = true;
  let lastSeq = 0;
  const lines = [];
  const history = [];
  let hIdx = -1;
  let q = '';

  function classify(item) {
    if (item.kind === 'sys') return 'sys';
    if (item.kind === 'in') return 'in';
    const m = /^((?:\[[^\]]*\]\s*)+:?)/.exec(item.line);
    const prefix = m ? m[1] : '';
    let cls = '';
    if (/\b(ERROR|FATAL|SEVERE)\b/.test(prefix)) cls = 'error';
    else if (/\bWARN(ING)?\b/.test(prefix)) cls = 'warn';
    else if (!prefix && (/^\s+at\s/.test(item.line) || /^Caused by:/.test(item.line) || /Exception/.test(item.line))) cls = 'error';
    else if (item.kind === 'err' && !prefix) cls = 'error';
    if (item.kind === 'old') cls += ' old';
    return cls;
  }

  function lineEl(item) {
    let text = item.line;
    if (settings.timestamps && item.t && !/^\[\d\d:\d\d:\d\d/.test(text)) text = `[${new Date(item.t).toTimeString().slice(0, 8)}] ${text}`;
    const tm = /^(\[\d\d:\d\d:\d\d[^\]]*\])(.*)$/.exec(text);
    const el = h('div', { class: `ln ${classify(item)}` }, tm ? [h('span', { class: 'ts' }, tm[1]), tm[2]] : text || '\u00a0');
    return el;
  }

  function add(items) {
    const frag = document.createDocumentFragment();
    for (const it of items) {
      if (it.seq <= lastSeq) continue;
      lastSeq = it.seq;
      const el = lineEl(it);
      const rec = { el, text: it.line.toLowerCase() };
      if (q && !rec.text.includes(q)) el.classList.add('hidden');
      lines.push(rec); frag.append(el);
    }
    if (!frag.childNodes.length) return;
    const empty = logEl.querySelector('.console-empty'); if (empty) empty.remove();
    logEl.append(frag);
    while (lines.length > settings.maxLines) lines.shift().el.remove();
    if (stick) logEl.scrollTop = logEl.scrollHeight; else jump.classList.remove('hidden');
  }

  function applyFilter() {
    q = filter.value.trim().toLowerCase();
    for (const l of lines) l.el.classList.toggle('hidden', !!q && !l.text.includes(q));
    if (stick) logEl.scrollTop = logEl.scrollHeight;
  }

  logEl.addEventListener('scroll', () => {
    stick = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 36;
    if (stick) jump.classList.add('hidden');
  });

  function placeholder() {
    const s = getS();
    const can = s && ['running', 'starting'].includes(s.state);
    input.disabled = !can;
    input.placeholder = can ? 'Type a command… (↑ for history)' : 'Start the server to send commands';
    sendBtn.disabled = !can;
  }
  const sendBtn = h('button', { class: 'btn sm primary go', onclick: send }, icon('send', 14), 'Send');
  async function send() {
    const c = input.value.trim();
    if (!c) return;
    input.value = ''; history.unshift(c); hIdx = -1; if (history.length > 100) history.pop();
    stick = true;
    try { await post(`/api/servers/${id}/command`, { command: c }); } catch (e) { toast(e.message, { type: 'error' }); }
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send();
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (hIdx < history.length - 1) input.value = history[++hIdx]; } else if (e.key === 'ArrowDown') { e.preventDefault(); if (hIdx > 0) input.value = history[--hIdx]; else { hIdx = -1; input.value = ''; } }
  });

  /* quick-command shortcuts: toggle between e.g. "OP" and "DeOP" using the real state of the server */
  let st = { op: false, whitelist: false, whitelistEnabled: false };
  const bar = h('div', { class: 'shortcuts' });
  const sub = (str) => String(str || '').replace(/\{player\}/g, user);
  async function refreshState() { try { st = await get(`/api/servers/${id}/shortcut-state`); } catch { /* ignore */ } paintShortcuts(); }
  function paintShortcuts() {
    const s = getS();
    const running = s && s.state === 'running';
    mount(bar, state.settings.shortcuts.map((sc) => {
      const active = !!(sc.state && st[sc.state]);
      const useOff = active && sc.offCommand;
      const label = sub(useOff ? sc.offLabel || sc.label : sc.label);
      const cmd = sub(useOff ? sc.offCommand : sc.command);
      return h('button', { class: `btn sm ${active ? 'active' : ''}`, disabled: !running, title: running ? `Runs: ${cmd}` : 'Start the server to use shortcuts',
        onclick: async () => { try { await post(`/api/servers/${id}/command`, { command: cmd }); stick = true; setTimeout(refreshState, 700); setTimeout(refreshState, 2000); } catch (e) { toast(e.message, { type: 'error' }); } } }, icon(sc.icon || 'terminal', 14), label);
    }));
  }

  const bar2 = h('div', { class: 'console-bar' },
    icon('terminal', 16), h('b', null, 'Console'), h('span', { class: 'grow' }),
    filter,
    h('button', { class: 'icon-btn', title: 'Toggle line wrapping', onclick: () => { logEl.classList.toggle('nowrap'); } }, icon('scroll', 16)),
    h('button', { class: 'icon-btn', title: 'Copy output', onclick: () => copyText(lines.map((l) => l.el.textContent).join('\n'), 'Console copied') }, icon('copy', 16)),
    h('button', { class: 'icon-btn', title: 'Clear', onclick: async () => { await del(`/api/servers/${id}/log`).catch(() => {}); lines.length = 0; mount(logEl, h('div', { class: 'console-empty' }, 'Cleared.')); } }, icon('trash', 16)));

  const el = h('div', { class: 'console-wrap' },
    h('div', { class: 'quick glass' }, h('span', { class: 'lbl' }, 'Quick commands'), bar),
    h('div', { class: 'console' }, bar2, logEl, jump, h('div', { class: 'console-input' }, h('span', { class: 'prompt' }, '>'), input, sendBtn)));

  get(`/api/servers/${id}/log?after=0`).then((r) => {
    if (!r.lines.length) mount(logEl, h('div', { class: 'console-empty' }, 'No output yet. Press Start to launch the server.'));
    else add(r.lines);
    logEl.scrollTop = logEl.scrollHeight;
  }).catch((e) => mount(logEl, h('div', { class: 'console-empty' }, e.message)));

  placeholder(); paintShortcuts(); refreshState();
  let prev = getS() && getS().state;
  const offs = [
    on('log', (d) => { if (d.id === id) add([d]); }),
    on('servers', (sid) => {
      if (sid && sid !== id) return;
      const s = getS(); if (!s) return;
      placeholder(); paintShortcuts();
      if (s.state !== prev) { if (s.state === 'running' || prev === 'running') refreshState(); prev = s.state; }
    }),
  ];
  return { el, cleanup: () => offs.forEach((f) => f()) };
}

/* ================================================================== Players */
function playersPanel(id) {
  const root = h('div');
  const getS = () => state.servers.get(id);
  const nameInput = h('input', { class: 'input', placeholder: 'Player name', maxlength: 16 });
  let data = null;

  async function cmd(c) { try { await post(`/api/servers/${id}/command`, { command: c }); setTimeout(load, 800); } catch (e) { toast(e.message, { type: 'error' }); } }
  const running = () => getS() && getS().state === 'running';

  function personRow(p, actions) {
    return h('div', { class: 'list-row' }, avatar(p.name, { size: 34 }), h('div', { class: 'grow' }, h('b', null, p.name), p.level ? h('div', { class: 'sub' }, `Level ${p.level}`) : p.reason ? h('div', { class: 'sub' }, p.reason) : null), actions);
  }
  const rm = (label, c) => h('button', { class: 'btn sm ghost', disabled: !running(), title: running() ? c : 'Start the server to change this', onclick: () => cmd(c) }, label);

  function paint() {
    if (!data) return;
    const none = (t) => h('div', { class: 'muted', style: { padding: '.8rem 0', fontSize: '.88rem' } }, t);
    const online = data.online;
    mount(root,
      !running() ? h('div', { class: 'banner info' }, icon('info', 18), h('div', { class: 'grow' }, 'The server is offline. You can see who is listed, but changes need the server running.')) : null,
      h('div', { class: 'card glass' }, h('div', { class: 'card-head' }, h('h3', null, 'Add a player'), h('p', { class: 'muted' }, 'Type a Minecraft username.')),
        h('div', { class: 'input-group', style: { flexWrap: 'wrap' } }, h('div', { style: { flex: 1, minWidth: '200px' } }, nameInput),
          [['Whitelist', 'user-check', (n) => `whitelist add ${n}`], ['OP', 'shield', (n) => `op ${n}`], ['Ban', 'ban', (n) => `ban ${n}`]].map(([l, ic, f]) => h('button', { class: 'btn', disabled: !running(), onclick: () => { const n = nameInput.value.trim(); if (!/^[A-Za-z0-9_]{3,16}$/.test(n)) return toast('Enter a valid username first', { type: 'warn' }); cmd(f(n)); nameInput.value = ''; } }, icon(ic, 15), l)))),
      h('div', { class: 'cols-2', style: { marginTop: '1rem' } },
        h('div', { class: 'card glass' }, h('div', { class: 'card-head' }, h('h3', null, `Online (${online.length})`)), online.length ? online.map((n) => personRow({ name: n }, [rm('Kick', `kick ${n}`), rm('OP', `op ${n}`)])) : none('Nobody is online.')),
        h('div', { class: 'card glass' }, h('div', { class: 'card-head' }, h('h3', null, `Operators (${data.ops.length})`)), data.ops.length ? data.ops.map((p) => personRow(p, rm('Remove', `deop ${p.name}`))) : none('No operators yet.'))),
      h('div', { class: 'cols-2', style: { marginTop: '1rem' } },
        h('div', { class: 'card glass' }, h('div', { class: 'card-head' }, h('h3', null, `Whitelist (${data.whitelist.length})`)), data.whitelist.length ? data.whitelist.map((p) => personRow(p, rm('Remove', `whitelist remove ${p.name}`))) : none('The whitelist is empty.')),
        h('div', { class: 'card glass' }, h('div', { class: 'card-head' }, h('h3', null, `Banned (${data.banned.length})`)), data.banned.length ? data.banned.map((p) => personRow(p, rm('Pardon', `pardon ${p.name}`))) : none('Nobody is banned.'))));
  }
  async function load() { try { data = await get(`/api/servers/${id}/players`); paint(); } catch (e) { mount(root, h('div', { class: 'banner bad' }, icon('warn', 18), e.message)); } }
  load();
  const offs = [on('players', (d) => { if (d.id === id) load(); }), on('servers', (sid) => { if (sid === id && data) { data.running = running(); paint(); } })];
  return { el: root, cleanup: () => offs.forEach((f) => f()) };
}

/* ================================================================== Files */
function filesPanel(id) {
  const root = h('div');
  const s = state.servers.get(id);
  let cwd = '';
  const listEl = h('div');
  const crumbs = h('div', { class: 'crumbs' });

  const openBtn = h('button', { class: 'btn primary', onclick: () => post(`/api/servers/${id}/open-folder`).then(() => toast('Opened in your file explorer', { type: 'success', timeout: 1800 })).catch((e) => toast(e.message, { type: 'error' })) }, icon('external', 16), 'Open in File Explorer');

  async function load(p) {
    try {
      const r = await get(`/api/servers/${id}/files?path=${encodeURIComponent(p)}`);
      cwd = r.path;
      const parts = cwd ? cwd.split('/') : [];
      mount(crumbs, h('button', { onclick: () => load('') }, icon('folder', 14), s.folder), parts.map((seg, i) => [h('span', { class: 'sep' }, '/'), h('button', { onclick: () => load(parts.slice(0, i + 1).join('/')) }, seg)]));
      mount(listEl, h('div', { class: 'file-list' }, r.entries.length ? r.entries.map((e) => h('button', { class: `file ${e.dir ? 'dir' : ''}`, onclick: () => (e.dir ? load(cwd ? `${cwd}/${e.name}` : e.name) : openFile(cwd ? `${cwd}/${e.name}` : e.name, e)) },
        icon(e.dir ? 'folder' : /\.(jar)$/i.test(e.name) ? 'box' : /\.(json|properties|txt|yml|yaml|toml|cfg|conf|log)$/i.test(e.name) ? 'file-text' : 'file', 18), h('span', { class: 'nm' }, e.name), h('span', { class: 'sz' }, e.dir ? '' : fmtBytes(e.size)), h('span', { class: 'dt' }, e.mtime ? timeAgo(e.mtime) : ''))) : h('div', { class: 'muted', style: { padding: '1.5rem', textAlign: 'center' } }, 'This folder is empty.')));
    } catch (e) { toast(e.message, { type: 'error' }); }
  }

  async function openFile(path, meta) {
    try {
      const r = await get(`/api/servers/${id}/file?path=${encodeURIComponent(path)}`);
      const ta = h('textarea', { class: 'input editor', spellcheck: false });
      ta.value = r.content;
      const m = openModal({ title: path.split('/').pop(), subtitle: path, icon: 'file-text', size: 'xl', body: ta,
        actions: [h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Close'), h('button', { class: 'btn primary', onclick: async () => { try { await put(`/api/servers/${id}/file`, { path, content: ta.value }); toast('Saved', { type: 'success', timeout: 1500 }); m.close(); } catch (e) { toast(e.message, { type: 'error' }); } } }, icon('save', 16), 'Save')] });
    } catch (e) { toast(e.message, { type: 'error' }); }
  }

  mount(root,
    h('div', { class: 'open-folder glass' }, h('div', { class: 'ico', style: { color: 'var(--accent)' } }, icon('folder', 30)), h('div', { class: 'grow' }, h('b', null, 'Server folder'), h('div', { class: 'path' }, s.dir)),
      h('button', { class: 'btn', onclick: () => copyText(s.dir, 'Path copied') }, icon('copy', 15), 'Copy path'), openBtn),
    h('div', { class: 'card glass', style: { marginTop: '1rem' } }, h('div', { class: 'card-head' }, h('h3', null, 'Quick browser'), h('p', { class: 'muted' }, 'Peek at files and edit text configs. Open the folder for everything else.')), crumbs, listEl));
  load('');
  return { el: root };
}

/* ================================================================== Backups */
function backupsPanel(id) {
  const root = h('div');
  const list = h('div');
  let busy = false;
  async function load() {
    try {
      const r = await get(`/api/servers/${id}/backups`);
      mount(list, r.backups.length ? r.backups.map((b) => h('div', { class: 'list-row' }, h('div', { class: 'ico', style: { color: 'var(--accent)' } }, icon('archive', 22)),
        h('div', { class: 'grow' }, h('b', null, fmtDate(b.created)), h('div', { class: 'sub' }, `${b.scope === 'full' ? 'Full server' : 'Worlds only'} · ${fmtBytes(b.size)}`)),
        h('a', { class: 'btn sm', href: `/api/servers/${id}/backups/${encodeURIComponent(b.name)}/download`, download: b.name }, icon('download', 14), 'Download'),
        h('button', { class: 'btn sm warn', onclick: async () => {
          if (!(await confirmDialog({ title: 'Restore this backup?', message: 'The current world is replaced with this backup. A safety backup of the current world is made first. The server must be stopped.', confirmText: 'Restore', icon: 'refresh' }))) return;
          try { await post(`/api/servers/${id}/backups/${encodeURIComponent(b.name)}/restore`); toast('Backup restored', { type: 'success' }); load(); } catch (e) { toast(e.message, { type: 'error' }); }
        } }, icon('refresh', 14), 'Restore'),
        h('button', { class: 'icon-btn', title: 'Delete backup', onclick: async () => { if (!(await confirmDialog({ title: 'Delete backup?', message: 'This can\'t be undone.', confirmText: 'Delete', danger: true }))) return; await del(`/api/servers/${id}/backups/${encodeURIComponent(b.name)}`).catch((e) => toast(e.message, { type: 'error' })); load(); } }, icon('trash', 16))))
        : h('div', { class: 'muted', style: { padding: '1.6rem', textAlign: 'center' } }, 'No backups yet. Create one before you try something risky!'));
    } catch (e) { mount(list, h('div', { class: 'banner bad' }, icon('warn', 18), e.message)); }
  }
  const make = (scope) => async (e) => {
    if (busy) return; busy = true; const b = e.currentTarget; b.classList.add('spin'); b.disabled = true;
    try { await post(`/api/servers/${id}/backups`, { scope }); toast('Backup created', { type: 'success' }); await load(); } catch (err) { toast(err.message, { type: 'error', title: 'Backup failed' }); }
    busy = false; b.classList.remove('spin'); b.disabled = false;
  };
  mount(root, h('div', { class: 'card glass' }, h('div', { class: 'card-head', style: { display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' } }, h('div', { class: 'grow' }, h('h3', null, 'Backups'), h('p', { class: 'muted' }, 'Snapshots are stored in Chestplate\'s backups folder. Safe to take while the server runs.')),
    h('button', { class: 'btn primary', onclick: make('worlds') }, icon('archive', 16), 'Back up worlds'), h('button', { class: 'btn', onclick: make('full') }, icon('layers', 16), 'Full backup')), list));
  load();
  return { el: root };
}

/* ================================================================== shared flows (also used by settings) */
export async function reinstallFlow(id) {
  const s = state.servers.get(id);
  if (s.type === 'custom') return toast('Custom servers can\'t be reinstalled automatically. Replace the jar from the Files tab.', { type: 'warn' });
  let versions = [];
  try { versions = (await get(`/api/versions/${s.type}`)).versions; } catch (e) { return toast(e.message, { type: 'error', title: 'Couldn\'t load versions' }); }
  const sel = h('select', { class: 'input select' }, versions.map((v) => h('option', { value: v.id, selected: v.id === s.version }, v.id)));
  if (!versions.some((v) => v.id === s.version)) sel.prepend(h('option', { value: s.version, selected: true }, `${s.version} (current)`));
  const wipe = h('input', { type: 'checkbox' });
  const m = openModal({ title: 'Reinstall server', subtitle: s.name, icon: 'refresh', size: 'sm',
    body: [h('p', { class: 'dialog-msg' }, 'Re-downloads the server software and clears its libraries cache. Your world, plugins and settings are kept.'), field('Version', sel),
      h('label', { class: 'check', style: { marginTop: '.9rem' } }, wipe, 'Also delete the world (fresh start)')],
    actions: [h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: async () => {
      if (wipe.checked && !(await confirmDialog({ title: 'Delete the world?', message: 'The world, nether and end folders will be permanently deleted.', confirmText: 'Delete world & reinstall', danger: true }))) return;
      try { await post(`/api/servers/${id}/reinstall`, { version: sel.value, wipeWorld: wipe.checked }); m.close(); } catch (e) { toast(e.message, { type: 'error' }); }
    } }, 'Reinstall')] });
}
