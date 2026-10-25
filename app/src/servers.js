'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { spawn, execFile } = require('child_process');

const P = require('./paths');
const store = require('./store');
const props = require('./props');
const providers = require('./providers');
const javaMgr = require('./java');
const { downloadFile } = require('./download');
const { identicon } = require('./icon');
const U = require('./util');
const { HttpError } = U;

const WIN = process.platform === 'win32';
const META = '.chestplate.json';
const LOG_CAP = 5000;
const DONE_RE = /Done \(([\d.,]+)s\)! For help/;
const JOIN_RE = /: ([A-Za-z0-9_.]{1,32}) joined the game/;
const LEAVE_RE = /: ([A-Za-z0-9_.]{1,32}) left the game/;
const EULA_RE = /(agree to the (Minecraft )?EULA|You need to agree to the EULA)/i;

const AIKAR = ('-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions ' +
  '-XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 ' +
  '-XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 ' +
  '-XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 ' +
  '-XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1 ' +
  '-Dusing.aikars.flags=https://mcflags.emc.gs -Daikars.new.flags=true').split(' ');

const eulaText = (v) =>
  `#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).\n#${new Date().toString()}\neula=${v ? 'true' : 'false'}\n`;

const colorize = (s) => String(s || '').replace(/&([0-9a-fk-or])/gi, '§$1');
const uncolorize = (s) => String(s || '').replace(/§/g, '&');

function newRuntime() {
  return {
    state: 'stopped', proc: null, log: [], seq: 0, players: new Set(), startedAt: 0, mem: 0,
    error: '', note: '', install: null, expectedStop: false, restartAfterStop: false, cancelStart: false,
    stopTimer: null, crashTimes: [], buf: { out: '', err: '' }, needsEula: false, logSeeded: false,
  };
}

async function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '0.0.0.0');
  });
}

class ServerManager extends EventEmitter {
  constructor() {
    super();
    this.servers = new Map();
    this.disk = new Map(); // id -> {t, bytes}
  }

  init() {
    this.scan();
    this._timer = setInterval(() => this._pollStats(), 4000);
    this._timer.unref();
  }

  emitEvent(ev) { this.emit('event', ev); }

  /* ------------------------------------------------------------ registry */

  scan() {
    const dirs = new Set();
    try {
      for (const d of fs.readdirSync(P.SERVERS_DIR, { withFileTypes: true })) {
        if (d.isDirectory()) dirs.add(path.join(P.SERVERS_DIR, d.name));
      }
    } catch { /* first run */ }
    for (const p of store.getRegistry().paths) dirs.add(p);
    const seen = new Set();
    for (const dir of dirs) {
      const meta = U.readJson(path.join(dir, META), null);
      if (!meta || !meta.id) continue;
      seen.add(meta.id);
      const existing = this.servers.get(meta.id);
      if (existing) { existing.dir = dir; if (!existing.busy) existing.meta = meta; } else this._register(dir, meta);
    }
    for (const [id, e] of this.servers) {
      if (!seen.has(id) && !e.rt.proc && !e.busy) this.servers.delete(id);
    }
  }

  _register(dir, meta) {
    const entry = { dir, meta, rt: newRuntime(), busy: false };
    if (meta.installed === false) {
      entry.rt.state = 'failed';
      entry.rt.error = 'Installation was interrupted. Use Reinstall to finish setting this server up.';
    }
    this.servers.set(meta.id, entry);
    return entry;
  }

  must(id) {
    const e = this.servers.get(id);
    if (!e) throw new HttpError(404, 'Server not found');
    return e;
  }

  saveMeta(entry) { U.writeJson(path.join(entry.dir, META), entry.meta); }

  /* ------------------------------------------------------------ views */

  propsOf(entry) { return props.read(entry.dir); }

  view(entry) {
    const { meta, rt, dir } = entry;
    const p = this.propsOf(entry);
    let iconV = 0;
    try { iconV = Math.round(fs.statSync(path.join(dir, 'server-icon.png')).mtimeMs); } catch { /* none */ }
    const settings = store.getSettings();
    const cached = this.disk.get(meta.id);
    return {
      id: meta.id,
      name: meta.name,
      description: p.motd !== undefined ? uncolorize(p.motd) : (meta.description || ''),
      type: meta.type,
      version: meta.version,
      build: meta.build || '',
      jar: meta.jar || '',
      folder: path.basename(dir),
      dir,
      customLocation: path.dirname(dir) !== P.SERVERS_DIR,
      state: rt.state,
      note: rt.note,
      error: rt.error,
      install: rt.install,
      needsEula: rt.needsEula,
      players: [...rt.players],
      maxPlayers: Number(p['max-players'] || 20),
      port: Number(p['server-port'] || 25565),
      whitelist: p['white-list'] === 'true',
      onlineMode: p['online-mode'] !== 'false',
      memory: { min: meta.minMemory ?? settings.memory.min, max: meta.maxMemory ?? settings.memory.max },
      memUsed: rt.mem,
      uptime: rt.startedAt && rt.proc ? Date.now() - rt.startedAt : 0,
      createdAt: meta.createdAt,
      lastStartedAt: meta.lastStartedAt || 0,
      iconVersion: iconV,
      diskBytes: cached ? cached.bytes : null,
      advanced: {
        jar: meta.jar || '',
        runCommand: meta.runCommand || '',
        javaPath: meta.javaPath || '',
        minMemory: meta.minMemory ?? null,
        maxMemory: meta.maxMemory ?? null,
        maxCpu: meta.maxCpu ?? 100,
        maxStorageMB: meta.maxStorageMB ?? 0,
        aikar: meta.aikar ?? null,
        extraJvmArgs: meta.extraJvmArgs || '',
        autoRestart: meta.autoRestart ?? null,
      },
    };
  }

  list() {
    return [...this.servers.values()].map((e) => {
      this.refreshDisk(e.meta.id);
      return this.view(e);
    });
  }

  get(id) { const e = this.must(id); this.refreshDisk(id, true); return this.view(e); }

