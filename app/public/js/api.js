// API client, shared state, and the live event stream.
export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

export async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store',
    });
  } catch {
    throw new ApiError('Lost connection to Chestplate. Is it still running?', 0, 'NETWORK');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    if (res.status === 401 && data && data.code === 'AUTH') window.dispatchEvent(new CustomEvent('cp:unauthorized'));
    throw new ApiError((data && data.error) || `Request failed (${res.status})`, res.status, data && data.code);
  }
  return data;
}
export const get = (u) => api('GET', u);
export const post = (u, b = {}) => api('POST', u, b);
export const put = (u, b = {}) => api('PUT', u, b);
export const patch = (u, b = {}) => api('PATCH', u, b);
export const del = (u) => api('DELETE', u);

/* ---------------------------------------------------------------- shared state */
export const state = {
  account: null, settings: null, appearance: null, defaults: null,
  servers: new Map(), types: {}, schema: [], groups: [], system: {}, version: '',
};

const subs = new Map();
export function on(type, fn) {
  if (!subs.has(type)) subs.set(type, new Set());
  subs.get(type).add(fn);
  return () => subs.get(type).delete(fn);
}
export function emit(type, data) { for (const fn of subs.get(type) || []) { try { fn(data); } catch (e) { console.error(e); } } }

export function setServers(list) {
  const next = new Map();
  for (const s of list) next.set(s.id, s);
  state.servers = next;
  emit('servers');
}
export const serverList = () => [...state.servers.values()];

export async function loadBootstrap() {
  const b = await get('/api/bootstrap');
  Object.assign(state, {
    account: b.account, settings: b.settings, appearance: b.appearance, defaults: b.defaults,
    types: b.types, schema: b.schema, groups: b.groups, system: b.system, version: b.version,
  });
  setServers(b.servers);
  return b;
}

export async function refreshServers() { const r = await get('/api/servers'); setServers(r.servers); }

/* ---------------------------------------------------------------- live events */
let es = null;
export function connectEvents() {
  if (es) es.close();
  es = new EventSource('/api/events');
  const handle = (type, fn) => es.addEventListener(type, (e) => { let d = {}; try { d = JSON.parse(e.data); } catch { /* ignore */ } fn(d); emit(type, d); });

  handle('hello', () => emit('connected'));
  handle('state', (d) => { if (d.server) { state.servers.set(d.id, d.server); emit('servers', d.id); } });
  handle('list', () => refreshServers().catch(() => {}));
  handle('removed', (d) => { state.servers.delete(d.id); emit('servers'); });
  handle('install', (d) => {
    const s = state.servers.get(d.id);
    if (s) { s.install = { phase: d.phase, message: d.message, percent: d.percent, received: d.received, total: d.total }; emit('servers', d.id); }
  });
  handle('players', (d) => { const s = state.servers.get(d.id); if (s) { s.players = d.players; emit('servers', d.id); } });
  handle('stats', (d) => { const s = state.servers.get(d.id); if (s) { s.memUsed = d.memUsed; s.uptime = d.uptime; s.players = d.players; emit('stats', d.id); } });
  // events that only need to be forwarded to subscribers (console lines, popups, toasts)
  for (const type of ['log', 'installed', 'eula', 'firstStart', 'java']) handle(type, () => {});
  es.onerror = () => emit('disconnected');
  return es;
}
