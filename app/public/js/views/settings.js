// Global settings: defaults for new servers, first-start popups, console shortcuts, Java, account, about.
import { get, put, post, state, on } from '../api.js';
import { h, mount, toast, pageHeader, pillTabs, card, row, toggle, slider, segmented, select, debounce, confirmDialog, openModal, field, fmtMem, fmtBytes, copyText, avatar } from '../core.js';
import { icon, ICON_NAMES, iconSvg } from '../icons.js';
import { navigate } from '../app.js';

const SECTIONS = [
  { id: 'general', label: 'General', icon: 'cog' },
  { id: 'defaults', label: 'New server defaults', icon: 'sliders' },
  { id: 'shortcuts', label: 'Console shortcuts', icon: 'terminal' },
  { id: 'java', label: 'Java & performance', icon: 'cpu' },
  { id: 'account', label: 'Account', icon: 'user' },
  { id: 'about', label: 'About', icon: 'info' },
];

export function renderSettings(section) {
  if (!SECTIONS.some((s) => s.id === section)) section = 'general';
  const s = state.settings;
  const saved = h('span', { class: 'saved-flag' }, icon('check', 14), 'Saved');
  const persist = debounce(async () => {
    try { const r = await put('/api/settings', s); Object.assign(s, r); saved.classList.add('show'); setTimeout(() => saved.classList.remove('show'), 1400); } catch (e) { toast(e.message, { type: 'error', title: 'Couldn\'t save settings' }); }
  }, 450);
  const save = () => persist();
  const body = h('div');
  let cleanups = [];

  const nav = pillTabs({ options: SECTIONS.map((x) => ({ value: x.id, label: x.label, icon: x.icon })), value: section, label: 'Settings sections',
    onChange: (id) => { section = id; history.replaceState(null, '', `#/settings/${id}`); paintBody(); } });

  /* ---------------------------------------------------------------- sections */
  function general() {
    return [
      card('First start popups', 'Shown the first time a new server finishes starting.',
        row('Offer to make me OP', `Asks to run "op ${state.account.username}".`, toggle({ checked: s.firstStart.popupOp, onChange: (v) => { s.firstStart.popupOp = v; save(); } })),
        row('Offer to whitelist me', `Asks to run "whitelist add ${state.account.username}".`, toggle({ checked: s.firstStart.popupWhitelist, onChange: (v) => { s.firstStart.popupWhitelist = v; save(); } })),
        row('Offer to enable the whitelist', 'Asks whether to turn "whitelist on".', toggle({ checked: s.firstStart.popupEnableWhitelist, onChange: (v) => { s.firstStart.popupEnableWhitelist = v; save(); } }))),
      card('Creating servers', null,
        row('Ask where to save every time', 'Opens a folder picker each time you create a server. Off = use the Chestplate servers folder.', toggle({ checked: s.creation.askDirectory, onChange: (v) => { s.creation.askDirectory = v; save(); } })),
        row('Accept the Minecraft EULA automatically', 'Writes eula=true for new servers. By enabling this you agree to Mojang\'s EULA.', toggle({ checked: s.creation.autoEula, onChange: (v) => { s.creation.autoEula = v; save(); } })),
        row('Default server software', null, select({ className: 'sm', value: s.creation.defaultType, options: Object.entries(state.types).filter(([k]) => k !== 'custom').map(([k, t]) => ({ value: k, label: t.label })), onChange: (v) => { s.creation.defaultType = v; save(); } })),
        row('First port to try', 'New servers get the next free port from here.', numInput(s.creation.startPort, 1024, 65535, (v) => { s.creation.startPort = v; save(); })),
        row('Default description (MOTD)', 'Use & colour codes.', h('input', { class: 'input', value: s.creation.defaultDescription, maxlength: 120, oninput: (e) => { s.creation.defaultDescription = e.target.value; save(); } })),
        row('Show snapshots by default', 'Include snapshot / pre-release versions in the version list.', toggle({ checked: s.creation.showSnapshots, onChange: (v) => { s.creation.showSnapshots = v; save(); } }))),
      card('Console', null,
        row('Lines kept on screen', 'Older lines are dropped to stay fast.', numInput(s.console.maxLines, 200, 20000, (v) => { s.console.maxLines = v; save(); })),
        row('Wrap long lines', null, toggle({ checked: s.console.wrap, onChange: (v) => { s.console.wrap = v; save(); } })),
        row('Timestamps on Chestplate messages', null, toggle({ checked: s.console.timestamps, onChange: (v) => { s.console.timestamps = v; save(); } })),
        row('Force-stop after', 'If a server hasn\'t stopped by itself after this long, Chestplate ends it.', h('div', { class: 'input-group' }, numInput(s.console.stopTimeout, 5, 300, (v) => { s.console.stopTimeout = v; save(); }), h('span', { class: 'muted' }, 'seconds')))),
      card('Chestplate window', null,
        row('When the window closes', 'Smart: quit automatically if no server is running. Servers always keep running while any are online.', segmented({ value: s.app.closeBehavior, options: [{ value: 'smart', label: 'Smart quit' }, { value: 'background', label: 'Stay in background' }], onChange: (v) => { s.app.closeBehavior = v; save(); } }))),
    ];
  }

  function numInput(value, min, max, onChange) {
    const i = h('input', { class: 'input num sm', type: 'number', min, max, value, oninput: () => { const v = Number(i.value); if (Number.isFinite(v) && i.value !== '') onChange(Math.min(max, Math.max(min, Math.round(v)))); } });
    return i;
  }

  function defaults() {
    const mem = h('div', null,
      row('Minimum memory', 'Starting heap size (-Xms).', slider({ value: s.memory.min, min: 256, max: 32768, step: 128, format: fmtMem, onInput: (v) => { s.memory.min = v; if (v > s.memory.max) s.memory.max = v; save(); } })),
      row('Maximum memory', 'Heap limit (-Xmx). 4 GB suits most small servers.', slider({ value: s.memory.max, min: 256, max: 32768, step: 128, format: fmtMem, onInput: (v) => { s.memory.max = v; if (v < s.memory.min) s.memory.min = v; save(); } })));
    const globals = state.schema.filter((p) => p.global);
    const rows = globals.map((p) => {
      const cur = s.defaults[p.key] !== undefined ? s.defaults[p.key] : p.def;
      let ctl;
      if (p.type === 'bool') ctl = toggle({ checked: cur === true || cur === 'true', onChange: (v) => { s.defaults[p.key] = v; save(); } });
      else if (p.type === 'select') ctl = select({ className: 'sm', value: cur, options: p.options, onChange: (v) => { s.defaults[p.key] = v; save(); } });
      else if (p.type === 'int') ctl = numInput(Number(cur), p.min, p.max, (v) => { s.defaults[p.key] = v; save(); });
      else ctl = h('input', { class: 'input sm', value: cur, oninput: (e) => { s.defaults[p.key] = e.target.value; save(); } });
      return row(p.label, p.desc, ctl);
    });
    return [
      card('Memory', 'Used by new servers. Each server can override these in its Advanced settings.', mem),
      card('Default server.properties', 'Written into every NEW server. Existing servers aren\'t changed. (Per-server settings can still change each one.)', ...rows),
      h('div', { style: { marginTop: '1rem' } }, h('button', { class: 'btn', onclick: async () => {
        if (!(await confirmDialog({ title: 'Reset to defaults?', message: 'Memory and new-server defaults go back to Chestplate\'s original values.', confirmText: 'Reset', icon: 'refresh' }))) return;
        const r = await post('/api/settings/reset'); Object.assign(s, r); paintBody(); toast('Defaults restored', { type: 'success', timeout: 1500 });
      } }, icon('refresh', 16), 'Reset all settings')),
    ];
  }

  function shortcuts() {
    const list = h('div');
    const paint = () => {
      mount(list, h('div', { class: 'shortcut-row head' }, h('span', null, 'Icon'), h('span', null, 'Label'), h('span', null, 'Command'), h('span', null, 'Active label'), h('span', null, 'Active command'), h('span')),
        s.shortcuts.map((sc, i) => {
          const f = (k, ph) => h('input', { class: 'input', value: sc[k] || '', placeholder: ph, oninput: (e) => { sc[k] = e.target.value; save(); } });
          return h('div', { class: 'shortcut-row' },
            h('button', { class: 'icon-choice', title: 'Change icon', onclick: () => pickIcon(sc, paint) }, icon(sc.icon || 'terminal', 16)),
            f('label', 'Label'), f('command', 'command'), f('offLabel', 'optional'), f('offCommand', 'optional'),
            h('button', { class: 'icon-btn sm', title: 'Remove', onclick: () => { s.shortcuts.splice(i, 1); save(); paint(); } }, icon('trash', 14)));
        }));
    };
    paint();
    return [card('Console quick commands', 'Buttons shown above every server console. Use {player} for your Minecraft username. Give a button an "active" label + command to make it toggle (e.g. OP ⇄ DeOP) — the built-in ones know the real state from the server.',
      list,
      h('div', { style: { display: 'flex', gap: '.6rem', marginTop: '1rem', flexWrap: 'wrap' } },
        h('button', { class: 'btn primary', onclick: () => { s.shortcuts.push({ id: `custom-${Date.now()}`, icon: 'terminal', label: 'New command', command: 'say hello', offLabel: '', offCommand: '', state: '' }); save(); paint(); } }, icon('plus', 16), 'Add button'),
        h('button', { class: 'btn', onclick: async () => {
          if (!(await confirmDialog({ title: 'Restore default buttons?', message: 'Replaces your list with the built-in OP and whitelist buttons.', confirmText: 'Restore', icon: 'refresh' }))) return;
          s.shortcuts = JSON.parse(JSON.stringify(state.defaults.settings.shortcuts)); save(); paint();
        } }, icon('refresh', 16), 'Restore defaults')),
      h('p', { class: 'hint', style: { marginTop: '.8rem' } }, 'Ideas: "gamemode creative {player}", "time set day", "weather clear", "save-all", "difficulty peaceful", "say Server restarting soon!"'))];
  }

  function pickIcon(sc, repaint) {
    const m = openModal({ title: 'Choose an icon', icon: 'sparkles', size: 'sm',
      body: h('div', { class: 'icon-picker' }, ICON_NAMES.map((n) => h('button', { class: sc.icon === n ? 'on' : '', title: n, onclick: () => { sc.icon = n; save(); m.close(); repaint(); } }, icon(n, 18)))) });
  }

  function java() {
    const list = h('div', { class: 'java-list' }, h('div', { class: 'muted' }, 'Looking for Java…'));
    const loadJava = async () => {
      try {
        const r = await get('/api/java');
        mount(list, r.installed.length ? r.installed.map((j) => h('div', { class: 'list-row' }, h('div', { class: 'ico', style: { color: 'var(--accent)' } }, icon('coffee', 22)),
          h('div', { class: 'grow' }, h('b', null, `Java ${j.major}`, ' ', h('span', { class: `chip ${j.managed ? 'accent' : ''}` }, j.managed ? 'Managed by Chestplate' : 'System')), h('div', { class: 'sub mono', style: { fontSize: '.76rem' } }, `${j.vendor} · ${j.version} · ${j.path}`))))
          : h('div', { class: 'banner warn' }, icon('warn', 18), h('div', { class: 'grow' }, 'No Java found. Chestplate will download the right version automatically when you create or start a server.')));
      } catch (e) { mount(list, h('div', { class: 'banner bad' }, icon('warn', 18), e.message)); }
    };
    loadJava();
    const majors = [8, 17, 21, 25];
    const stop = on('java', (d) => { if (d.phase === 'done') loadJava(); });
    cleanups.push(stop);
    return [
      card('Java runtimes', 'Different Minecraft versions need different Java versions. Chestplate picks the right one per server.',
        row('Install Java automatically', 'Downloads a private copy (Eclipse Temurin) into Chestplate\'s folder when a server needs one. Never touches your system Java.', toggle({ checked: s.java.autoInstall, onChange: (v) => { s.java.autoInstall = v; save(); } })),
        row('Use a specific Java', 'Applies to every server unless it has its own path. Leave empty for automatic.', h('input', { class: 'input mono sm', placeholder: 'Automatic', value: s.java.path, oninput: (e) => { s.java.path = e.target.value.trim(); save(); } })),
        h('div', { class: 'sub-title' }, 'Detected'), list,
        h('div', { class: 'sub-title' }, 'Install a version now'),
        h('div', { style: { display: 'flex', gap: '.5rem', flexWrap: 'wrap' } }, majors.map((m) => h('button', { class: 'btn sm', onclick: async () => { try { await post('/api/java/install', { major: m }); toast(`Downloading Java ${m}…`, { type: 'info', timeout: 2500 }); } catch (e) { toast(e.message, { type: 'error' }); } } }, icon('download', 14), `Java ${m}`)))),
      card('Performance', null,
        row('Optimised JVM flags (Aikar)', 'Better garbage collection for Paper/Purpur. Servers can override this.', toggle({ checked: s.runtime.aikarFlags, onChange: (v) => { s.runtime.aikarFlags = v; save(); } })),
        row('Restart servers after a crash', 'Up to 3 times in 10 minutes. Servers can override this.', toggle({ checked: s.runtime.autoRestart, onChange: (v) => { s.runtime.autoRestart = v; save(); } }))),
    ];
  }

  function account() {
    const user = h('input', { class: 'input', value: state.account.username, maxlength: 16 });
    const curPin = h('input', { class: 'input', type: 'password', inputmode: 'numeric', placeholder: 'Current PIN', maxlength: 12 });
    const newPin = h('input', { class: 'input', type: 'password', inputmode: 'numeric', placeholder: state.account.hasPin ? 'New PIN (empty = remove)' : 'New PIN (4–12 digits)', maxlength: 12 });
    return [
      card('Minecraft username', 'Used for the OP / whitelist shortcuts and first-start popups.',
        h('div', { class: 'input-group', style: { alignItems: 'center' } }, avatar(state.account.username, { size: 44 }), user,
          h('button', { class: 'btn primary', onclick: async () => {
            try { const r = await put('/api/account', { username: user.value.trim() }); state.account.username = r.username; toast('Username updated', { type: 'success', timeout: 1600 }); navigate('#/settings/account'); document.querySelector('.nav-user span').textContent = r.username; } catch (e) { toast(e.message, { type: 'error' }); }
          } }, 'Save'))),
      card('PIN lock', state.account.hasPin ? 'A PIN is required when Chestplate opens.' : 'Optionally protect Chestplate with a PIN.',
        h('div', { style: { display: 'grid', gap: '.6rem', maxWidth: '360px' } }, state.account.hasPin ? curPin : null, newPin,
          h('button', { class: 'btn', onclick: async () => {
            try { const r = await put('/api/account', { pin: newPin.value || null, currentPin: curPin.value }); state.account.hasPin = r.hasPin; toast(r.hasPin ? 'PIN saved' : 'PIN removed', { type: 'success' }); paintBody(); } catch (e) { toast(e.message, { type: 'error' }); }
          } }, icon('lock', 16), state.account.hasPin ? 'Change / remove PIN' : 'Set PIN')))];
  }

  function about() {
    const sys = state.system;
    const kv = (k, v) => h('div', { class: 'list-row' }, h('span', { class: 'muted', style: { width: '9rem' } }, k), h('span', { class: 'mono', style: { fontSize: '.84rem', wordBreak: 'break-all', flex: 1 } }, v));
    return [card('Chestplate', 'Create and manage Minecraft servers on your own PC.',
      kv('Version', state.version), kv('Home folder', sys.home), kv('Servers folder', sys.serversDir), kv('Java runtimes', sys.runtimesDir), kv('Backups', sys.backupsDir),
      kv('System', `${sys.platform} ${sys.arch} · ${sys.cpus} cores · ${fmtBytes(sys.totalMem)} RAM`), sys.disk ? kv('Free disk space', fmtBytes(sys.disk.free)) : null,
      h('div', { style: { marginTop: '1rem', display: 'flex', gap: '.6rem' } }, h('button', { class: 'btn', onclick: () => copyText(sys.home, 'Path copied') }, icon('copy', 15), 'Copy home path')))];
  }

  function paintBody() {
    cleanups.forEach((f) => f()); cleanups = [];
    const make = { general, defaults, shortcuts, java, account, about }[section];
    mount(body, make());
  }

  paintBody();
  return {
    title: 'Settings',
    cleanup: () => cleanups.forEach((f) => f()),
    el: h('div', { class: 'page' },
      pageHeader('Settings', 'Global options for Chestplate and every new server. Saved automatically.', saved),
      nav, body),
  };
}
