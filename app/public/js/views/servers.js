// Servers tab: grid / list / bars layouts, empty state, and the create-server wizard.
import { get, post, put, state, on, serverList, api } from '../api.js';
import { h, mount, clear, toast, openModal, openRevealWindow, pageHeader, reveal, segmented, select, field, slider, toggle, debounce, mcText, fmtMem, fmtDuration, fmtBytes, timeAgo, imageToIcon, pickFile, MC_COLORS } from '../core.js';
import { icon, LOGO } from '../icons.js';
import { navigate } from '../app.js';

const BUSY = ['starting', 'stopping', 'installing'];
const STATE_LABEL = { running: 'Online', starting: 'Starting', stopping: 'Stopping', stopped: 'Offline', crashed: 'Crashed', installing: 'Installing', failed: 'Failed' };
const STATE_CHIP = { running: 'ok', starting: 'warn', stopping: 'warn', installing: 'accent', crashed: 'bad', failed: 'bad', stopped: '' };

export const stateChip = (s) => h('span', { class: `chip ${STATE_CHIP[s] || ''}` }, h('span', { class: `dot ${s}` }), STATE_LABEL[s] || s);
export const typeLabel = (t) => (state.types[t] ? state.types[t].label : t);
export const verLabel = (s) => `${typeLabel(s.type)}${s.version && s.version !== 'custom' ? ` ${s.version}` : ''}`;

export async function quickToggle(s, e) {
  e && e.stopPropagation();
  try {
    if (['running', 'starting'].includes(s.state)) await post(`/api/servers/${s.id}/stop`);
    else await post(`/api/servers/${s.id}/start`);
  } catch (err) {
    toast(err.message, { type: 'error', title: `Couldn't start ${s.name}` });
  }
}

function pingBars(s) {
  const cls = s.state === 'running' ? 'on' : BUSY.includes(s.state) ? 'busy' : '';
  return h('span', { class: `mc-ping ${cls}` }, [1, 2, 3, 4, 5].map(() => h('i')));
}

function mcEntry(s) {
  const online = s.state === 'running';
  const motd = s.state === 'installing' ? (s.install ? s.install.message : 'Installing…') : s.description || '';
  return h('div', { class: 'mc-entry' },
    h('img', { class: 'mc-icon', src: `/api/servers/${s.id}/icon?v=${s.iconVersion}`, alt: '', onerror: (e) => { e.target.style.visibility = 'hidden'; } }),
    h('div', { class: 'mc-info' },
      h('div', { class: 'mc-title' }, h('span', { class: 'nm' }, s.name)),
      h('div', { class: 'mc-motd' }, mcText(motd || 'A Minecraft Server', { defaultColor: '#aaaaaa' }))),
    h('div', { class: 'mc-side' }, h('span', null, online ? [h('span', { style: { color: '#aaa' } }, s.players.length), h('span', { style: { color: '#555' } }, '/'), h('span', { style: { color: '#aaa' } }, s.maxPlayers)] : '—'), pingBars(s)));
}

function actionButtons(s, wide = false) {
  const running = ['running', 'starting'].includes(s.state);
  const locked = ['installing', 'stopping'].includes(s.state);
  return h('div', { class: `scard-actions ${wide ? 'wide' : ''}` },
    h('button', { class: `btn sm ${running ? 'danger' : 'ok'}`, disabled: locked, title: running ? 'Stop server' : 'Start server', onclick: (e) => quickToggle(s, e) },
      icon(running ? 'stop' : 'play', 14), running ? 'Stop' : 'Start'),
    h('button', { class: 'btn sm', title: 'Open console', onclick: (e) => { e.stopPropagation(); navigate(`#/server/${s.id}/console`); } }, icon('terminal', 14)),
    h('button', { class: 'btn sm', title: 'Server settings', onclick: (e) => { e.stopPropagation(); navigate(`#/server/${s.id}/settings`); } }, icon('sliders', 14)));
}

function gridCard(s, i) {
  return h('article', { class: `scard glass ${s.state}`, style: { '--i': i }, tabindex: 0, onclick: () => navigate(`#/server/${s.id}`), onkeydown: (e) => { if (e.key === 'Enter') navigate(`#/server/${s.id}`); } },
    mcEntry(s),
    h('div', { class: 'scard-foot' },
      h('div', { class: 'scard-meta' }, stateChip(s.state), h('span', { class: 'chip' }, verLabel(s)), h('span', { class: 'chip', title: 'Port' }, icon('wifi', 12), s.port)),
      actionButtons(s, true)));
}

