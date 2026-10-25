'use strict';
const path = require('path');
const crypto = require('crypto');
const P = require('./paths');
const { readJson, writeJson, deepMerge, clamp } = require('./util');

const file = (name) => path.join(P.DATA_DIR, name);

/* ------------------------------------------------------------------ defaults */

const DEFAULT_SHORTCUTS = [
  {
    id: 'op', icon: 'shield', label: 'OP {player}', command: 'op {player}',
    offLabel: 'DeOP {player}', offCommand: 'deop {player}', state: 'op',
  },
  {
    id: 'whitelist-player', icon: 'user-check', label: 'Whitelist {player}', command: 'whitelist add {player}',
    offLabel: 'Unwhitelist {player}', offCommand: 'whitelist remove {player}', state: 'whitelist',
  },
  {
    id: 'whitelist-toggle', icon: 'lock', label: 'Enable whitelist', command: 'whitelist on',
    offLabel: 'Disable whitelist', offCommand: 'whitelist off', state: 'whitelistEnabled',
  },
];

const DEFAULT_SETTINGS = {
  memory: { min: 1024, max: 4096 },
  java: { path: '', autoInstall: true },
  firstStart: { popupOp: true, popupWhitelist: true, popupEnableWhitelist: true },
  creation: {
    askDirectory: false,
    autoEula: true,
    defaultType: 'paper',
    startPort: 25565,
    defaultDescription: 'A Chestplate server',
    showSnapshots: false,
  },
  // Global defaults written to every NEW server's server.properties.
  defaults: {
    'view-distance': 10,
    'simulation-distance': 10,
    'online-mode': true,
    hardcore: false,
    difficulty: 'easy',
    gamemode: 'survival',
    'max-players': 20,
    pvp: true,
    'allow-flight': false,
    'allow-nether': true,
    'enable-command-block': false,
    'spawn-protection': 16,
    'white-list': false,
    'accept-transfers': false,
    'enforce-secure-profile': true,
  },
  console: { maxLines: 3000, timestamps: false, wrap: true, stopTimeout: 30 },
  runtime: { autoRestart: false, aikarFlags: false },
  app: { closeBehavior: 'smart' }, // smart: quit after the last window closes if no server is running | background
  shortcuts: DEFAULT_SHORTCUTS,
};

const DEFAULT_APPEARANCE = {
  styleVersion: 4,          // bumped when the look changes so old saved colours don't override it
  theme: 'oled',            // oled | dark | light | system
  sidebar: 'classic',       // classic (wide, labels) | modern (slim icon rail)
  accent: '#3d8bff',
  accent2: '#2f62e0',
  gradientEnabled: true,    // buttons/switches blend accent -> accent2
  gradientAngle: 135,
  gradientTargets: { accent: true, background: true, headings: false },
  background: 'glow',       // glow | cosmic | gradient | solid | image
  bgColor: '#0a0a0a',
  bgImage: '',
  starDensity: 60,
  nebula: 65,
  shootingStars: true,
  parallax: true,
  glass: false,
  glassOpacity: 70,
  blur: 18,
  radius: 12,
  density: 'comfortable',   // comfortable | compact
  fontScale: 100,
  animations: true,
  layout: 'grid',           // grid | list | bars
  sort: 'recent',           // recent | name | status
};

/* ------------------------------------------------------------------ helpers */

const HEX = /^#[0-9a-fA-F]{6}$/;

function sanitizeShortcuts(list) {
  if (!Array.isArray(list)) return DEFAULT_SHORTCUTS;
  const str = (v, n = 80) => String(v ?? '').slice(0, n);
  return list.slice(0, 40).map((s, i) => ({
    id: str(s.id || `custom-${i}-${crypto.randomBytes(3).toString('hex')}`, 40),
    icon: str(s.icon || 'terminal', 30),
    label: str(s.label || 'Command'),
    command: str(s.command, 300),
    offLabel: str(s.offLabel),
    offCommand: str(s.offCommand, 300),
    state: ['op', 'whitelist', 'whitelistEnabled'].includes(s.state) ? s.state : '',
  })).filter((s) => s.command.trim());
}

function sanitizeSettings(input) {
  const s = deepMerge(DEFAULT_SETTINGS, input || {});
  s.memory.min = clamp(s.memory.min, 256, 262144, 1024);
  s.memory.max = clamp(s.memory.max, 256, 262144, 4096);
  if (s.memory.min > s.memory.max) s.memory.min = s.memory.max;
  s.java.path = String(s.java.path || '').trim();
  s.creation.startPort = clamp(s.creation.startPort, 1024, 65535, 25565);
  s.creation.defaultDescription = String(s.creation.defaultDescription || '').slice(0, 200);
  if (!['paper', 'purpur', 'vanilla', 'fabric'].includes(s.creation.defaultType)) s.creation.defaultType = 'paper';
  s.console.maxLines = clamp(s.console.maxLines, 200, 20000, 3000);
  s.console.stopTimeout = clamp(s.console.stopTimeout, 5, 300, 30);
  if (!['smart', 'background'].includes(s.app.closeBehavior)) s.app.closeBehavior = 'smart';
  s.shortcuts = sanitizeShortcuts(s.shortcuts);
  return s;
}

