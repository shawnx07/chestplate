'use strict';
/** Finding Java, and installing a private copy (Eclipse Temurin) when the PC doesn't have the right one. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const P = require('./paths');
const { downloadFile } = require('./download');

const WIN = process.platform === 'win32';
const EXE = WIN ? 'java.exe' : 'java';
const probeCache = new Map();

function probe(javaPath) {
  if (probeCache.has(javaPath)) return probeCache.get(javaPath);
  const p = new Promise((resolve) => {
    execFile(javaPath, ['-version'], { timeout: 8000, windowsHide: true }, (err, stdout, stderr) => {
      if (err && !stderr) return resolve(null);
      const text = `${stderr}\n${stdout}`;
      const m = /version "(\d+)(?:\.(\d+))?[^"]*"/.exec(text);
      if (!m) return resolve(null);
      const major = m[1] === '1' ? Number(m[2]) : Number(m[1]);
      const vendor = /(Temurin|OpenJDK|Zulu|GraalVM|Corretto|Oracle|Microsoft|Semeru|Liberica)/i.exec(text);
      resolve({ path: javaPath, major, version: m[0].replace(/^version /, '').replace(/"/g, ''), vendor: vendor ? vendor[1] : 'Java' });
    });
  });
  probeCache.set(javaPath, p);
  return p;
}

function managedHomes() {
  try {
    return fs.readdirSync(P.RUNTIMES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^java-\d+$/.test(d.name))
      .map((d) => ({ major: Number(d.name.slice(5)), dir: path.join(P.RUNTIMES_DIR, d.name) }));
  } catch { return []; }
}

function javaInHome(dir) {
  const direct = path.join(dir, 'bin', EXE);
  if (fs.existsSync(direct)) return direct;
  try { // some archives wrap everything in one folder
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      for (const sub of [path.join(dir, e.name, 'bin', EXE), path.join(dir, e.name, 'Contents', 'Home', 'bin', EXE)]) {
        if (fs.existsSync(sub)) return sub;
      }
    }
  } catch { /* ignore */ }
  return null;
}

/** Everything we can find: private runtimes first, then whatever "java" is on PATH / JAVA_HOME. */
async function listInstalled() {
  const found = [];
  for (const h of managedHomes()) {
    const bin = javaInHome(h.dir);
    if (!bin) continue;
    const info = await probe(bin);
    if (info) found.push({ ...info, managed: true });
  }
  const candidates = [];
  if (process.env.JAVA_HOME) candidates.push(path.join(process.env.JAVA_HOME, 'bin', EXE));
  candidates.push('java');
  for (const c of candidates) {
    const info = await probe(c);
    if (info && !found.some((f) => f.path === info.path)) found.push({ ...info, managed: false });
  }
  return found;
}

/**
 * Pick the Java for a server. Returns { path } or { missing: true, needed }.
 * Explicit overrides win; otherwise the smallest installed version that is >= what the server needs.
 */
async function resolveJava({ explicit, needed }) {
  if (explicit) {
    const info = await probe(explicit);
    return info ? { path: explicit, major: info.major } : { missing: true, needed, reason: `Java at "${explicit}" could not be started` };
  }
  const installed = await listInstalled();
  const ok = installed.filter((j) => j.major >= needed).sort((a, b) => (a.major - b.major) || (b.managed - a.managed));
  if (ok.length) return { path: ok[0].path, major: ok[0].major };
  return { missing: true, needed, reason: `Java ${needed} or newer is required` };
}

function adoptiumUrl(major) {
  const os_ = WIN ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  const arch = os.arch() === 'arm64' ? 'aarch64' : 'x64';
  return `https://api.adoptium.net/v3/binary/latest/${major}/ga/${os_}/${arch}/jre/hotspot/normal/eclipse`;
}

function extract(archive, destDir) {
  return new Promise((resolve, reject) => {
    // bsdtar ships with Windows 10+ and handles .zip; GNU tar handles .tar.gz
    const p = spawn('tar', ['-xf', archive, '-C', destDir], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Could not extract Java: ${err.trim() || `exit ${code}`}`))));
  });
}

const installing = new Map();

/** Download + unpack a private JRE into <home>/runtimes/java-<major>. */
function installManaged(major, onProgress = () => {}) {
  if (installing.has(major)) return installing.get(major);
  const job = (async () => {
    const final = path.join(P.RUNTIMES_DIR, `java-${major}`);
    const existing = fs.existsSync(final) && javaInHome(final);
    if (existing) return existing;
    fs.mkdirSync(P.RUNTIMES_DIR, { recursive: true });
    const tmpDir = path.join(P.RUNTIMES_DIR, `.tmp-java-${major}-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const archive = path.join(tmpDir, WIN ? 'jre.zip' : 'jre.tar.gz');
    try {
      onProgress({ phase: 'download', message: `Downloading Java ${major}…`, received: 0, total: 0 });
      await downloadFile(adoptiumUrl(major), archive, {
        onProgress: (received, total) => onProgress({ phase: 'download', message: `Downloading Java ${major}…`, received, total }),
      });
      onProgress({ phase: 'extract', message: `Unpacking Java ${major}…` });
      const unpack = path.join(tmpDir, 'unpacked');
      fs.mkdirSync(unpack);
      await extract(archive, unpack);
      fs.rmSync(final, { recursive: true, force: true });
      fs.renameSync(unpack, final);
      const bin = javaInHome(final);
      if (!bin) throw new Error('Java was unpacked but no java executable was found');
      probeCache.clear();
      return bin;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })().finally(() => installing.delete(major));
  installing.set(major, job);
  return job;
}

module.exports = { listInstalled, resolveJava, installManaged, probe };