  refreshDisk(id, force = false) {
    const e = this.servers.get(id);
    if (!e) return;
    const c = this.disk.get(id);
    if (!force && c && Date.now() - c.t < 60000) return;
    if (c && c.busy) return;
    this.disk.set(id, { t: Date.now(), bytes: c ? c.bytes : null, busy: true });
    U.dirSize(e.dir).then((bytes) => this.disk.set(id, { t: Date.now(), bytes, busy: false }));
  }

  /* ------------------------------------------------------------ logging */

  pushLog(entry, line, kind = 'out') {
    const rt = entry.rt;
    const item = { seq: ++rt.seq, t: Date.now(), line, kind };
    rt.log.push(item);
    if (rt.log.length > LOG_CAP) rt.log.splice(0, rt.log.length - LOG_CAP);
    this.emitEvent({ type: 'log', id: entry.meta.id, ...item });
  }

  getLog(id, after = 0) {
    const entry = this.must(id);
    const rt = entry.rt;
    if (!rt.logSeeded && rt.log.length === 0) {
      rt.logSeeded = true;
      for (const line of U.tailLines(path.join(entry.dir, 'logs', 'latest.log'), 250)) {
        rt.log.push({ seq: ++rt.seq, t: 0, line: U.stripAnsi(line), kind: 'old' });
      }
    }
    return { lines: rt.log.filter((l) => l.seq > after), last: rt.seq };
  }

  clearLog(id) { const e = this.must(id); e.rt.log = []; e.rt.logSeeded = true; }

  setState(entry, state, extra = {}) {
    const rt = entry.rt;
    rt.state = state;
    Object.assign(rt, extra);
    this.emitEvent({ type: 'state', id: entry.meta.id, server: this.view(entry) });
  }

  /* ------------------------------------------------------------ create / install */

  async findFreePort(start, exclude = new Set()) {
    for (const e of this.servers.values()) exclude.add(Number(this.propsOf(e)['server-port'] || 0));
    let port = start;
    for (let i = 0; i < 200; i++, port++) {
      if (port > 65535) break;
      if (exclude.has(port)) continue;
      if (await portFree(port)) return port;
    }
    return start;
  }

  validateName(name) {
    const n = String(name || '').trim();
    if (!n) throw new HttpError(400, 'Give your server a name');
    if (n.length > 40) throw new HttpError(400, 'Server names can be up to 40 characters');
    if (/[\u0000-\u001f]/.test(n)) throw new HttpError(400, 'That name has invalid characters');
    return n;
  }

  async create(o) {
    const settings = store.getSettings();
    const name = this.validateName(o.name);
    const type = String(o.type || settings.creation.defaultType);
    if (!providers.TYPES[type]) throw new HttpError(400, `Unknown server type "${type}"`);
    const version = String(o.version || '').trim();
    if (type !== 'custom' && !version) throw new HttpError(400, 'Choose a Minecraft version');
    if (type === 'custom' && !o.jarUrl && !o.jarPath && !o.runCommand) {
      throw new HttpError(400, 'For a custom server, give a jar URL, a local jar path, or a run command');
    }

    let parent = P.SERVERS_DIR;
    if (o.directory) {
      parent = path.resolve(String(o.directory));
      if (!path.isAbsolute(parent)) throw new HttpError(400, 'Choose an absolute folder path');
    }
    try { fs.mkdirSync(parent, { recursive: true }); } catch (e) { throw new HttpError(400, `Can't use that folder: ${e.message}`); }
    const dir = U.uniqueDir(parent, U.slugifyFolder(o.folderName || name));
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { throw new HttpError(400, `Can't create the server folder: ${e.message}`); }

    const mem = (k, d) => { const v = Number(o[k]); return Number.isFinite(v) && v >= 256 ? Math.round(v) : d; };
    const meta = {
      id: crypto.randomUUID(),
      name,
      type,
      version: type === 'custom' ? (version || 'custom') : version,
      build: '',
      jar: '',
      installed: false,
      minMemory: o.minMemory ? mem('minMemory', settings.memory.min) : null,
      maxMemory: o.maxMemory ? mem('maxMemory', settings.memory.max) : null,
      maxCpu: 100,
      maxStorageMB: 0,
      runCommand: o.runCommand ? String(o.runCommand) : '',
      createdAt: Date.now(),
      lastStartedAt: 0,
      firstRunDone: false,
      owner: (store.getAccount() || {}).username || '',
    };
    if (meta.minMemory && meta.maxMemory && meta.minMemory > meta.maxMemory) meta.minMemory = meta.maxMemory;
    U.writeJson(path.join(dir, META), meta);
    if (parent !== P.SERVERS_DIR) store.addRegistry(dir);

    const entry = this._register(dir, meta);
    entry.rt.state = 'installing';
    entry.rt.error = '';
    entry.rt.install = { phase: 'queued', message: 'Getting ready…', percent: 0 };
    this.emitEvent({ type: 'list' });

    const startPort = o.port ? Number(o.port) : settings.creation.startPort;
    entry.busy = true;
    this._install(entry, {
      fresh: true,
      description: o.description,
      properties: o.properties || {},
      icon: o.icon,
      port: Number.isInteger(startPort) ? startPort : settings.creation.startPort,
      jarUrl: o.jarUrl, jarPath: o.jarPath,
    }).catch(() => { /* reported through state */ });
    return this.view(entry);
  }

  progress(entry, phase, message, percent, extra = {}) {
    entry.rt.install = { phase, message, percent, ...extra };
    this.emitEvent({ type: 'install', id: entry.meta.id, ...entry.rt.install });
  }