function sanitizeAppearance(input) {
  // Anything saved by an earlier design (v4 also re-enables animations that a bug had switched off) starts from the new look; layout/sort are kept.
  if (input && input.styleVersion !== DEFAULT_APPEARANCE.styleVersion) input = { layout: input.layout, sort: input.sort };
  const a = deepMerge(DEFAULT_APPEARANCE, input || {});
  for (const k of ['accent', 'accent2', 'bgColor']) if (!HEX.test(a[k])) a[k] = DEFAULT_APPEARANCE[k];
  a.styleVersion = DEFAULT_APPEARANCE.styleVersion;
  if (!['oled', 'dark', 'light', 'system'].includes(a.theme)) a.theme = 'oled';
  if (!['classic', 'modern'].includes(a.sidebar)) a.sidebar = 'classic';
  if (!['glow', 'cosmic', 'gradient', 'solid', 'image'].includes(a.background)) a.background = 'glow';
  if (!['grid', 'list', 'bars'].includes(a.layout)) a.layout = 'grid';
  if (!['recent', 'name', 'status'].includes(a.sort)) a.sort = 'recent';
  if (!['comfortable', 'compact'].includes(a.density)) a.density = 'comfortable';
  a.gradientAngle = clamp(a.gradientAngle, 0, 360, 135);
  a.starDensity = clamp(a.starDensity, 0, 100, 60);
  a.nebula = clamp(a.nebula, 0, 100, 65);
  a.glassOpacity = clamp(a.glassOpacity, 10, 100, 70);
  a.blur = clamp(a.blur, 0, 60, 18);
  a.radius = clamp(a.radius, 0, 28, 12);
  a.fontScale = clamp(a.fontScale, 85, 130, 100);
  a.bgImage = /^(https?:\/\/|data:image\/)/i.test(a.bgImage || '') ? String(a.bgImage).slice(0, 2000) : '';
  for (const k of ['gradientEnabled', 'shootingStars', 'parallax', 'glass', 'animations']) a[k] = !!a[k];
  return a;
}

/* ------------------------------------------------------------------ store */

let settings = null;
let appearance = null;

const store = {
  DEFAULT_SETTINGS,
  DEFAULT_APPEARANCE,
  DEFAULT_SHORTCUTS,

  getSettings() {
    if (!settings) settings = sanitizeSettings(readJson(file('settings.json'), {}));
    return settings;
  },
  setSettings(next) {
    settings = sanitizeSettings(next);
    writeJson(file('settings.json'), settings);
    return settings;
  },
  getAppearance() {
    if (!appearance) appearance = sanitizeAppearance(readJson(file('appearance.json'), {}));
    return appearance;
  },
  setAppearance(next) {
    appearance = sanitizeAppearance(next);
    writeJson(file('appearance.json'), appearance);
    return appearance;
  },

  /* ---- account (single local account, optional PIN) ---- */
  getAccount() { return readJson(file('account.json'), null); },
  createAccount(username) {
    const acc = { username, createdAt: Date.now(), pin: null };
    writeJson(file('account.json'), acc);
    return acc;
  },
  updateAccount(patch) {
    const acc = { ...this.getAccount(), ...patch };
    writeJson(file('account.json'), acc);
    return acc;
  },
  hashPin(pin) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
    return { salt, hash };
  },
  checkPin(acc, pin) {
    if (!acc || !acc.pin) return true;
    try {
      const h = crypto.scryptSync(String(pin || ''), acc.pin.salt, 32);
      return crypto.timingSafeEqual(h, Buffer.from(acc.pin.hash, 'hex'));
    } catch { return false; }
  },

  /* ---- sessions (hashed tokens on disk so a restart doesn't sign you out) ---- */
  _sessions() { return readJson(file('sessions.json'), {}); },
  _hashToken: (t) => crypto.createHash('sha256').update(String(t)).digest('hex'),
  createSession() {
    const token = crypto.randomBytes(32).toString('base64url');
    const all = this._sessions();
    all[this._hashToken(token)] = Date.now();
    writeJson(file('sessions.json'), all);
    return token;
  },
  validSession(token) {
    if (!token) return false;
    return Object.prototype.hasOwnProperty.call(this._sessions(), this._hashToken(token));
  },
  destroySession(token) {
    const all = this._sessions();
    delete all[this._hashToken(token)];
    writeJson(file('sessions.json'), all);
  },
  clearSessions() { writeJson(file('sessions.json'), {}); },

  /* ---- registry of servers stored outside the default folder ---- */
  getRegistry() { return readJson(file('registry.json'), { paths: [] }); },
  addRegistry(dir) {
    const r = this.getRegistry();
    if (!r.paths.includes(dir)) r.paths.push(dir);
    writeJson(file('registry.json'), r);
  },
  removeRegistry(dir) {
    const r = this.getRegistry();
    r.paths = r.paths.filter((p) => p !== dir);
    writeJson(file('registry.json'), r);
  },
  replaceRegistry(oldDir, newDir) {
    const r = this.getRegistry();
    r.paths = r.paths.map((p) => (p === oldDir ? newDir : p));
    writeJson(file('registry.json'), r);
  },
};

module.exports = store;