function listRow(s, i) {
  return h('article', { class: `scard glass ${s.state}`, style: { '--i': i }, tabindex: 0, onclick: () => navigate(`#/server/${s.id}`), onkeydown: (e) => { if (e.key === 'Enter') navigate(`#/server/${s.id}`); } },
    mcEntry(s), h('div', { class: 'scard-foot' }, h('span', { class: 'chip', style: { marginRight: '.5rem' } }, verLabel(s)), stateChip(s.state), actionButtons(s)));
}

function barRow(s, i) {
  const maxMb = s.memory.max;
  const usedMb = s.memUsed / 1048576;
  const pct = s.state === 'running' || s.state === 'starting' ? Math.min(100, (usedMb / maxMb) * 100) : 0;
  const players = s.state === 'running' ? s.players.length / Math.max(1, s.maxPlayers) * 100 : 0;
  return h('article', { class: `bar-row glass ${s.state}`, style: { '--i': i }, tabindex: 0, onclick: () => navigate(`#/server/${s.id}`) },
    h('img', { src: `/api/servers/${s.id}/icon?v=${s.iconVersion}`, alt: '', onerror: (e) => { e.target.style.visibility = 'hidden'; } }),
    h('div', { class: 'bar-name' }, h('b', null, s.name), h('span', null, `${verLabel(s)} · :${s.port}`)),
    stateChip(s.state),
    h('div', { class: 'bar-meter' }, h('div', { class: 'meter-label' }, h('span', null, 'Memory'), h('span', null, s.state === 'running' ? `${fmtMem(Math.round(usedMb))} / ${fmtMem(maxMb)}` : `${fmtMem(maxMb)} max`)),
      h('div', { class: `meter ${pct > 90 ? 'bad' : pct > 75 ? 'warn' : ''}`, style: { '--v': `${pct}%` } }, h('i'))),
    h('div', { class: 'bar-meter' }, h('div', { class: 'meter-label' }, h('span', null, 'Players'), h('span', null, `${s.players.length} / ${s.maxPlayers}`)),
      h('div', { class: 'meter', style: { '--v': `${players}%` } }, h('i'))),
    h('div', { class: 'bar-stat' }, s.state === 'running' ? fmtDuration(s.uptime) : s.lastStartedAt ? timeAgo(s.lastStartedAt) : 'never run'),
    actionButtons(s));
}

function arrowArt() {
  return h('div', { class: 'point-arrow', innerHTML: '<svg viewBox="0 0 170 120" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M14 104 C 52 108, 122 92, 146 20"/><path d="M126 34 L147 14 L158 40"/></svg><span>Start here</span>' });
}