  async _install(entry, opts) {
    const { meta, dir, rt } = entry;
    const settings = store.getSettings();
    try {
      let fileInfo = null;
      if (!opts.fresh) {
        this.progress(entry, 'clean', 'Cleaning up old files…', 2);
        for (const d of ['libraries', 'versions', 'cache', '.paper-remapped']) {
          fs.rmSync(path.join(dir, d), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        }
        if (meta.jar && !meta.runCommand) fs.rmSync(path.join(dir, meta.jar), { force: true });
        if (opts.wipeWorld) {
          const level = this.propsOf(entry)['level-name'] || 'world';
          for (const w of [level, `${level}_nether`, `${level}_the_end`]) {
            fs.rmSync(path.join(dir, w), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
          }
        }
        if (opts.type) meta.type = opts.type;
        if (opts.version) meta.version = opts.version;
      }

      if (meta.type === 'custom') {
        if (opts.jarUrl) {
          const name = path.basename(new URL(opts.jarUrl).pathname) || 'server.jar';
          const jar = /\.jar$/i.test(name) ? name : 'server.jar';
          this.progress(entry, 'download', `Downloading ${jar}…`, 5);
          await downloadFile(opts.jarUrl, path.join(dir, jar), {
            onProgress: (r, t) => this.progress(entry, 'download', `Downloading ${jar}…`, t ? 5 + (r / t) * 80 : 40, { received: r, total: t }),
          });
          meta.jar = jar;
        } else if (opts.jarPath) {
          const src = path.resolve(String(opts.jarPath));
          if (!fs.existsSync(src)) throw new Error(`Jar not found: ${src}`);
          meta.jar = path.basename(src);
          this.progress(entry, 'copy', 'Copying server jar…', 40);
          fs.copyFileSync(src, path.join(dir, meta.jar));
        }
      } else {
        this.progress(entry, 'resolve', `Finding ${providers.TYPES[meta.type].label} ${meta.version}…`, 3);
        fileInfo = await providers.resolve(meta.type, meta.version);
        this.progress(entry, 'download', `Downloading ${fileInfo.filename}…`, 6);
        await downloadFile(fileInfo.url, path.join(dir, fileInfo.filename), {
          hash: fileInfo.hash,
          onProgress: (r, t) => this.progress(entry, 'download', `Downloading ${fileInfo.filename}…`, t ? 6 + (r / t) * 72 : 40, { received: r, total: t }),
        });
        meta.jar = fileInfo.filename;
        meta.build = fileInfo.build || '';
        meta.channel = fileInfo.channel || '';
        meta.javaMajor = fileInfo.javaMajor || providers.guessJavaMajor(meta.version);
      }

      // Make sure a suitable Java exists now so the first start is instant.
      if (!meta.runCommand && settings.java.autoInstall) {
        const needed = meta.javaMajor || providers.guessJavaMajor(meta.version);
        const found = await javaMgr.resolveJava({ explicit: meta.javaPath || settings.java.path, needed });
        if (found.missing && !(meta.javaPath || settings.java.path)) {
          try {
            await javaMgr.installManaged(needed, (p) => {
              const pct = p.total ? 80 + (p.received / p.total) * 15 : 82;
              this.progress(entry, p.phase === 'extract' ? 'java' : 'java', p.message, pct, { received: p.received, total: p.total });
            });
          } catch (e) {
            this.pushLog(entry, `[Chestplate] Could not install Java ${needed} automatically: ${e.message}`, 'sys');
          }
        }
      }

      if (opts.fresh) {
        this.progress(entry, 'configure', 'Writing server settings…', 96);
        const p = this.buildInitialProperties(opts);
        props.write(dir, p);
        if (settings.creation.autoEula) fs.writeFileSync(path.join(dir, 'eula.txt'), eulaText(true));
        const iconPath = path.join(dir, 'server-icon.png');
        let icon = null;
        if (opts.icon) icon = this.decodePng(opts.icon);
        fs.writeFileSync(iconPath, icon || identicon(meta.name + meta.id));
      }

      meta.installed = true;
      this.saveMeta(entry);
      rt.error = '';
      rt.install = null;
      entry.busy = false;
      this.setState(entry, 'stopped');
      this.emitEvent({ type: 'list' });
      this.emitEvent({ type: 'installed', id: meta.id, name: meta.name });
    } catch (e) {
      entry.busy = false;
      rt.install = null;
      meta.installed = false;
      try { this.saveMeta(entry); } catch { /* folder may be gone */ }
      this.setState(entry, 'failed', { error: e.message || String(e) });
      this.emitEvent({ type: 'list' });
      throw e;
    }
  }

  buildInitialProperties(opts) {
    const settings = store.getSettings();
    const out = {};
    for (const [k, v] of Object.entries(settings.defaults)) out[k] = String(v);
    for (const [k, v] of Object.entries(opts.properties || {})) {
      if (/^[A-Za-z0-9_.\-]+$/.test(k)) out[k] = String(v);
    }
    out['server-port'] = String(opts.port || settings.creation.startPort);
    const desc = opts.description !== undefined ? opts.description : settings.creation.defaultDescription;
    out.motd = colorize(String(desc || '').slice(0, 200));
    return out;
  }

  decodePng(dataUrl) {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m) return null;
    const buf = Buffer.from(m[1], 'base64');
    // Minecraft ignores icons that aren't exactly 64x64 PNGs
    if (buf.length < 33 || buf.length > 512 * 1024 || buf.readUInt32BE(0) !== 0x89504e47) return null;
    if (buf.readUInt32BE(16) !== 64 || buf.readUInt32BE(20) !== 64) return null;
    return buf;
  }

  async reinstall(id, o = {}) {
    const entry = this.must(id);
    if (entry.rt.proc || !['stopped', 'crashed', 'failed'].includes(entry.rt.state)) {
      throw new HttpError(409, 'Stop the server before reinstalling it');
    }
    if (entry.meta.type === 'custom') throw new HttpError(400, 'Custom servers can\'t be reinstalled automatically. Replace the jar in the Files tab.');
    entry.busy = true;
    entry.rt.error = '';
    entry.rt.install = { phase: 'queued', message: 'Getting ready…', percent: 0 };
    entry.meta.installed = false;
    this.saveMeta(entry);
    this.setState(entry, 'installing');
    this._install(entry, { fresh: false, wipeWorld: !!o.wipeWorld, version: o.version, type: o.type }).catch(() => {});
    return this.view(entry);
  }

  /* ------------------------------------------------------------ java + command */

  async ensureJava(entry) {
    const { meta } = entry;
    const settings = store.getSettings();
    const needed = meta.javaMajor || providers.guessJavaMajor(meta.version);
    const explicit = meta.javaPath || settings.java.path;
    let found = await javaMgr.resolveJava({ explicit, needed });
    if (found.missing && !explicit && settings.java.autoInstall) {
      entry.rt.note = `Installing Java ${needed}…`;
      this.setState(entry, entry.rt.state, {});
      await javaMgr.installManaged(needed, (p) => {
        this.emitEvent({ type: 'install', id: meta.id, phase: p.phase, message: p.message, percent: p.total ? (p.received / p.total) * 100 : 0 });
      });
      entry.rt.note = '';
      found = await javaMgr.resolveJava({ explicit, needed });
    }
    if (found.missing) {
      const err = new HttpError(400, `${found.reason}. Turn on automatic Java install in Settings, or set a Java path.`, 'JAVA_MISSING');
      throw err;
    }
    return found;
  }

  buildCommand(entry, javaPath) {
    const s = store.getSettings();
    const m = entry.meta;
    const min = m.minMemory ?? s.memory.min;
    const max = Math.max(m.maxMemory ?? s.memory.max, min);
    if (m.runCommand && m.runCommand.trim()) {
      const tokens = U.splitCommand(m.runCommand).map((t) => t
        .replace(/\{min\}/g, min).replace(/\{max\}/g, max)
        .replace(/\{jar\}/g, m.jar || '').replace(/\{java\}/g, javaPath || 'java'));
      let file = tokens.shift();
      if (!file) throw new HttpError(400, 'The custom run command is empty');
      if (/^java(\.exe)?$/i.test(file) && javaPath) file = javaPath;
      if (WIN && /\.(bat|cmd)$/i.test(file)) return { file: 'cmd.exe', args: ['/c', file, ...tokens] };
      return { file, args: tokens };
    }
    const args = [`-Xms${min}M`, `-Xmx${max}M`, '-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8'];
    const cap = Number(m.maxCpu ?? 100);
    if (cap > 0 && cap < 100) args.push(`-XX:ActiveProcessorCount=${Math.max(1, Math.round((os.cpus().length * cap) / 100))}`);
    if (m.aikar ?? s.runtime.aikarFlags) args.push(...AIKAR);
    if (m.extraJvmArgs) args.push(...U.splitCommand(m.extraJvmArgs));
    args.push('-jar', m.jar, 'nogui');
    return { file: javaPath, args };
  }

  /* ------------------------------------------------------------ lifecycle */

  async start(id) {
    const entry = this.must(id);
    const { meta, rt } = entry;
    if (!['stopped', 'crashed'].includes(rt.state)) throw new HttpError(409, `The server is ${rt.state}`);
    rt.error = ''; rt.cancelStart = false; rt.needsEula = false; rt.expectedStop = false;
    this.setState(entry, 'starting');
    try {
      if (!meta.runCommand && (!meta.jar || !fs.existsSync(path.join(entry.dir, meta.jar)))) {
        throw new HttpError(400, `Server jar "${meta.jar || '(none)'}" was not found. Pick another jar in Advanced settings, or Reinstall.`);
      }
      if (meta.maxStorageMB > 0) {
        const bytes = await U.dirSize(entry.dir);
        if (bytes > meta.maxStorageMB * 1048576) {
          throw new HttpError(400, `Storage limit reached (${(bytes / 1048576).toFixed(0)} MB of ${meta.maxStorageMB} MB). Raise the limit in Advanced settings.`);
        }
      }
      const java = meta.runCommand && !/^java/i.test(meta.runCommand.trim()) ? { path: null } : await this.ensureJava(entry);
      if (rt.cancelStart) { rt.cancelStart = false; rt.note = ''; this.setState(entry, 'stopped'); return this.view(entry); }
      const { file, args } = this.buildCommand(entry, java.path);

      rt.log = []; rt.logSeeded = true;
      this.pushLog(entry, `[Chestplate] Starting ${meta.name} (${meta.type} ${meta.version})`, 'sys');
      this.pushLog(entry, `[Chestplate] > ${path.basename(file)} ${args.join(' ')}`, 'sys');

      const proc = spawn(file, args, { cwd: entry.dir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      rt.proc = proc;
      rt.startedAt = Date.now();
      rt.buf = { out: '', err: '' };
      meta.lastStartedAt = Date.now();
      this.saveMeta(entry);

      proc.stdin.on('error', () => {});
      proc.stdout.on('data', (d) => this._chunk(entry, 'out', d));
      proc.stderr.on('data', (d) => this._chunk(entry, 'err', d));
      proc.on('error', (err) => {
        this.pushLog(entry, `[Chestplate] Could not launch the server: ${err.message}`, 'sys');
        rt.proc = null;
        this.setState(entry, 'crashed', { error: err.message });
      });
      proc.on('exit', (code, signal) => this._onExit(entry, code, signal));
      this.setState(entry, 'starting', { note: '' });
    } catch (e) {
      rt.note = '';
      this.pushLog(entry, `[Chestplate] ${e.message}`, 'sys');
      this.setState(entry, 'stopped', { error: e.message });
      throw e;
    }
    return this.view(entry);
  }

  _chunk(entry, kind, data) {
    const rt = entry.rt;
    rt.buf[kind] += data.toString('utf8');
    const parts = rt.buf[kind].split(/\r?\n/);
    rt.buf[kind] = parts.pop();
    for (const l of parts) this._line(entry, kind, U.stripAnsi(l));
  }

  _line(entry, kind, line) {
    const rt = entry.rt;
    this.pushLog(entry, line, kind);
    if (rt.state === 'starting' && DONE_RE.test(line)) {
      this.setState(entry, 'running');
      if (!entry.meta.firstRunDone) this._firstStart(entry);
      return;
    }
    let m;
    if ((m = JOIN_RE.exec(line))) { rt.players.add(m[1]); this.emitEvent({ type: 'players', id: entry.meta.id, players: [...rt.players] }); }
    else if ((m = LEAVE_RE.exec(line))) { rt.players.delete(m[1]); this.emitEvent({ type: 'players', id: entry.meta.id, players: [...rt.players] }); }
    else if (EULA_RE.test(line) && !rt.needsEula) {
      rt.needsEula = true;
      this.emitEvent({ type: 'eula', id: entry.meta.id, name: entry.meta.name });
    }
  }

  _firstStart(entry) {
    const f = store.getSettings().firstStart;
    if (f.popupOp || f.popupWhitelist || f.popupEnableWhitelist) {
      this.emitEvent({
        type: 'firstStart', id: entry.meta.id, name: entry.meta.name,
        options: { op: f.popupOp, whitelist: f.popupWhitelist, enableWhitelist: f.popupEnableWhitelist },
      });
    } else {
      entry.meta.firstRunDone = true;
      this.saveMeta(entry);
    }
  }

  _onExit(entry, code, signal) {
    const { rt, meta } = entry;
    for (const k of ['out', 'err']) if (rt.buf[k]) { this._line(entry, k, U.stripAnsi(rt.buf[k])); rt.buf[k] = ''; }
    clearTimeout(rt.stopTimer);
    rt.proc = null; rt.mem = 0; rt.startedAt = 0; rt.players.clear();
    const clean = rt.expectedStop || code === 0 || rt.needsEula;
    this.pushLog(entry, `[Chestplate] Server process ended (${signal ? `signal ${signal}` : `exit code ${code}`}).`, 'sys');
    this.setState(entry, clean ? 'stopped' : 'crashed', { error: '' });
    this.emitEvent({ type: 'players', id: meta.id, players: [] });
    const restart = rt.restartAfterStop;
    rt.restartAfterStop = false; rt.expectedStop = false;
    if (restart) { setTimeout(() => this.start(meta.id).catch(() => {}), 900); return; }
    const auto = meta.autoRestart ?? store.getSettings().runtime.autoRestart;
    if (!clean && auto) {
      const now = Date.now();
      rt.crashTimes = rt.crashTimes.filter((t) => now - t < 600000);
      rt.crashTimes.push(now);
      if (rt.crashTimes.length <= 3) {
        this.pushLog(entry, '[Chestplate] The server crashed — restarting in 5 seconds…', 'sys');
        setTimeout(() => { if (rt.state === 'crashed') this.start(meta.id).catch(() => {}); }, 5000);
      } else this.pushLog(entry, '[Chestplate] Crashed 3 times in 10 minutes — auto-restart paused.', 'sys');
    }
    this.emitEvent({ type: 'list' });
  }

  write(entry, text) {
    const p = entry.rt.proc;
    if (!p || !p.stdin || p.stdin.destroyed) throw new HttpError(409, 'The server is not running');
    p.stdin.write(text + '\n');
  }

  command(id, cmd) {
    const entry = this.must(id);
    const c = String(cmd || '').replace(/[\r\n]+/g, ' ').trim();
    if (!c) throw new HttpError(400, 'Type a command first');
    if (!entry.rt.proc || !['starting', 'running', 'stopping'].includes(entry.rt.state)) {
      throw new HttpError(409, 'Start the server to send commands');
    }
    this.pushLog(entry, `> ${c}`, 'in');
    this.write(entry, c.replace(/^\//, ''));
  }

  stop(id) {
    const entry = this.must(id);
    const { rt } = entry;
    if (rt.state === 'starting' && !rt.proc) { rt.cancelStart = true; return this.view(entry); }
    if (!rt.proc) return this.view(entry);
    if (rt.state === 'stopping') return this.view(entry);
    rt.expectedStop = true;
    this.setState(entry, 'stopping');
    this.pushLog(entry, '[Chestplate] Stopping server…', 'sys');
    try { this.write(entry, 'stop'); } catch { this.kill(id); }
    clearTimeout(rt.stopTimer);
    rt.stopTimer = setTimeout(() => {
      if (rt.proc) { this.pushLog(entry, '[Chestplate] The server did not stop in time — forcing it.', 'sys'); this.kill(id); }
    }, store.getSettings().console.stopTimeout * 1000);
    return this.view(entry);
  }

  kill(id) {
    const entry = this.must(id);
    const proc = entry.rt.proc;
    if (!proc) return this.view(entry);
    entry.rt.expectedStop = true;
    if (WIN) execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => {});
    else { try { proc.kill('SIGKILL'); } catch { /* gone */ } }
    return this.view(entry);
  }

  restart(id) {
    const entry = this.must(id);
    const { rt } = entry;
    if (rt.proc && ['running', 'starting'].includes(rt.state)) {
      rt.restartAfterStop = true;
      this.stop(id);
      return this.view(entry);
    }
    if (['stopped', 'crashed'].includes(rt.state)) { this.start(id).catch(() => {}); }
    return this.view(entry);
  }

  runningCount() { let n = 0; for (const e of this.servers.values()) if (e.rt.proc) n++; return n; }

  async stopAll(timeoutMs = 30000) {
    const running = [...this.servers.values()].filter((e) => e.rt.proc);
    running.forEach((e) => this.stop(e.meta.id));
    const t0 = Date.now();
    while (running.some((e) => e.rt.proc) && Date.now() - t0 < timeoutMs) await new Promise((r) => setTimeout(r, 300));
    running.filter((e) => e.rt.proc).forEach((e) => this.kill(e.meta.id));
  }

  /* ------------------------------------------------------------ live stats */

  _pollStats() {
    for (const entry of this.servers.values()) {
      const rt = entry.rt;
      if (!rt.proc) continue;
      this._memory(rt.proc.pid, (bytes) => {
        rt.mem = bytes;
        this.emitEvent({
          type: 'stats', id: entry.meta.id, memUsed: bytes,
          uptime: rt.startedAt ? Date.now() - rt.startedAt : 0, players: [...rt.players],
        });
      });
      // enforce the storage quota gently: warn once
      const lim = entry.meta.maxStorageMB;
      if (lim > 0 && !rt.quotaWarned) {
        U.dirSize(entry.dir).then((b) => {
          if (b > lim * 1048576 && !rt.quotaWarned) {
            rt.quotaWarned = true;
            this.pushLog(entry, `[Chestplate] Storage limit of ${lim} MB exceeded (${(b / 1048576).toFixed(0)} MB). The server won't start again until you free space or raise the limit.`, 'sys');
          }
        });
      }
    }
  }

  _memory(pid, cb) {
    if (process.platform === 'linux') {
      try {
        const m = /VmRSS:\s+(\d+) kB/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'));
        if (m) cb(Number(m[1]) * 1024);
      } catch { /* exited */ }
    } else if (WIN) {
      execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (err, out) => {
        if (err) return;
        const cols = out.trim().split('","');
        const kb = Number((cols[4] || '').replace(/[^0-9]/g, ''));
        if (kb) cb(kb * 1024);
      });
    } else {
      execFile('ps', ['-o', 'rss=', '-p', String(pid)], (err, out) => { if (!err && Number(out)) cb(Number(out) * 1024); });
    }
  }

  /* ------------------------------------------------------------ editing */

  patch(id, body) {
    const entry = this.must(id);
    const { meta } = entry;
    const num = (v, lo, hi, what) => {
      if (v === '' || v === null || v === undefined) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < lo || n > hi) throw new HttpError(400, `${what} must be between ${lo} and ${hi}`);
      return Math.round(n);
    };
    if (body.name !== undefined) meta.name = this.validateName(body.name);
    if (body.description !== undefined) {
      props.write(entry.dir, { motd: colorize(String(body.description).slice(0, 200)) });
    }
    const adv = body.advanced || {};
    if (adv.jar !== undefined) {
      const jar = String(adv.jar).trim();
      if (jar && (/[\\/]/.test(jar) || !/\.jar$/i.test(jar))) throw new HttpError(400, 'The jar must be a file name ending in .jar inside the server folder');
      meta.jar = jar;
    }
    if (adv.runCommand !== undefined) meta.runCommand = String(adv.runCommand).slice(0, 1000);
    if (adv.javaPath !== undefined) meta.javaPath = String(adv.javaPath).trim();
    if (adv.minMemory !== undefined) meta.minMemory = num(adv.minMemory, 256, 262144, 'Minimum memory');
    if (adv.maxMemory !== undefined) meta.maxMemory = num(adv.maxMemory, 256, 262144, 'Maximum memory');
    const s = store.getSettings();
    if ((meta.minMemory ?? s.memory.min) > (meta.maxMemory ?? s.memory.max)) {
      throw new HttpError(400, 'Minimum memory can\'t be higher than maximum memory');
    }
    if (adv.maxCpu !== undefined) meta.maxCpu = num(adv.maxCpu, 5, 100, 'CPU limit') ?? 100;
    if (adv.maxStorageMB !== undefined) { meta.maxStorageMB = num(adv.maxStorageMB, 0, 100000000, 'Storage limit') ?? 0; entry.rt.quotaWarned = false; }
    if (adv.aikar !== undefined) meta.aikar = adv.aikar === null ? null : !!adv.aikar;
    if (adv.extraJvmArgs !== undefined) meta.extraJvmArgs = String(adv.extraJvmArgs).slice(0, 500);
    if (adv.autoRestart !== undefined) meta.autoRestart = adv.autoRestart === null ? null : !!adv.autoRestart;
    this.saveMeta(entry);
    this.emitEvent({ type: 'state', id, server: this.view(entry) });
    return this.view(entry);
  }

  renameFolder(id, newName) {
    const entry = this.must(id);
    if (entry.rt.proc || entry.rt.state === 'installing') throw new HttpError(409, 'Stop the server before renaming its folder');
    if (!U.validFolderName(newName)) throw new HttpError(400, 'That isn\'t a valid folder name');
    const target = path.join(path.dirname(entry.dir), newName);
    if (target === entry.dir) return this.view(entry);
    if (fs.existsSync(target)) throw new HttpError(409, 'A folder with that name already exists');
    try { fs.renameSync(entry.dir, target); } catch (e) {
      throw new HttpError(409, `Couldn't rename the folder (${e.code || e.message}). Close anything using it, such as File Explorer.`);
    }
    store.replaceRegistry(entry.dir, target);
    entry.dir = target;
    this.emitEvent({ type: 'list' });
    return this.view(entry);
  }

  getProperties(id) {
    const entry = this.must(id);
    return { values: this.propsOf(entry), exists: fs.existsSync(path.join(entry.dir, 'server.properties')) };
  }

  setProperties(id, changes) {
    const entry = this.must(id);
    const clean = {};
    for (const [k, v] of Object.entries(changes || {})) {
      if (!/^[A-Za-z0-9_.\-]{1,64}$/.test(k)) throw new HttpError(400, `Invalid property name "${k}"`);
      clean[k] = String(v === null ? '' : v).replace(/\r/g, '');
    }
    if (clean['server-port'] !== undefined) {
      const n = Number(clean['server-port']);
      if (!Number.isInteger(n) || n < 1 || n > 65535) throw new HttpError(400, 'Port must be between 1 and 65535');
    }
    props.write(entry.dir, clean);
    this.emitEvent({ type: 'state', id, server: this.view(entry) });
    return this.getProperties(id);
  }

  removeProperty(id, key) {
    const entry = this.must(id);
    const file = path.join(entry.dir, 'server.properties');
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const kept = lines.filter((l) => !(l.trim() && l.trim()[0] !== '#' && l.split(/[=:]/)[0].trim() === key));
    fs.writeFileSync(file, kept.join('\n'));
    return this.getProperties(id);
  }

  /* ------------------------------------------------------------ icon */

  iconPath(id) { return path.join(this.must(id).dir, 'server-icon.png'); }

  setIcon(id, dataUrl) {
    const entry = this.must(id);
    const png = this.decodePng(dataUrl);
    if (!png) throw new HttpError(400, 'Icon must be a PNG image');
    fs.writeFileSync(path.join(entry.dir, 'server-icon.png'), png);
    this.emitEvent({ type: 'state', id, server: this.view(entry) });
    return this.view(entry);
  }

  resetIcon(id) {
    const entry = this.must(id);
    fs.writeFileSync(path.join(entry.dir, 'server-icon.png'), identicon(entry.meta.name + entry.meta.id));
    this.emitEvent({ type: 'state', id, server: this.view(entry) });
    return this.view(entry);
  }

  /* ------------------------------------------------------------ copy + delete */

  async copy(id, name) {
    const src = this.must(id);
    if (src.rt.proc || src.rt.state === 'installing') throw new HttpError(409, 'Stop the server before copying it');
    const newName = this.validateName(name || `${src.meta.name} (copy)`);
    const parent = path.dirname(src.dir);
    const dir = U.uniqueDir(parent, U.slugifyFolder(newName));
    const meta = {
      ...src.meta, id: crypto.randomUUID(), name: newName, createdAt: Date.now(), lastStartedAt: 0, installed: false,
    };
    fs.mkdirSync(dir, { recursive: true });
    U.writeJson(path.join(dir, META), meta);
    if (parent !== P.SERVERS_DIR) store.addRegistry(dir);
    const entry = this._register(dir, meta);
    entry.busy = true;
    entry.rt.state = 'installing';
    entry.rt.install = { phase: 'copy', message: 'Copying files…', percent: 30 };
    this.emitEvent({ type: 'list' });
    (async () => {
      try {
        await fs.promises.cp(src.dir, dir, { recursive: true, filter: (p) => path.basename(p) !== META && path.basename(p) !== 'session.lock' });
        const port = await this.findFreePort(Number(this.propsOf(src)['server-port'] || 25565) + 1);
        props.write(dir, { 'server-port': String(port) });
        meta.installed = true;
        U.writeJson(path.join(dir, META), meta);
        entry.rt.install = null; entry.busy = false;
        this.setState(entry, 'stopped');
        this.emitEvent({ type: 'list' });
        this.emitEvent({ type: 'installed', id: meta.id, name: meta.name });
      } catch (e) {
        entry.busy = false; entry.rt.install = null;
        this.setState(entry, 'failed', { error: `Copy failed: ${e.message}` });
        this.emitEvent({ type: 'list' });
      }
    })();
    return this.view(entry);
  }

  async remove(id, { deleteFiles = true } = {}) {
    const entry = this.must(id);
    if (entry.rt.proc) {
      this.stop(id);
      const t0 = Date.now();
      while (entry.rt.proc && Date.now() - t0 < 25000) await new Promise((r) => setTimeout(r, 250));
      if (entry.rt.proc) { this.kill(id); await new Promise((r) => setTimeout(r, 1000)); }
    }
    if (entry.busy) throw new HttpError(409, 'Wait for the current install or copy to finish');
    try {
      if (deleteFiles) fs.rmSync(entry.dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
      else fs.rmSync(path.join(entry.dir, META), { force: true });
    } catch (e) {
      throw new HttpError(409, `Couldn't delete the server folder (${e.code || e.message}). Close anything using it and try again.`);
    }
    store.removeRegistry(entry.dir);
    fs.rmSync(path.join(P.BACKUPS_DIR, id), { recursive: true, force: true });
    this.servers.delete(id);
    this.disk.delete(id);
    this.emitEvent({ type: 'removed', id });
    this.emitEvent({ type: 'list' });
    return { ok: true };
  }

  /* ------------------------------------------------------------ shortcuts, first run, eula */

  readJsonList(entry, name) {
    const v = U.readJson(path.join(entry.dir, name), []);
    return Array.isArray(v) ? v : [];
  }

  shortcutState(id) {
    const entry = this.must(id);
    const player = ((store.getAccount() || {}).username || '').toLowerCase();
    const ops = this.readJsonList(entry, 'ops.json').some((o) => String(o.name).toLowerCase() === player);
    const wl = this.readJsonList(entry, 'whitelist.json').some((o) => String(o.name).toLowerCase() === player);
    const wlOn = this.propsOf(entry)['white-list'] === 'true';
    return { op: ops, whitelist: wl, whitelistEnabled: wlOn };
  }

  firstRun(id, { op, whitelist, enableWhitelist }) {
    const entry = this.must(id);
    const player = (store.getAccount() || {}).username;
    if (entry.rt.proc && player) {
      if (whitelist) this.command(id, `whitelist add ${player}`);
      if (op) this.command(id, `op ${player}`);
      if (enableWhitelist) this.command(id, 'whitelist on');
    }
    entry.meta.firstRunDone = true;
    this.saveMeta(entry);
    return { ok: true };
  }

  dismissFirstRun(id) {
    const entry = this.must(id);
    entry.meta.firstRunDone = true;
    this.saveMeta(entry);
    return { ok: true };
  }

  acceptEula(id) {
    const entry = this.must(id);
    fs.writeFileSync(path.join(entry.dir, 'eula.txt'), eulaText(true));
    entry.rt.needsEula = false;
    this.setState(entry, entry.rt.state);
    return this.view(entry);
  }

  /* ------------------------------------------------------------ players */

  players(id) {
    const entry = this.must(id);
    const pick = (name) => this.readJsonList(entry, name).map((o) => ({ name: o.name, uuid: o.uuid, level: o.level, reason: o.reason, created: o.created }));
    return {
      online: [...entry.rt.players],
      ops: pick('ops.json'),
      whitelist: pick('whitelist.json'),
      banned: pick('banned-players.json'),
      running: !!entry.rt.proc,
    };
  }

  /* ------------------------------------------------------------ files */

  safePath(id, rel = '') {
    const entry = this.must(id);
    const root = path.resolve(entry.dir);
    const target = path.resolve(root, String(rel || '').replace(/^[/\\]+/, ''));
    if (target !== root && !target.startsWith(root + path.sep)) throw new HttpError(400, 'That path is outside the server folder');
    return { root, target };
  }

  listFiles(id, rel = '') {
    const { root, target } = this.safePath(id, rel);
    let items;
    try { items = fs.readdirSync(target, { withFileTypes: true }); } catch { throw new HttpError(404, 'Folder not found'); }
    const entries = items.filter((d) => d.name !== META).map((d) => {
      let size = 0, mtime = 0;
      try { const st = fs.statSync(path.join(target, d.name)); size = st.size; mtime = st.mtimeMs; } catch { /* broken link */ }
      return { name: d.name, dir: d.isDirectory(), size: d.isDirectory() ? null : size, mtime };
    }).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return { path: path.relative(root, target).split(path.sep).join('/'), entries };
  }

  readFile(id, rel) {
    const { target } = this.safePath(id, rel);
    let st;
    try { st = fs.statSync(target); } catch { throw new HttpError(404, 'File not found'); }
    if (!st.isFile()) throw new HttpError(400, 'Not a file');
    if (st.size > 1048576) throw new HttpError(413, 'That file is too large to open here (1 MB limit). Open the folder instead.');
    const buf = fs.readFileSync(target);
    if (buf.includes(0)) throw new HttpError(415, 'That looks like a binary file, so it can\'t be shown as text.');
    return { content: buf.toString('utf8'), size: st.size };
  }

  writeFile(id, rel, content) {
    const { target } = this.safePath(id, rel);
    if (path.basename(target) === META) throw new HttpError(403, 'That file is managed by Chestplate');
    if (typeof content !== 'string' || Buffer.byteLength(content) > 1048576) throw new HttpError(413, 'Too large to save (1 MB limit)');
    if (!fs.existsSync(target)) throw new HttpError(404, 'File not found');
    fs.writeFileSync(target, content);
    return { ok: true };
  }

  openFolder(id) {
    const entry = this.must(id);
    const dir = entry.dir;
    let cmd, args;
    if (WIN) { cmd = 'explorer.exe'; args = [dir]; }
    else if (process.platform === 'darwin') { cmd = 'open'; args = [dir]; }
    else { cmd = 'xdg-open'; args = [dir]; }
    try {
      const p = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false });
      p.on('error', () => {});
      p.unref();
    } catch (e) { throw new HttpError(500, `Couldn't open the folder: ${e.message}`); }
    return { ok: true, dir };
  }

  /* ------------------------------------------------------------ backups */

  backupDir(id) { this.must(id); return path.join(P.BACKUPS_DIR, id); }

  listBackups(id) {
    const dir = this.backupDir(id);
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.tar.gz')); } catch { /* none yet */ }
    return files.map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, size: st.size, created: st.mtimeMs, scope: /_full\.tar\.gz$/.test(f) ? 'full' : 'worlds' };
    }).sort((a, b) => b.created - a.created);
  }

  _tar(args, cwd) {
    return new Promise((resolve, reject) => {
      const p = spawn('tar', args, { cwd, windowsHide: true });
      let err = '';
      p.stderr.on('data', (d) => { err += d; });
      p.on('error', (e) => reject(new Error(`tar is not available: ${e.message}`)));
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `tar exited with ${code}`))));
    });
  }

  async createBackup(id, scope = 'worlds') {
    const entry = this.must(id);
    if (entry.busy) throw new HttpError(409, 'Wait for the current task to finish');
    const level = this.propsOf(entry)['level-name'] || 'world';
    const outDir = this.backupDir(id);
    fs.mkdirSync(outDir, { recursive: true });
    // millisecond precision: the safety backup made before a restore must never share a name with the backup being restored
    const stamp = new Date().toISOString().replace(/[:T.]/g, '-').slice(0, 23);
    const name = `${stamp}_${scope === 'full' ? 'full' : 'worlds'}.tar.gz`;
    const out = path.join(outDir, name);
    const running = !!entry.rt.proc && entry.rt.state === 'running';
    entry.busy = true;
    try {
      if (running) {
        this.command(id, 'save-off');
        this.command(id, 'save-all flush');
        await new Promise((r) => setTimeout(r, 3000));
      }
      let args;
      if (scope === 'full') {
        args = ['-czf', out, '--exclude=./logs', '--exclude=./cache', '--exclude=./libraries', '--exclude=./versions', '--exclude=./*.jar', '--exclude=./.chestplate.json', '.'];
      } else {
        const dirs = [level, `${level}_nether`, `${level}_the_end`].filter((d) => fs.existsSync(path.join(entry.dir, d)));
        if (!dirs.length) throw new HttpError(400, 'There is no world to back up yet. Start the server once first.');
        args = ['-czf', out, ...dirs];
      }
      await this._tar(args, entry.dir);
    } catch (e) {
      fs.rmSync(out, { force: true });
      throw e instanceof HttpError ? e : new HttpError(500, `Backup failed: ${e.message}`);
    } finally {
      entry.busy = false;
      if (running && entry.rt.proc) { try { this.command(id, 'save-on'); } catch { /* stopped meanwhile */ } }
    }
    const st = fs.statSync(out);
    return { name, size: st.size, created: st.mtimeMs, scope: scope === 'full' ? 'full' : 'worlds' };
  }

  backupFile(id, name) {
    if (!/^[0-9A-Za-z\-_]+\.tar\.gz$/.test(name)) throw new HttpError(400, 'Invalid backup name');
    const f = path.join(this.backupDir(id), name);
    if (!fs.existsSync(f)) throw new HttpError(404, 'Backup not found');
    return f;
  }

  deleteBackup(id, name) { fs.rmSync(this.backupFile(id, name)); return { ok: true }; }

  async restoreBackup(id, name) {
    const entry = this.must(id);
    if (entry.rt.proc || entry.busy) throw new HttpError(409, 'Stop the server before restoring a backup');
    const file = this.backupFile(id, name);
    await this.createBackup(id, 'worlds').catch(() => {}); // safety net of the current world
    const level = this.propsOf(entry)['level-name'] || 'world';
    entry.busy = true;
    try {
      for (const w of [level, `${level}_nether`, `${level}_the_end`]) {
        fs.rmSync(path.join(entry.dir, w), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
      await this._tar(['-xzf', file], entry.dir);
    } catch (e) { throw new HttpError(500, `Restore failed: ${e.message}`); } finally { entry.busy = false; }
    return { ok: true };
  }
}

module.exports = new ServerManager();
module.exports.ServerManager = ServerManager;
module.exports.AIKAR = AIKAR;
