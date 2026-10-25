// Appearance tab: theme tiles, accent dots, Modern/Classic layout, backgrounds, glass, shape & motion.
import { put, post, state } from '../api.js';
import { h, mount, toast, pageHeader, card, row, toggle, slider, segmented, select, debounce, confirmDialog, pickFile, field } from '../core.js';
import { icon } from '../icons.js';
import { applyAppearance, PRESETS } from '../theme.js';

const darken = (hex, f = 0.78) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * f).toString(16).padStart(2, '0')).join('');

export function renderAppearance() {
  const a = state.appearance;
  const saved = h('span', { class: 'saved-flag' }, icon('check', 14), 'Saved');
  const flash = () => { saved.classList.add('show'); setTimeout(() => saved.classList.remove('show'), 1400); };
  const persist = debounce(async () => { try { await put('/api/appearance', a); flash(); } catch (e) { toast(e.message, { type: 'error' }); } }, 450);
  const change = (patch, { rebuild = false } = {}) => { Object.assign(a, patch); applyAppearance(a); persist(); paintMock(); if (rebuild) build(); };

  const root = h('div');
  const mock = h('div', { class: 'mock' });

  /* ---- a miniature of the app, always in sync with the settings ---- */
  function paintMock() {
    mock.dataset.mode = a.sidebar;
    const item = (on) => h('div', { class: `m-item ${on ? 'on' : ''}` }, h('i'), h('b'));
    mount(mock,
      h('div', { class: 'm-side' }, h('div', { class: 'm-logo' }), item(true), item(false), item(false)),
      h('div', { class: 'm-main' }, h('div', { class: 'm-bar' }), h('div', { class: 'm-bar s' }), h('div', { class: 'm-cards' }, h('i'), h('i'), h('i')), h('div', { class: 'm-btn' })));
  }

  function themeCard() {
    const themes = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark'], ['oled', 'OLED']];
    const tile = ([v, label]) => h('button', { class: `theme-tile ${a.theme === v ? 'on' : ''}`, 'aria-pressed': String(a.theme === v), onclick: () => change({ theme: v }, { rebuild: true }) },
      h('div', { class: `thumb th-${v}` }, h('div', { class: 't-side' }), h('div', { class: 't-main' }, h('i'), h('i'), h('i'))), label);
    const preset = PRESETS.find((p) => p.a === a.accent.toLowerCase() && p.b === a.accent2.toLowerCase());
    const dots = h('div', { class: 'dots' }, PRESETS.map((p) => h('button', { class: `dot-btn ${preset === p ? 'on' : ''}`, title: p.name, 'aria-label': p.name, style: { '--g': `linear-gradient(135deg, ${p.a}, ${p.b})` }, onclick: () => change({ accent: p.a, accent2: p.b }, { rebuild: true }) })),
      h('label', { class: `dot-btn custom ${preset ? '' : 'on'}`, title: 'Custom colour' }, icon('plus', 14),
        h('input', { type: 'color', value: a.accent, 'aria-label': 'Custom accent colour', oninput: (e) => change({ accent: e.target.value, accent2: darken(e.target.value) }), onchange: () => build() })));
    const targets = a.gradientTargets;
    const tgt = (k, label) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: targets[k], onchange: (e) => { targets[k] = e.target.checked; change({ gradientTargets: { ...targets } }); } }), label);
    const hex2 = h('input', { class: 'input', value: a.accent2, maxlength: 7, oninput: (e) => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) { c2.value = e.target.value; change({ accent2: e.target.value }); } } });
    const c2 = h('input', { type: 'color', value: a.accent2, oninput: (e) => { hex2.value = e.target.value; change({ accent2: e.target.value }); } });
    return card('Look and feel', 'Changes apply instantly.',
      h('div', { style: { margin: '16px 20px 0' } }, mock),
      row('Theme', 'Pick a mode. "System" follows Windows.', h('div', { class: 'theme-grid' }, themes.map(tile))),
      row('Layout', a.sidebar === 'modern' ? 'Modern: a slim icon rail.' : 'Classic: wide sidebar with names.', segmented({ value: a.sidebar, options: [{ value: 'modern', label: 'Modern', icon: 'rows' }, { value: 'classic', label: 'Classic', icon: 'list' }], onChange: (v) => change({ sidebar: v }, { rebuild: true }) })),
      row('Accent colour', preset ? preset.name : 'Custom', dots),
      row('Use gradients', 'Blend two colours on buttons and switches. Off = flat colour.', toggle({ checked: a.gradientEnabled, onChange: (v) => change({ gradientEnabled: v }, { rebuild: true }) })),
      a.gradientEnabled ? row('Second colour', 'The other end of the button gradient.', h('div', { class: 'color-row' }, c2, hex2)) : null,
      a.gradientEnabled ? row('Gradient angle', 'Direction of the blend.', slider({ value: a.gradientAngle, min: 0, max: 360, step: 5, onInput: (v) => change({ gradientAngle: v }), format: (v) => `${v}°` })) : null,
      a.gradientEnabled ? row('Apply gradient to', 'Buttons and highlights are always included.', h('div', { class: 'check-row' }, tgt('background', 'Background'), tgt('headings', 'Headings'))) : null);
  }

  function backgroundCard() {
    const tiles = [['glow', 'sw-glow', 'Glow'], ['cosmic', 'sw-cosmic', 'Cosmic'], ['gradient', 'sw-gradient', 'Gradient'], ['solid', 'sw-solid', 'Solid'], ['image', 'sw-image', 'Image']];
    const grid = h('div', { class: 'bg-grid' }, tiles.map(([v, cls, label]) => h('button', { class: `bg-tile ${a.background === v ? 'on' : ''}`, style: { '--solid-prev': a.bgColor }, onclick: () => change({ background: v }, { rebuild: true }) },
      h('div', { class: cls }, v === 'image' ? icon('image', 22) : null), label)));
    const rows = [row('Style', 'The scenery behind everything.', grid)];
    if (a.background === 'cosmic') {
      rows.push(row('Star density', 'How many stars fill the sky.', slider({ value: a.starDensity, min: 0, max: 100, onInput: (v) => change({ starDensity: v }), format: (v) => `${v}%` })),
        row('Nebula glow', 'Intensity of the drifting colour clouds.', slider({ value: a.nebula, min: 0, max: 100, onInput: (v) => change({ nebula: v }), format: (v) => `${v}%` })),
        row('Shooting stars', 'Occasional meteors streak across the sky.', toggle({ checked: a.shootingStars, onChange: (v) => change({ shootingStars: v }) })),
        row('Parallax', 'Stars drift gently as you move the mouse.', toggle({ checked: a.parallax, onChange: (v) => change({ parallax: v }) })));
    }
    if (a.background === 'solid') {
      const hex = h('input', { class: 'input', value: a.bgColor, maxlength: 7, oninput: (e) => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) { color.value = e.target.value; change({ bgColor: e.target.value }); } } });
      const color = h('input', { type: 'color', value: a.bgColor, oninput: (e) => { hex.value = e.target.value; change({ bgColor: e.target.value }); } });
      rows.push(row('Background colour', 'Light mode softens this automatically.', h('div', { class: 'color-row' }, color, hex)));
    }
    if (a.background === 'image') {
      const url = h('input', { class: 'input', placeholder: 'https://… or choose a file', value: a.bgImage.startsWith('data:') ? '(uploaded image)' : a.bgImage, oninput: (e) => change({ bgImage: e.target.value.trim() }) });
      rows.push(row('Wallpaper', 'Any image URL, or upload one from this PC (up to ~1.5 MB).', h('div', { class: 'input-group' }, url,
        h('button', { class: 'btn', onclick: async () => {
          const f = await pickFile('image/*'); if (!f) return;
          if (f.size > 1.5 * 1024 * 1024) return toast('That image is over 1.5 MB. Try a smaller one or use a URL.', { type: 'warn' });
          const rd = new FileReader(); rd.onload = () => { change({ bgImage: rd.result }); url.value = '(uploaded image)'; }; rd.readAsDataURL(f);
        } }, icon('upload', 15), 'Upload'))));
    }
    return card('Background', null, ...rows);
  }

  function glassCard() {
    return card('Transparency & glass', 'Frosted panels that let the background glow through.',
      row('Transparency effects', 'Turn off for solid, high-contrast panels.', toggle({ checked: a.glass, onChange: (v) => change({ glass: v }, { rebuild: true }) })),
      a.glass ? row('Panel opacity', 'Lower = more see-through.', slider({ value: a.glassOpacity, min: 10, max: 100, onInput: (v) => change({ glassOpacity: v }), format: (v) => `${v}%` })) : null,
      a.glass ? row('Blur amount', 'How frosted the glass is.', slider({ value: a.blur, min: 0, max: 60, onInput: (v) => change({ blur: v }), format: (v) => `${v}px` })) : null);
  }

  function shapeCard() {
    return card('Shape & motion', 'Fine-tune how everything feels.',
      row('Corner roundness', 'Cards, panels and dialogs.', slider({ value: a.radius, min: 0, max: 28, onInput: (v) => change({ radius: v }), format: (v) => `${v}px` })),
      row('Text size', 'Scales the whole interface.', slider({ value: a.fontScale, min: 85, max: 130, step: 5, onInput: (v) => change({ fontScale: v }), format: (v) => `${v}%` })),
      row('Density', 'Compact fits more on screen.', segmented({ value: a.density, options: [{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }], onChange: (v) => change({ density: v }) })),
      row('Animations', 'Page transitions, hover effects and background motion.', toggle({ checked: a.animations, onChange: (v) => change({ animations: v }) })),
      row('Servers layout', 'How your servers are displayed by default.', segmented({ value: a.layout, options: [{ value: 'grid', icon: 'grid', label: 'Grid' }, { value: 'list', icon: 'list', label: 'List' }, { value: 'bars', icon: 'rows', label: 'Bars' }], onChange: (v) => change({ layout: v }) })));
  }

  function build() {
    paintMock();
    mount(root, themeCard(), backgroundCard(), glassCard(), shapeCard());
  }
  build();

  const reset = h('button', { class: 'btn', onclick: async () => {
    if (!(await confirmDialog({ title: 'Reset appearance?', message: 'All appearance options return to their defaults.', confirmText: 'Reset', icon: 'refresh' }))) return;
    const r = await post('/api/appearance/reset'); Object.assign(state.appearance, r); applyAppearance(state.appearance); build(); toast('Appearance reset', { type: 'success', timeout: 1500 });
  } }, icon('refresh', 16), 'Reset to default');

  return { title: 'Appearance', el: h('div', { class: 'page' }, pageHeader('Appearance', 'Make Chestplate yours.', saved, reset), root) };
}