export function renderServers() {
  const a = state.appearance;
  let query = '';
  const grid = h('div', { class: 'server-grid' });
  const countEl = h('p', null);
  const newBtn = h('button', { class: 'btn primary go', id: 'new-server-btn', onclick: () => openCreateWizard() }, icon('plus', 16), 'Create server');
  const search = h('input', { class: 'input', placeholder: 'Search servers…', oninput: (e) => { query = e.target.value.toLowerCase(); paint(); } });
  const layout = segmented({
    value: a.layout, options: [{ value: 'grid', icon: 'grid', label: 'Grid', title: 'Grid' }, { value: 'list', icon: 'list', label: 'List', title: 'List' }, { value: 'bars', icon: 'rows', label: 'Bars', title: 'Bars' }],
    onChange: (v) => { a.layout = v; paint(true); save(); },
  });
  const sort = select({ value: a.sort, options: [{ value: 'recent', label: 'Recently used' }, { value: 'name', label: 'Name' }, { value: 'status', label: 'Status' }], className: 'sm', onChange: (v) => { a.sort = v; paint(); save(); } });
  sort.style.width = '11.5rem';
  const save = debounce(() => put('/api/appearance', a).catch(() => {}), 500);
  const toolbar = h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search', 16), search), sort, h('span', { class: 'grow' }), layout);
  const headActions = h('div', { class: 'actions' });
  const header = h('header', { class: 'page-head' }, h('div', { class: 'grow' }, h('h1', null, 'Servers'), countEl), headActions);
  const body = h('div');
  let sig = '';

  function paint(animate) {
    const all = serverList();
    const order = { running: 0, starting: 1, stopping: 2, installing: 3, crashed: 4, failed: 5, stopped: 6 };
    const list = all.filter((s) => !query || `${s.name} ${s.version} ${s.type}`.toLowerCase().includes(query))
      .sort((x, y) => a.sort === 'name' ? x.name.localeCompare(y.name) : a.sort === 'status' ? (order[x.state] - order[y.state]) || x.name.localeCompare(y.name) : (y.lastStartedAt || y.createdAt) - (x.lastStartedAt || x.createdAt));
    const online = all.filter((s) => s.state === 'running').length;
    countEl.textContent = all.length ? `${all.length} server${all.length === 1 ? '' : 's'}${online ? ` · ${online} online` : ''}` : 'Create and manage Minecraft servers on this PC';
    toolbar.classList.toggle('hidden', !all.length);
    if (!all.length) {
      if (sig !== 'empty') {
        sig = 'empty';
        clear(headActions);
        newBtn.classList.add('glow');
        mount(body, h('div', { class: 'empty' }, h('div', { class: 'logo-art', innerHTML: LOGO.replace('<svg', '<svg width="72" height="72"') }),
          h('h2', null, 'You don\'t have any servers'),
          h('p', null, 'Create one in a minute. Chestplate downloads the server software, sets up Java and gets everything ready.'),
          h('div', { class: 'cta-wrap' }, newBtn, arrowArt())));
        reveal([...body.querySelectorAll('.empty')]);
      }
      return;
    }
    if (sig === 'empty') sig = '';
    newBtn.classList.remove('glow');
    if (!headActions.contains(newBtn)) mount(headActions, newBtn);
    if (!list.length) { mount(body, h('div', { class: 'empty' }, h('h2', { style: { fontSize: '1.2rem' } }, 'No matches'), h('p', null, `Nothing named “${query}”.`))); sig = ''; return; }
    const newSig = JSON.stringify(list.map((s) => [s.id, s.state, s.name, s.description, s.players.length, s.version, s.port, s.iconVersion, s.install && Math.round(s.install.percent), Math.round(s.memUsed / 4194304)])) + a.layout;
    if (newSig === sig && !animate) return;
    sig = newSig;
    grid.className = `server-grid ${a.layout}`;
    const make = a.layout === 'bars' ? barRow : a.layout === 'list' ? listRow : gridCard;
    const cards = list.map((s, i) => make(s, i));
    mount(grid, cards);
    mount(body, grid);
    if (animate) { openRevealWindow(); reveal(cards, { step: 0.05 }); }
  }
  paint(true);
  const off = [on('servers', () => paint()), on('stats', () => paint())];
  return {
    title: 'Servers', cleanup: () => { off.forEach((f) => f()); },
    el: h('div', { class: 'page' }, header, toolbar, body),
  };
}

/* ====================================================================== wizard */

const TYPE_ORDER = ['paper', 'purpur', 'vanilla', 'fabric', 'custom'];
const TYPE_TAGS = { paper: 'Recommended' };

