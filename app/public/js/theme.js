// Turns the saved appearance settings into CSS variables / attributes on <html>.
import { state } from './api.js';
import { restartCosmos } from './cosmos.js';

// Accent presets: a = main accent, b = deeper end of the gradient
export const PRESETS = [
  { name: 'Cosmic', a: '#8b7cf6', b: '#5b5bd6' },
  { name: 'Ember', a: '#ff5a36', b: '#d9301a' },
  { name: 'Rust', a: '#b4573f', b: '#7a2f22' },
  { name: 'Amber', a: '#fbbf24', b: '#e8832a' },
  { name: 'Lime', a: '#7dea5a', b: '#3fc83a' },
  { name: 'Forest', a: '#34a853', b: '#1b6b2c' },
  { name: 'Sage', a: '#6fa98c', b: '#c08a5a' },
  { name: 'Azure', a: '#3d8bff', b: '#2f62e0' },
  { name: 'Sand', a: '#cdbb9f', b: '#7f8aa0' },
  { name: 'Lavender', a: '#c4a5ff', b: '#9d7bff' },
  { name: 'Orchid', a: '#d946ef', b: '#7c2fd0' },
];

const media = window.matchMedia('(prefers-color-scheme: dark)');
let lastKey = '';

export function resolvedTheme(a = state.appearance) {
  if (!a) return 'dark';
  if (a.theme === 'system') return media.matches ? 'dark' : 'light';
  return a.theme === 'oled' ? 'dark' : a.theme;
}

export function applyAppearance(a = state.appearance) {
  if (!a) return;
  const r = document.documentElement;
  const theme = resolvedTheme(a);
  r.dataset.theme = theme;
  r.dataset.oled = a.theme === 'oled' ? 'on' : 'off';
  r.dataset.sidebar = a.sidebar || 'classic';
  r.dataset.bg = a.background;
  r.dataset.glass = a.glass ? 'on' : 'off';
  r.dataset.anim = a.animations ? 'on' : 'off';
  r.dataset.gradHeadings = a.gradientEnabled && a.gradientTargets.headings ? 'on' : 'off';
  const s = r.style;
  s.setProperty('--accent', a.accent);
  s.setProperty('--accent-2', a.accent2);
  const grad = `linear-gradient(${a.gradientAngle}deg, ${a.accent}, ${a.accent2})`;
  s.setProperty('--grad', grad);
  s.setProperty('--btn-bg', a.gradientEnabled ? grad : a.accent);
  s.setProperty('--angle', `${a.gradientAngle}deg`);
  s.setProperty('--radius', `${a.radius}px`);
  s.setProperty('--blur', `${a.blur}px`);
  s.setProperty('--glass', String(a.glassOpacity));
  s.setProperty('--fs', String(a.fontScale / 100));
  s.setProperty('--pad', a.density === 'compact' ? '.72' : '1');
  s.setProperty('--nebula', String(a.nebula));
  s.setProperty('--solid', a.bgColor);
  if (a.background === 'image' && a.bgImage) s.setProperty('--bg-image', `url("${a.bgImage.replace(/"/g, '%22')}")`);
  else s.removeProperty('--bg-image');
  // only restart the star field when something that affects it changed
  const key = [a.background, theme, a.starDensity, a.shootingStars, a.parallax, a.animations, a.accent, a.accent2].join('|');
  if (key !== lastKey) { lastKey = key; restartCosmos(a, theme); }
}

media.addEventListener('change', () => { if (state.appearance && state.appearance.theme === 'system') applyAppearance(); });
