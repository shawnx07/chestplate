'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { EventEmitter } = require('events');

const P = require('./paths');
const store = require('./store');
const props = require('./props');
const providers = require('./providers');
const javaMgr = require('./java');
const manager = require('./servers');
const U = require('./util');
const { HttpError } = U;

const VERSION = require('../package.json').version;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff',
};
const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
const USERNAME = /^[A-Za-z0-9_]{3,16}$/;

/* app-wide event bus (server manager events + java installs + toasts) */
const bus = new EventEmitter();
manager.on('event', (ev) => bus.emit('event', ev));

const clients = new Set();
let lastClientSeen = 0;
let everConnected = false;

bus.on('event', (ev) => {
  const payload = `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;
  for (const res of clients) { try { res.write(payload); } catch { /* closed */ } }
});

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const json = (res, status, data) => {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
};

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

/* ------------------------------------------------------------------ routes */

const routes = [];
const route = (method, pattern, opts, handler) => {
  if (typeof opts === 'function') { handler = opts; opts = {}; }
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, public: !!opts.public, limit: opts.limit, handler });
};

const pinFailures = { count: 0, until: 0 };

function systemInfo() {
  let disk = null;
  try { const s = fs.statfsSync(P.HOME); disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch { /* old node */ }
  return {
    platform: process.platform, arch: os.arch(), node: process.version, version: VERSION,
    cpus: os.cpus().length, totalMem: os.totalmem(), freeMem: os.freemem(),
    home: P.HOME, serversDir: P.SERVERS_DIR, runtimesDir: P.RUNTIMES_DIR, backupsDir: P.BACKUPS_DIR, disk,
  };
}

function sessionInfo(req) {
  const acc = store.getAccount();
  const token = cookies(req).cp_session;
  const authenticated = !!acc && store.validSession(token);
  return {
    setup: !acc,
    authenticated,
    welcome: acc && !authenticated ? { username: acc.username, hasPin: !!acc.pin } : null,
    version: VERSION,
  };
}

function setCookie(res, token) {
  res.setHeader('Set-Cookie', `cp_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`);
}

/* ---- public ---- */
route('GET', '/api/ping', { public: true }, () => ({ app: 'chestplate', version: VERSION }));
route('GET', '/api/session', { public: true }, ({ req }) => sessionInfo(req));

route('POST', '/api/account', { public: true }, ({ body, res }) => {
  if (store.getAccount()) throw new HttpError(409, 'An account already exists on this PC');
  const username = String(body.username || '').trim();
  if (!USERNAME.test(username)) throw new HttpError(400, 'Minecraft usernames are 3–16 characters: letters, numbers and underscores.');
  const acc = store.createAccount(username);
  if (body.pin) {
    if (!/^\d{4,12}$/.test(String(body.pin))) throw new HttpError(400, 'A PIN must be 4–12 digits');
    store.updateAccount({ pin: store.hashPin(body.pin) });
  }
  setCookie(res, store.createSession());
  return { ok: true, username: acc.username };
});

route('POST', '/api/login', { public: true }, ({ body, res }) => {
  const acc = store.getAccount();
  if (!acc) throw new HttpError(409, 'No account yet');
  if (Date.now() < pinFailures.until) throw new HttpError(429, 'Too many wrong PINs. Wait a few seconds and try again.');
  if (!store.checkPin(acc, body.pin)) {
    if (++pinFailures.count >= 5) { pinFailures.until = Date.now() + 30000; pinFailures.count = 0; }
    throw new HttpError(401, 'Wrong PIN');
  }
  pinFailures.count = 0;
  setCookie(res, store.createSession());
  return { ok: true };
});

route('POST', '/api/logout', ({ req, res }) => {
  store.destroySession(cookies(req).cp_session);
  res.setHeader('Set-Cookie', 'cp_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  return { ok: true };
});

/* ---- bootstrap + settings ---- */
route('GET', '/api/bootstrap', () => ({
  account: (() => { const a = store.getAccount(); return { username: a.username, hasPin: !!a.pin, createdAt: a.createdAt }; })(),
  settings: store.getSettings(),
  appearance: store.getAppearance(),
  defaults: { settings: store.DEFAULT_SETTINGS, appearance: store.DEFAULT_APPEARANCE },
  servers: manager.list(),
  types: providers.TYPES,
  schema: props.SCHEMA,
  groups: props.GROUPS,
  system: systemInfo(),
  version: VERSION,
}));

route('PUT', '/api/account', ({ body }) => {
  const acc = store.getAccount();
  const patch = {};
  if (body.username !== undefined) {
    const u = String(body.username).trim();
    if (!USERNAME.test(u)) throw new HttpError(400, 'Minecraft usernames are 3–16 characters: letters, numbers and underscores.');
    patch.username = u;
  }
  if (body.pin !== undefined) {
    if (acc.pin && !store.checkPin(acc, body.currentPin)) throw new HttpError(401, 'Your current PIN is wrong');
    if (body.pin === null || body.pin === '') patch.pin = null;
    else if (!/^\d{4,12}$/.test(String(body.pin))) throw new HttpError(400, 'A PIN must be 4–12 digits');
    else patch.pin = store.hashPin(body.pin);
  }
  const next = store.updateAccount(patch);
  return { username: next.username, hasPin: !!next.pin };
});

route('GET', '/api/settings', () => store.getSettings());
route('PUT', '/api/settings', ({ body }) => store.setSettings(body));
route('POST', '/api/settings/reset', () => store.setSettings({}));
route('GET', '/api/appearance', () => store.getAppearance());
route('PUT', '/api/appearance', ({ body }) => store.setAppearance(body));
route('POST', '/api/appearance/reset', () => store.setAppearance({}));
route('GET', '/api/system', () => systemInfo());

/* ---- java + versions ---- */
route('GET', '/api/java', async () => ({ installed: await javaMgr.listInstalled() }));
route('POST', '/api/java/install', async ({ body }) => {
  const major = Number(body.major);
  if (!Number.isInteger(major) || major < 8 || major > 99) throw new HttpError(400, 'Choose a Java version');
  javaMgr.installManaged(major, (p) => bus.emit('event', { type: 'java', major, ...p, percent: p.total ? (p.received / p.total) * 100 : 0 }))
    .then(() => bus.emit('event', { type: 'java', major, phase: 'done', message: `Java ${major} is ready`, percent: 100 }))
    .catch((e) => bus.emit('event', { type: 'java', major, phase: 'error', message: e.message }));
  return { ok: true };
});

route('GET', '/api/versions/:type', async ({ params, query }) => {
  if (!providers.TYPES[params.type]) throw new HttpError(404, 'Unknown server type');
  try { return { versions: await providers.listVersions(params.type, { snapshots: query.get('snapshots') === '1' }) }; } catch (e) {
    throw new HttpError(502, e.message);
  }
});
route('GET', '/api/versions/:type/:version', async ({ params }) => {
  try {
    const r = await providers.resolve(params.type, decodeURIComponent(params.version));
    return { filename: r.filename, build: r.build || '', channel: r.channel || '', size: r.size || 0, javaMajor: r.javaMajor || providers.guessJavaMajor(params.version) };
  } catch (e) { throw new HttpError(502, e.message); }
});

/* ---- folder picker for "custom directory" ---- */
route('GET', '/api/fs/list', ({ query }) => {
  const p = query.get('path') || '';
  if (!p) {
    if (process.platform === 'win32') {
      const drives = [];
      for (let c = 65; c <= 90; c++) { const d = `${String.fromCharCode(c)}:\\`; if (fs.existsSync(d)) drives.push({ name: d, path: d }); }
      return { path: '', parent: null, entries: drives };
    }
    return fsList(os.homedir());
  }
  return fsList(path.resolve(p));
});
function fsList(dir) {
  let items;
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { throw new HttpError(400, `Can't open ${dir} (${e.code || e.message})`); }
  const parent = path.dirname(dir) === dir ? (process.platform === 'win32' ? '' : null) : path.dirname(dir);
  return {
    path: dir, parent,
    entries: items.filter((d) => d.isDirectory() && !d.name.startsWith('.') && !/^\$/.test(d.name))
      .map((d) => ({ name: d.name, path: path.join(dir, d.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
  };
}
route('POST', '/api/fs/mkdir', ({ body }) => {
  const parent = path.resolve(String(body.parent || ''));
  const name = String(body.name || '');
  if (!U.validFolderName(name)) throw new HttpError(400, 'That isn\'t a valid folder name');
  const dir = path.join(parent, name);
  try { fs.mkdirSync(dir); } catch (e) { throw new HttpError(400, `Couldn't create the folder (${e.code || e.message})`); }
  return fsList(dir);
});

/* ---- servers ---- */
const S = (id) => manager.must(id);
route('GET', '/api/servers', () => ({ servers: manager.list() }));
route('POST', '/api/servers', async ({ body }) => ({ server: await manager.create(body) }));
route('GET', '/api/servers/:id', ({ params }) => ({ server: manager.get(params.id) }));
route('PATCH', '/api/servers/:id', ({ params, body }) => ({ server: manager.patch(params.id, body) }));
route('DELETE', '/api/servers/:id', async ({ params, query }) => manager.remove(params.id, { deleteFiles: query.get('keepFiles') !== '1' }));

route('POST', '/api/servers/:id/start', async ({ params }) => ({ server: await manager.start(params.id) }));
route('POST', '/api/servers/:id/stop', ({ params }) => ({ server: manager.stop(params.id) }));
route('POST', '/api/servers/:id/restart', ({ params }) => ({ server: manager.restart(params.id) }));
route('POST', '/api/servers/:id/kill', ({ params }) => ({ server: manager.kill(params.id) }));
route('POST', '/api/servers/:id/command', ({ params, body }) => { manager.command(params.id, body.command); return { ok: true }; });
route('GET', '/api/servers/:id/log', ({ params, query }) => manager.getLog(params.id, Number(query.get('after')) || 0));
route('DELETE', '/api/servers/:id/log', ({ params }) => { manager.clearLog(params.id); return { ok: true }; });

route('GET', '/api/servers/:id/properties', ({ params }) => manager.getProperties(params.id));
route('PUT', '/api/servers/:id/properties', ({ params, body }) => manager.setProperties(params.id, body.values));
route('DELETE', '/api/servers/:id/properties/:key', ({ params }) => manager.removeProperty(params.id, decodeURIComponent(params.key)));

route('PUT', '/api/servers/:id/icon', { limit: 2 * 1024 * 1024 }, ({ params, body }) => ({ server: manager.setIcon(params.id, body.dataUrl) }));
route('DELETE', '/api/servers/:id/icon', ({ params }) => ({ server: manager.resetIcon(params.id) }));
route('GET', '/api/servers/:id/icon', ({ params, res }) => {
  const f = manager.iconPath(params.id);
  if (!fs.existsSync(f)) throw new HttpError(404, 'No icon');
  res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
  return undefined;
});

route('POST', '/api/servers/:id/rename-folder', ({ params, body }) => ({ server: manager.renameFolder(params.id, body.folder) }));
route('POST', '/api/servers/:id/copy', async ({ params, body }) => ({ server: await manager.copy(params.id, body.name) }));
route('POST', '/api/servers/:id/reinstall', async ({ params, body }) => ({ server: await manager.reinstall(params.id, body) }));
route('POST', '/api/servers/:id/open-folder', ({ params }) => manager.openFolder(params.id));
route('POST', '/api/servers/:id/eula', ({ params }) => ({ server: manager.acceptEula(params.id) }));
route('POST', '/api/servers/:id/first-run', ({ params, body }) => manager.firstRun(params.id, body));
route('POST', '/api/servers/:id/first-run/dismiss', ({ params }) => manager.dismissFirstRun(params.id));
route('GET', '/api/servers/:id/shortcut-state', ({ params }) => manager.shortcutState(params.id));
route('GET', '/api/servers/:id/players', ({ params }) => manager.players(params.id));

route('GET', '/api/servers/:id/files', ({ params, query }) => manager.listFiles(params.id, query.get('path') || ''));
route('GET', '/api/servers/:id/file', ({ params, query }) => manager.readFile(params.id, query.get('path') || ''));
route('PUT', '/api/servers/:id/file', { limit: 2 * 1024 * 1024 }, ({ params, body }) => manager.writeFile(params.id, body.path, body.content));

route('GET', '/api/servers/:id/backups', ({ params }) => ({ backups: manager.listBackups(params.id) }));
route('POST', '/api/servers/:id/backups', async ({ params, body }) => ({ backup: await manager.createBackup(params.id, body.scope) }));
route('DELETE', '/api/servers/:id/backups/:name', ({ params }) => manager.deleteBackup(params.id, decodeURIComponent(params.name)));
route('POST', '/api/servers/:id/backups/:name/restore', async ({ params }) => manager.restoreBackup(params.id, decodeURIComponent(params.name)));
route('GET', '/api/servers/:id/backups/:name/download', ({ params, res }) => {
  const f = manager.backupFile(params.id, decodeURIComponent(params.name));
  res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Length': fs.statSync(f).size, 'Content-Disposition': `attachment; filename="${path.basename(f)}"` });
  fs.createReadStream(f).pipe(res);
  return undefined;
});

route('POST', '/api/app/quit', ({ res }) => {
  json(res, 200, { ok: true });
  setTimeout(() => api.shutdown(), 100);
  return undefined;
});

/* ------------------------------------------------------------------ server */

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.join(P.PUBLIC_DIR, rel);
  if (!file.startsWith(P.PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function handleEvents(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\nevent: hello\ndata: {}\n\n');
  clients.add(res);
  everConnected = true;
  const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 20000);
  req.on('close', () => { clearInterval(beat); clients.delete(res); lastClientSeen = Date.now(); });
}

async function handle(req, res) {
  try {
    if (!LOCAL_HOST.test(req.headers.host || '')) throw new HttpError(403, 'Forbidden host');
    const url = new URL(req.url, 'http://localhost');
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (unsafe) {
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Cross-site request blocked');
      const origin = req.headers.origin;
      if (origin) {
        let o; try { o = new URL(origin); } catch { throw new HttpError(403, 'Bad origin'); }
        if (!LOCAL_HOST.test(o.host) || o.host !== req.headers.host) throw new HttpError(403, 'Cross-origin request blocked');
      }
    }
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);

    if (url.pathname === '/api/events') {
      if (!sessionInfo(req).authenticated) throw new HttpError(401, 'Sign in first');
      return handleEvents(req, res);
    }

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      if (!r.public && !sessionInfo(req).authenticated) throw new HttpError(401, 'Sign in first', 'AUTH');
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      const body = unsafe ? await readBody(req, r.limit) : {};
      const result = await r.handler({ req, res, url, query: url.searchParams, params, body });
      if (result !== undefined && !res.headersSent) json(res, 200, result);
      return undefined;
    }
    throw new HttpError(404, 'Unknown API route');
  } catch (e) {
    if (res.headersSent) { try { res.end(); } catch { /* ignore */ } return undefined; }
    const status = e.status || 500;
    if (status >= 500 && status !== 502) console.error('[api]', req.method, req.url, e);
    return json(res, status, { error: U.fmtErr(e), code: e.code && typeof e.code === 'string' && e.status ? e.code : undefined });
  }
}

const api = {
  bus,
  server: null,
  clientCount: () => clients.size,
  idleMs: () => (everConnected && clients.size === 0 ? Date.now() - lastClientSeen : 0),
  create() { this.server = http.createServer(handle); return this.server; },
  async shutdown(code = 0) {
    try { await manager.stopAll(30000); } catch { /* best effort */ }
    for (const res of clients) { try { res.end(); } catch { /* ignore */ } }
    process.exit(code);
  },
};

module.exports = api;
