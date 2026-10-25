// Server → Settings tab: general info, every server.properties option, Advanced, danger zone.
import { get, post, put, patch, del, state, on } from '../api.js';
import { h, mount, clear, card, reveal, toast, openModal, confirmDialog, field, select, slider, toggle, mcText, imageToIcon, pickFile, fmtMem, fmtBytes, MC_COLORS, debounce } from '../core.js';
import { icon } from '../icons.js';
import { navigate } from '../app.js';
import { reinstallFlow } from './server.js';

const tri = (v) => (v === null || v === undefined ? 'default' : v ? 'on' : 'off');
const fromTri = (v) => (v === 'default' ? null : v === 'on');

export function renderServerSettings(id) {
  const getS = () => state.servers.get(id);
  const root = h('div');
  const pending = { gen: {}, props: {}, adv: {} };
  let original = {};      // server.properties as read from disk
  let extraKeys = [];
  let jars = [];
  let query = '';
  let advOpen = false;
  const savebar = h('div', { class: 'savebar glass' });

  const count = () => Object.keys(pending.gen).length + Object.keys(pending.props).length + Object.keys(pending.adv).length;
  function paintSavebar() {
    const n = count();
    savebar.classList.toggle('show', n > 0);
    mount(savebar, icon('info', 18), h('div', { class: 'grow' }, h('b', null, `${n} unsaved change${n === 1 ? '' : 's'}`),
      getS().state === 'running' && Object.keys(pending.props).length ? h('div', { class: 'muted', style: { fontSize: '.8rem' } }, 'Property changes apply next time the server starts.') : null),
      h('button', { class: 'btn ghost', onclick: () => { pending.gen = {}; pending.props = {}; pending.adv = {}; build(); } }, 'Discard'),
      h('button', { class: 'btn primary', id: 'save-all', onclick: saveAll }, icon('save', 16), 'Save changes'));
  }

  async function saveAll(e) {
    const btn = e.currentTarget; btn.disabled = true; btn.classList.add('spin');
    try {
      const s = getS();
      const body = {};
      if (pending.gen.name !== undefined) body.name = pending.gen.name;
      if (pending.gen.description !== undefined) body.description = pending.gen.description;
      if (Object.keys(pending.adv).length) body.advanced = pending.adv;
      if (Object.keys(body).length) await patch(`/api/servers/${id}`, body);
      if (pending.gen.folder !== undefined && pending.gen.folder !== s.folder) await post(`/api/servers/${id}/rename-folder`, { folder: pending.gen.folder });
      let restartNeeded = false;
      if (Object.keys(pending.props).length) { await put(`/api/servers/${id}/properties`, { values: pending.props }); restartNeeded = getS().state === 'running'; }
      pending.gen = {}; pending.props = {}; pending.adv = {};
      toast('Settings saved', { type: 'success', timeout: 2000 });
      if (restartNeeded) toast('Restart the server to apply the new properties.', { type: 'info', action: { label: 'Restart now', onClick: () => post(`/api/servers/${id}/restart`).catch((er) => toast(er.message, { type: 'error' })) }, timeout: 8000 });
      await load();
    } catch (err) { toast(err.message, { type: 'error', title: 'Couldn\'t save' }); btn.disabled = false; btn.classList.remove('spin'); }
  }

  /* ---------------------------------------------------------------- property controls */
  function propValue(p) {
    if (pending.props[p.key] !== undefined) return pending.props[p.key];
    if (original[p.key] !== undefined) return original[p.key];
    return String(p.def);
  }
  function setProp(p, v) {
    v = String(v);
    const orig = original[p.key] !== undefined ? original[p.key] : String(p.def);
    if (v === orig && original[p.key] !== undefined) delete pending.props[p.key]; else if (v === orig) delete pending.props[p.key]; else pending.props[p.key] = v;
    paintSavebar();
  }
  function control(p, rowEl) {
    const cur = propValue(p);
    const mark = () => rowEl.classList.toggle('changed', pending.props[p.key] !== undefined);
    if (p.type === 'bool') return toggle({ checked: cur === 'true', onChange: (v) => { setProp(p, v); mark(); } });
    if (p.type === 'select') {
      const opts = p.options.includes(cur) ? p.options : [cur, ...p.options];
      return select({ options: opts, value: cur, className: 'sm', onChange: (v) => { setProp(p, v); mark(); } });
    }
    if (p.type === 'int') {
      const input = h('input', { class: 'input num sm', type: 'number', min: p.min, max: p.max, value: cur, oninput: () => { if (input.value !== '') { setProp(p, input.value); mark(); } } });
      return input;
    }
    const input = h('input', { class: 'input sm', type: p.secret ? 'password' : 'text', value: cur, autocomplete: 'off', spellcheck: false, oninput: () => { setProp(p, input.value); mark(); } });
    return input;
  }

  function propRow(p) {
    const row = h('div', { class: `prop ${pending.props[p.key] !== undefined ? 'changed' : ''}` });
    row.append(h('div', { class: 't' }, h('b', null, p.label), h('code', null, p.key), h('span', null, p.desc)), h('div', { class: 'c' }, control(p, row)));
    return row;
  }

  /* ---------------------------------------------------------------- general card */
  function generalCard() {
    const s = getS();
    const name = h('input', { class: 'input', value: pending.gen.name ?? s.name, maxlength: 40, oninput: (e) => { e.target.value.trim() === s.name ? delete pending.gen.name : (pending.gen.name = e.target.value); paintSavebar(); } });
    const desc = h('textarea', { class: 'input mono', rows: 2, maxlength: 120, oninput: (e) => { e.target.value === s.description ? delete pending.gen.description : (pending.gen.description = e.target.value); paintSavebar(); paintMotd(); } });
    desc.value = pending.gen.description ?? s.description;
    const motd = h('div', { class: 'motd-preview' });
    const paintMotd = () => mount(motd, mcText(desc.value || 'A Minecraft Server'));
    paintMotd();
    const insert = (code) => { desc.setRangeText(`&${code}`, desc.selectionStart, desc.selectionEnd, 'end'); desc.dispatchEvent(new Event('input')); desc.focus(); };
    const palette = h('div', { class: 'color-codes' }, Object.entries(MC_COLORS).map(([k, c]) => h('button', { type: 'button', title: `&${k}`, style: { background: c }, onclick: () => insert(k) })),
      [['l', 'Bold'], ['o', 'Italic'], ['n', 'Underline'], ['r', 'Reset']].map(([k, l]) => h('button', { type: 'button', class: 'fmt', onclick: () => insert(k) }, l)));
    const iconImg = h('img', { src: `/api/servers/${id}/icon?v=${s.iconVersion}`, alt: '' });
    const folder = h('input', { class: 'input mono', value: pending.gen.folder ?? s.folder, disabled: ['running', 'starting', 'stopping'].includes(s.state), oninput: (e) => { e.target.value === s.folder ? delete pending.gen.folder : (pending.gen.folder = e.target.value.trim()); paintSavebar(); } });
    return h('section', { class: 'card glass' }, h('header', { class: 'card-head' }, h('h3', null, 'General'), h('p', { class: 'muted' }, 'How your server appears in Chestplate and in Minecraft\'s multiplayer list.')),
      h('div', { class: 'two-col' },
        h('div', null, field('Server name', name, 'Only shown inside Chestplate.'), field('Description (MOTD)', desc, 'Sets motd= in server.properties. Use & colour codes; a new line gives you a second line.'), palette, h('div', { style: { marginTop: '.6rem' } }, motd)),
        h('div', null,
          field('Icon', h('div', { class: 'icon-pick' }, iconImg, h('div', { style: { display: 'flex', gap: '.5rem', flexWrap: 'wrap' } },
            h('button', { class: 'btn sm', onclick: async () => { const f = await pickFile('image/*'); if (!f) return; try { const d = await imageToIcon(f); await put(`/api/servers/${id}/icon`, { dataUrl: d }); iconImg.src = d; toast('Icon updated', { type: 'success', timeout: 1600 }); } catch (e) { toast(e.message, { type: 'error' }); } } }, icon('image', 14), 'Upload image'),
            h('button', { class: 'btn sm ghost', onclick: async () => { await del(`/api/servers/${id}/icon`).catch((e) => toast(e.message, { type: 'error' })); iconImg.src = `/api/servers/${id}/icon?v=${Date.now()}`; } }, 'Reset')), ), 'Saved as server-icon.png (64×64).'),
          field('Folder name', folder, ['running', 'starting', 'stopping'].includes(s.state) ? 'Stop the server to rename its folder.' : `Located in ${s.customLocation ? 'a custom location' : 'the Chestplate servers folder'}.`))));
  }

  /* ---------------------------------------------------------------- advanced */
  function advancedCard() {
    const s = getS();
    const a = s.advanced;
    const A = (k) => (pending.adv[k] !== undefined ? pending.adv[k] : a[k]);
    const setA = (k, v) => { if (v === a[k]) delete pending.adv[k]; else pending.adv[k] = v; paintSavebar(); };
    const gm = state.settings.memory;
    const memOverride = A('minMemory') !== null || A('maxMemory') !== null;
    const memWrap = h('div', { class: memOverride ? '' : 'hidden', style: { marginTop: '.5rem' } });
    const paintMem = () => mount(memWrap, h('div', { class: 'two-col' },
      field('Minimum', slider({ value: A('minMemory') ?? gm.min, min: 256, max: 32768, step: 128, format: fmtMem, onInput: (v) => { setA('minMemory', v); if (v > (A('maxMemory') ?? gm.max)) { setA('maxMemory', v); } } })),
      field('Maximum', slider({ value: A('maxMemory') ?? gm.max, min: 256, max: 32768, step: 128, format: fmtMem, onInput: (v) => { setA('maxMemory', v); if (v < (A('minMemory') ?? gm.min)) { setA('minMemory', v); } } }))));
    paintMem();

    const rowOf = (title, desc, ctl) => h('div', { class: 'row' }, h('div', { class: 'row-text' }, h('div', { class: 'row-title' }, title), desc ? h('div', { class: 'row-desc' }, desc) : null), h('div', { class: 'row-control' }, ctl));
    const jarSel = h('select', { class: 'input select sm', onchange: (e) => setA('jar', e.target.value) }, (jars.includes(A('jar')) || !A('jar') ? jars : [A('jar'), ...jars]).map((j) => h('option', { value: j, selected: j === A('jar') }, j)), !A('jar') ? h('option', { value: '', selected: true }, '(none)') : null);
    const jarText = h('input', { class: 'input sm mono', placeholder: 'custom-name.jar', value: A('jar'), oninput: (e) => { setA('jar', e.target.value.trim()); } });

    const storageGb = h('input', { class: 'input num sm', type: 'number', min: 0, step: 0.5, value: A('maxStorageMB') ? +(A('maxStorageMB') / 1024).toFixed(2) : 0, oninput: (e) => setA('maxStorageMB', Math.round(Number(e.target.value || 0) * 1024)) });
    const cpu = slider({ value: A('maxCpu') ?? 100, min: 10, max: 100, step: 5, format: (v) => (v >= 100 ? 'No limit' : `${v}%`), onInput: (v) => setA('maxCpu', v) });
    const used = s.diskBytes || 0;

    const body = h('div', { class: 'adv-body' },
      h('div', { class: 'sub-title', style: { marginTop: '.2rem' } }, 'Startup'),
      rowOf('Server jar', 'The file Chestplate launches. Pick a jar from the folder or type a file name.', h('div', { style: { display: 'flex', gap: '.4rem' } }, jars.length ? jarSel : null, jarText)),
      h('div', { class: 'row stack' }, h('div', { class: 'row-text' }, h('div', { class: 'row-title' }, 'Run command'), h('div', { class: 'row-desc' }, 'Replace the default Java command. Use {java}, {jar}, {min} and {max}. Leave empty to use the standard command.')),
        h('div', { class: 'row-control' }, h('input', { class: 'input mono', placeholder: `java -Xms{min}M -Xmx{max}M -jar ${s.jar || 'server.jar'} nogui`, value: A('runCommand'), oninput: (e) => setA('runCommand', e.target.value) }),
          h('button', { class: 'btn sm', onclick: (e) => { const i = e.currentTarget.previousSibling; i.value = ''; setA('runCommand', ''); } }, 'Reset'))),
      rowOf('Java path', 'Use a specific Java instead of the automatic one. Leave empty for automatic.', h('input', { class: 'input mono sm', placeholder: 'Automatic', value: A('javaPath'), oninput: (e) => setA('javaPath', e.target.value.trim()) })),
      rowOf('Extra JVM arguments', 'Added before -jar, e.g. -Dcom.mojang.eula.agree=true', h('input', { class: 'input mono sm', value: A('extraJvmArgs'), oninput: (e) => setA('extraJvmArgs', e.target.value) })),
      rowOf('Optimised JVM flags (Aikar)', 'Recommended garbage-collector flags for Paper-based servers.', select({ className: 'sm', value: tri(A('aikar')), options: [{ value: 'default', label: `App default (${state.settings.runtime.aikarFlags ? 'on' : 'off'})` }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], onChange: (v) => setA('aikar', fromTri(v)) })),
      rowOf('Restart after a crash', 'Tries up to 3 times in 10 minutes.', select({ className: 'sm', value: tri(A('autoRestart')), options: [{ value: 'default', label: `App default (${state.settings.runtime.autoRestart ? 'on' : 'off'})` }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], onChange: (v) => setA('autoRestart', fromTri(v)) })),

      h('div', { class: 'sub-title' }, 'Resources'),
      h('div', { class: 'row stack' }, h('div', { class: 'row-text' }, h('div', { class: 'row-title' }, 'Memory allocation'), h('div', { class: 'row-desc' }, `Minimum and maximum RAM for this server. App default: ${fmtMem(gm.min)} – ${fmtMem(gm.max)}.`)),
        h('div', { class: 'row-control' }, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: memOverride, onchange: (e) => { if (e.target.checked) { setA('minMemory', gm.min); setA('maxMemory', gm.max); } else { setA('minMemory', null); setA('maxMemory', null); } memWrap.classList.toggle('hidden', !e.target.checked); paintMem(); } }), 'Override the app default for this server')), memWrap),
      rowOf('Max CPU usage', 'Limits how many processor cores Java can use. A soft limit.', cpu),
      rowOf('Max storage', `Blocks starting the server above this size. 0 = unlimited. Currently using ${fmtBytes(used)}.`, h('div', { class: 'input-group' }, storageGb, h('span', { class: 'muted' }, 'GB'))),

      h('div', { class: 'sub-title' }, 'Other server.properties entries'),
      otherProps());

    const el = h('details', { class: 'adv glass', onToggle: () => { advOpen = el.open; } },
      h('summary', null, icon('cpu', 22), h('div', { class: 't' }, h('h3', null, 'Advanced settings'), h('p', null, 'Jar, run command, memory, CPU, storage and more')), h('span', { class: 'plus', 'aria-hidden': 'true' }, '+')),
      body);
    if (advOpen) el.open = true;
    return el;
  }

  function otherProps() {
    const wrap = h('div');
    const rows = extraKeys.map((k) => h('div', { class: 'list-row' }, h('code', { class: 'mono', style: { width: '15rem', fontSize: '.8rem', color: 'var(--text-2)', wordBreak: 'break-all' } }, k),
      h('input', { class: 'input sm mono', value: pending.props[k] ?? original[k] ?? '', oninput: (e) => { e.target.value === original[k] ? delete pending.props[k] : (pending.props[k] = e.target.value); paintSavebar(); } }),
      h('button', { class: 'icon-btn sm', title: 'Remove this entry', onclick: async () => { await del(`/api/servers/${id}/properties/${encodeURIComponent(k)}`).catch((e) => toast(e.message, { type: 'error' })); delete pending.props[k]; await load(); } }, icon('trash', 14))));
    const k = h('input', { class: 'input sm mono', placeholder: 'property-name' });
    const v = h('input', { class: 'input sm mono', placeholder: 'value' });
    wrap.append(rows.length ? rows : h('p', { class: 'hint' }, 'Nothing else is set in server.properties.'),
      h('div', { class: 'input-group', style: { marginTop: '.7rem' } }, k, v, h('button', { class: 'btn sm', onclick: async () => {
        if (!/^[A-Za-z0-9_.\-]+$/.test(k.value.trim())) return toast('Property names use letters, numbers, dots, dashes and underscores.', { type: 'warn' });
        try { await put(`/api/servers/${id}/properties`, { values: { [k.value.trim()]: v.value } }); toast('Property added', { type: 'success', timeout: 1500 }); await load(); } catch (e) { toast(e.message, { type: 'error' }); }
      } }, icon('plus', 14), 'Add')));
    return wrap;
  }

  /* ---------------------------------------------------------------- danger zone */
  function dangerCard() {
    const s = getS();
    const stopped = !['running', 'starting', 'stopping', 'installing'].includes(s.state);
    const act = (title, desc, btn) => h('div', { class: 'row' }, h('div', { class: 'row-text' }, h('div', { class: 'row-title' }, title), h('div', { class: 'row-desc' }, desc)), h('div', { class: 'row-control' }, btn));
    return h('section', { class: 'card glass flush' }, h('header', { class: 'card-head' }, h('h3', null, 'Manage server')),
      act('Reinstall server', 'Download the server software again. Keeps your worlds and settings.', h('button', { class: 'btn', disabled: !stopped || s.type === 'custom', onclick: () => reinstallFlow(id) }, icon('refresh', 16), 'Reinstall')),
      act('Copy server', 'Duplicate everything — world, plugins and settings — under a new name and port.', h('button', { class: 'btn', disabled: !stopped, onclick: () => copyFlow() }, icon('copy', 16), 'Copy')),
      h('div', { class: 'danger-zone' }, act('Delete server', 'Permanently removes the server and its files. This can\'t be undone.', h('button', { class: 'btn danger', onclick: () => deleteFlow() }, icon('trash', 16), 'Delete'))));
  }

  function copyFlow() {
    const s = getS();
    const name = h('input', { class: 'input', value: `${s.name} (copy)`, maxlength: 40 });
    const m = openModal({ title: 'Copy server', subtitle: s.name, icon: 'copy', size: 'sm', body: field('Name of the copy', name, 'A free port is assigned automatically.'),
      actions: [h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: async () => {
        try { const r = await post(`/api/servers/${id}/copy`, { name: name.value }); state.servers.set(r.server.id, r.server); m.close(); navigate(`#/server/${r.server.id}`); } catch (e) { toast(e.message, { type: 'error' }); }
      } }, 'Copy server')] });
  }

  async function deleteFlow() {
    const s = getS();
    const keep = h('input', { type: 'checkbox' });
    const ok = await confirmDialog({ title: `Delete ${s.name}?`, message: 'The server folder, worlds and backups will be permanently deleted. If it\'s running it will be stopped first.', confirmText: 'Delete server', danger: true, requireText: s.name,
      extra: h('label', { class: 'check', style: { margin: '.4rem 0 .8rem' } }, keep, 'Keep the files on disk (only remove it from Chestplate)') });
    if (!ok) return;
    try { await del(`/api/servers/${id}${keep.checked ? '?keepFiles=1' : ''}`); toast(`${s.name} deleted`, { type: 'success' }); navigate('#/servers'); } catch (e) { toast(e.message, { type: 'error', title: 'Couldn\'t delete' }); }
  }

  /* ---------------------------------------------------------------- assemble */
  function build() {
    const s = getS();
    if (!s) return;
    const known = new Set(state.schema.map((p) => p.key));
    extraKeys = Object.keys(original).filter((k) => !known.has(k) && k !== 'motd');
    const q = query.toLowerCase();
    const groups = state.groups.map((g) => {
      const items = state.schema.filter((p) => p.group === g && !p.hidden && (!q || `${p.label} ${p.key} ${p.desc}`.toLowerCase().includes(q)));
      if (!items.length) return null;
      return card(g, null, h('div', { class: 'prop-grid' }, items.map(propRow)));
    });
    mount(root,
      s.state === 'running' ? h('div', { class: 'banner info' }, icon('info', 18), h('div', { class: 'grow' }, 'The server is running. Property changes take effect after a restart.')) : null,
      h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search', 16), h('input', { class: 'input', placeholder: 'Search every setting…', value: query, oninput: debounce((e) => { query = e.target.value; const pos = e.target.selectionStart; build(); const i = root.querySelector('.search input'); i.focus(); i.setSelectionRange(pos, pos); }, 200) }))),
      query ? null : generalCard(), groups, query ? null : advancedCard(), query ? null : dangerCard(), savebar);
    paintSavebar();
    reveal([...root.querySelectorAll('.card:not([data-reveal]), details.adv')]);
  }

  async function load() {
    try {
      const [p, f] = await Promise.all([get(`/api/servers/${id}/properties`), get(`/api/servers/${id}/files?path=`)]);
      original = p.values;
      jars = f.entries.filter((e) => !e.dir && /\.jar$/i.test(e.name)).map((e) => e.name);
      build();
    } catch (e) { mount(root, h('div', { class: 'banner bad' }, icon('warn', 18), e.message)); }
  }
  load();

  // keep disabled states fresh (e.g. folder rename) when the server starts/stops
  let prev = getS() && getS().state;
  const off = on('servers', (sid) => {
    if (sid && sid !== id) return;
    const s = getS(); if (!s) return;
    if (s.state !== prev && !count()) { prev = s.state; build(); } else prev = s.state;
  });
  return { el: root, cleanup: off };
}