export async function openCreateWizard() {
  const s = state.settings;
  const d = {
    step: 1, type: s.creation.defaultType, version: '', name: '', description: s.creation.defaultDescription || '', icon: null,
    port: s.creation.startPort, overrideMem: false, minMemory: s.memory.min, maxMemory: s.memory.max, directory: '', snapshots: !!s.creation.showSnapshots,
    jarUrl: '', jarPath: '', runCommand: '', versions: [], loadingVersions: false, versionError: '', filter: '',
  };
  // a free default port so two servers never clash
  const used = new Set(serverList().map((x) => x.port));
  while (used.has(d.port) && d.port < 65535) d.port++;

  const body = h('div');
  const m = openModal({ title: 'Create a server', subtitle: 'Choose the software, then give it a name.', icon: 'plus', size: 'lg', body, actions: [] });
  let motdPreview;

  async function loadVersions() {
    if (d.type === 'custom') { d.versions = []; paint(); return; }
    d.loadingVersions = true; d.versionError = ''; paint();
    try {
      const r = await get(`/api/versions/${d.type}${d.snapshots ? '?snapshots=1' : ''}`);
      d.versions = r.versions;
      if (!d.versions.find((v) => v.id === d.version)) d.version = (d.versions.find((v) => v.stable) || d.versions[0] || {}).id || '';
    } catch (e) { d.versionError = e.message; d.versions = []; }
    d.loadingVersions = false; paint();
  }

  function stepper() {
    const pill = (n, label) => h('div', { class: `step-pill ${d.step === n ? 'on' : ''} ${d.step > n ? 'done' : ''}` }, h('b', null, d.step > n ? icon('check', 13, 3) : n), label);
    return h('div', { class: 'steps' }, pill(1, 'Software'), h('span', { class: 'step-sep' }), pill(2, 'Details'));
  }

  function step1() {
    const cards = TYPE_ORDER.map((t) => h('button', { class: `type-card ${d.type === t ? 'on' : ''}`, type: 'button', onclick: () => { if (d.type === t) return; d.type = t; d.version = ''; loadVersions(); } },
      h('b', null, state.types[t].label), TYPE_TAGS[t] ? h('span', { class: 'chip accent tag' }, TYPE_TAGS[t]) : null, h('span', null, state.types[t].blurb)));
    const parts = [stepper(), h('div', { class: 'type-grid' }, cards)];
    if (d.type === 'custom') {
      parts.push(h('div', { style: { marginTop: '1.1rem' } },
        field('Jar download URL', h('input', { class: 'input', placeholder: 'https://…/server.jar', value: d.jarUrl, oninput: (e) => { d.jarUrl = e.target.value.trim(); validate(); } })),
        field('…or a jar already on this PC', h('input', { class: 'input', placeholder: 'C:\\path\\to\\server.jar', value: d.jarPath, oninput: (e) => { d.jarPath = e.target.value.trim(); validate(); } }), 'Chestplate copies it into the server folder.'),
        field('Run command (optional)', h('input', { class: 'input mono', placeholder: 'java -Xmx{max}M -jar {jar} nogui', value: d.runCommand, oninput: (e) => { d.runCommand = e.target.value; validate(); } }), 'Use {jar}, {min} and {max}. Leave empty for the standard Java command.'),
        field('Minecraft version (for Java selection)', h('input', { class: 'input', placeholder: '1.21.4', value: d.version, oninput: (e) => { d.version = e.target.value.trim(); } }))));
    } else {
      const filtered = d.versions.filter((v) => !d.filter || v.id.includes(d.filter));
      parts.push(h('div', { style: { marginTop: '1.1rem' } },
        h('div', { class: 'input-group', style: { marginBottom: '.6rem' } },
          h('div', { class: 'search grow', style: { maxWidth: 'none' } }, icon('search', 16), h('input', { class: 'input', placeholder: 'Filter versions…', value: d.filter, oninput: (e) => { d.filter = e.target.value.trim(); renderVersions(); } })),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: d.snapshots, onchange: (e) => { d.snapshots = e.target.checked; loadVersions(); } }), 'Snapshots')),
        d.loadingVersions ? h('div', { class: 'muted', style: { padding: '1.2rem', textAlign: 'center' } }, 'Loading versions…')
          : d.versionError ? h('div', { class: 'banner bad' }, icon('warn', 18), h('div', { class: 'grow' }, d.versionError), h('button', { class: 'btn sm', onclick: loadVersions }, 'Retry'))
            : h('div', { class: 'version-list', id: 'ver-list' }, filtered.map((v) => h('button', { class: `ver ${d.version === v.id ? 'on' : ''}`, type: 'button', onclick: () => { d.version = v.id; renderVersions(); validate(); } }, v.id))),
        !d.loadingVersions && !d.versionError && !filtered.length ? h('p', { class: 'hint' }, 'No versions match that filter.') : null));
    }
    return parts;
  }

  function renderVersions() {
    const list = body.querySelector('#ver-list');
    if (!list) return;
    const filtered = d.versions.filter((v) => !d.filter || v.id.includes(d.filter));
    mount(list, filtered.map((v) => h('button', { class: `ver ${d.version === v.id ? 'on' : ''}`, type: 'button', onclick: () => { d.version = v.id; renderVersions(); validate(); } }, v.id)));
  }

  function step2() {
    const nameInput = h('input', { class: 'input', placeholder: 'My awesome server', maxlength: 40, value: d.name, oninput: (e) => { d.name = e.target.value; validate(); } });
    const descInput = h('textarea', { class: 'input mono', rows: 2, maxlength: 120, placeholder: '&aWelcome to my server!', oninput: (e) => { d.description = e.target.value; paintMotd(); } }, d.description);
    descInput.value = d.description;
    motdPreview = h('div', { class: 'motd-preview' });
    const paintMotd = () => mount(motdPreview, mcText(d.description || 'A Minecraft Server'));
    paintMotd();
    const palette = h('div', { class: 'color-codes' }, Object.entries(MC_COLORS).map(([k, c]) => h('button', { type: 'button', title: `&${k}`, style: { background: c }, onclick: () => { descInput.setRangeText(`&${k}`, descInput.selectionStart, descInput.selectionEnd, 'end'); descInput.dispatchEvent(new Event('input')); descInput.focus(); } })),
      ['l:Bold', 'o:Italic', 'n:Underline', 'r:Reset'].map((f) => { const [k, l] = f.split(':'); return h('button', { type: 'button', class: 'fmt', onclick: () => { descInput.setRangeText(`&${k}`, descInput.selectionStart, descInput.selectionEnd, 'end'); descInput.dispatchEvent(new Event('input')); descInput.focus(); } }, l); }));
    const iconImg = h('img', { src: d.icon || '', alt: '', style: { display: d.icon ? '' : 'none' } });
    const iconBox = h('div', { class: 'icon-pick' }, iconImg,
      h('div', null, h('div', { style: { display: 'flex', gap: '.5rem' } },
        h('button', { class: 'btn sm', type: 'button', onclick: async () => { const f = await pickFile('image/*'); if (!f) return; try { d.icon = await imageToIcon(f); iconImg.src = d.icon; iconImg.style.display = ''; } catch (e) { toast(e.message, { type: 'error' }); } } }, icon('image', 14), 'Choose image'),
        d.icon ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { d.icon = null; iconImg.style.display = 'none'; } }, 'Remove') : null),
      h('p', { class: 'hint', style: { marginTop: '.3rem' } }, d.icon ? 'Resized to 64×64.' : 'Optional — a unique icon is generated for you.')));

    const dirRow = h('div', { class: 'input-group' }, h('input', { class: 'input mono', readOnly: true, value: d.directory || `${state.system.serversDir}`, id: 'dir-input' }),
      h('button', { class: 'btn', type: 'button', onclick: async () => { const p = await pickFolder(d.directory || state.system.serversDir); if (p) { d.directory = p === state.system.serversDir ? '' : p; body.querySelector('#dir-input').value = p; validate(); } } }, icon('folder', 16), 'Browse'));

    const mem = h('div', { class: 'two-col', style: { marginTop: '.7rem' } },
      field('Minimum memory', slider({ value: d.minMemory, min: 512, max: 32768, step: 256, format: fmtMem, onInput: (v) => { d.minMemory = v; if (d.minMemory > d.maxMemory) d.maxMemory = d.minMemory; } })),
      field('Maximum memory', slider({ value: d.maxMemory, min: 512, max: 32768, step: 256, format: fmtMem, onInput: (v) => { d.maxMemory = v; if (d.minMemory > d.maxMemory) d.minMemory = d.maxMemory; } })));
    const memWrap = h('div', { class: d.overrideMem ? '' : 'hidden' }, mem);

    return [stepper(),
      h('div', { class: 'two-col' },
        h('div', null, field('Server name', nameInput), field('Description (MOTD)', descInput, 'Shown in the Minecraft server list. Use & colour codes.'), palette, h('div', { style: { marginTop: '.6rem' } }, motdPreview)),
        h('div', null, field('Icon', iconBox),
          field('Port', h('input', { class: 'input num', type: 'number', min: 1024, max: 65535, value: d.port, oninput: (e) => { d.port = Number(e.target.value); validate(); }, style: { width: '8rem', textAlign: 'left' } }), 'Players connect with your IP and this port.'),
          field('Location', dirRow, s.creation.askDirectory ? 'You chose to be asked for a location every time.' : 'Defaults to the Chestplate servers folder.'),
          h('div', { style: { marginTop: '.9rem' } }, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: d.overrideMem, onchange: (e) => { d.overrideMem = e.target.checked; memWrap.classList.toggle('hidden', !d.overrideMem); } }), 'Use custom memory for this server'), memWrap)))];
  }

  function validate() {
    const next = m.el.querySelector('#wiz-next');
    if (!next) return;
    if (d.step === 1) {
      const ok = d.type === 'custom' ? !!(d.jarUrl || d.jarPath || d.runCommand) : !!d.version && !d.loadingVersions;
      next.disabled = !ok;
    } else {
      const portOk = Number.isInteger(d.port) && d.port >= 1024 && d.port <= 65535;
      next.disabled = !d.name.trim() || !portOk;
    }
  }

  function paint() {
    mount(body, d.step === 1 ? step1() : step2());
    const back = h('button', { class: 'btn ghost', onclick: () => { if (d.step === 1) m.close(); else { d.step = 1; paint(); } } }, d.step === 1 ? 'Cancel' : [icon('left', 16), 'Back']);
    const next = h('button', { class: 'btn primary go', id: 'wiz-next', onclick: onNext }, d.step === 1 ? ['Next', icon('right', 16)] : [icon('rocket', 16), 'Create server']);
    m.setActions([back, next]);
    validate();
    const nameEl = body.querySelector('input[placeholder="My awesome server"]');
    if (nameEl && !d.name) {
      const base = d.type === 'custom' ? 'My Server' : `${state.types[d.type].label} ${d.version}`.trim();
      nameEl.placeholder = base;
    }
  }

  async function onNext() {
    if (d.step === 1) {
      d.step = 2;
      if (s.creation.askDirectory && !d.directory) { /* shown in step 2 with emphasis */ }
      paint();
      return;
    }
    if (s.creation.askDirectory && !d.askedDir) {
      const picked = await pickFolder(d.directory || state.system.serversDir);
      if (!picked) return; // cancelled: stay on the form
      d.directory = picked === state.system.serversDir ? '' : picked;
      d.askedDir = true;
    }
    const next = m.el.querySelector('#wiz-next');
    next.disabled = true; next.classList.add('spin');
    try {
      const payload = {
        name: d.name.trim(), type: d.type, version: d.version, description: d.description, icon: d.icon, port: d.port,
        directory: d.directory || undefined,
        minMemory: d.overrideMem ? d.minMemory : undefined, maxMemory: d.overrideMem ? d.maxMemory : undefined,
        jarUrl: d.jarUrl || undefined, jarPath: d.jarPath || undefined, runCommand: d.runCommand || undefined,
      };
      const r = await post('/api/servers', payload);
      state.servers.set(r.server.id, r.server);
      m.close();
      navigate(`#/server/${r.server.id}`);
    } catch (e) { toast(e.message, { type: 'error', title: 'Couldn\'t create the server' }); next.disabled = false; next.classList.remove('spin'); }
  }

  paint();
  if (d.type !== 'custom') loadVersions();
}

/* ---- folder picker used by "custom directory" ---- */
export function pickFolder(start) {
  return new Promise((resolve) => {
    let current = start;
    const list = h('div', { class: 'folder-list' });
    const pathEl = h('input', { class: 'input mono', value: current, onkeydown: (e) => { if (e.key === 'Enter') load(pathEl.value); } });
    const up = h('button', { class: 'btn', title: 'Up one level' }, icon('up', 16));
    let parent = null;
    async function load(p) {
      try {
        const r = await get(`/api/fs/list?path=${encodeURIComponent(p || '')}`);
        current = r.path; parent = r.parent; pathEl.value = r.path; up.disabled = r.parent === null;
        mount(list, r.entries.length ? r.entries.map((e) => h('button', { class: 'folder-item', onclick: () => load(e.path), ondblclick: () => load(e.path) }, icon('folder', 16), e.name)) : h('div', { class: 'muted', style: { padding: '1rem', textAlign: 'center' } }, 'No subfolders here'));
      } catch (e) { toast(e.message, { type: 'error' }); }
    }
    up.addEventListener('click', () => load(parent));
    const newName = h('input', { class: 'input sm', placeholder: 'New folder name' });
    const m = openModal({
      title: 'Choose a folder', icon: 'folder', size: 'md', onClose: () => resolve(null),
      body: [h('div', { class: 'input-group', style: { marginBottom: '.6rem' } }, up, pathEl, h('button', { class: 'btn', onclick: () => load(pathEl.value) }, 'Go')), list,
        h('div', { class: 'input-group', style: { marginTop: '.7rem' } }, newName, h('button', { class: 'btn sm', onclick: async () => { if (!newName.value.trim()) return; try { const r = await post('/api/fs/mkdir', { parent: current, name: newName.value.trim() }); newName.value = ''; await load(r.path); } catch (e) { toast(e.message, { type: 'error' }); } } }, icon('plus', 14), 'Create'))],
      actions: [h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { resolve(current); m.close(); } }, 'Use this folder')],
    });
    load(current);
  });
}
