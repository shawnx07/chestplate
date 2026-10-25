'use strict';
/** Where server jars come from: Paper, Purpur, Vanilla (Mojang) and Fabric. */
const UA = 'Chestplate/1.0 (local Minecraft server manager)';
const TTL = 10 * 60 * 1000;
const cache = new Map();

async function getJson(url, timeout = 15000) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctl.signal });
    if (!res.ok) throw new Error(`${new URL(url).host} answered HTTP ${res.status}`);
    const v = await res.json();
    cache.set(url, { t: Date.now(), v });
    return v;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Timed out reaching ${new URL(url).host}`);
    if (e.cause && e.cause.code) throw new Error(`Could not reach ${new URL(url).host} (${e.cause.code}). Check your internet connection.`);
    throw e;
  } finally { clearTimeout(timer); }
}

/** Compare Minecraft version strings like 1.21.4, 26.2, 1.21-rc1. */
function compareVersions(a, b) {
  const pa = /^(\d+(?:\.\d+)*)(?:[-+ ](.*))?$/.exec(a);
  const pb = /^(\d+(?:\.\d+)*)(?:[-+ ](.*))?$/.exec(b);
  if (!pa || !pb) return String(a).localeCompare(String(b));
  const na = pa[1].split('.').map(Number);
  const nb = pb[1].split('.').map(Number);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (na[i] || 0) - (nb[i] || 0);
    if (d) return d;
  }
  if (!pa[2] && pb[2]) return 1;
  if (pa[2] && !pb[2]) return -1;
  return String(pa[2] || '').localeCompare(String(pb[2] || ''), undefined, { numeric: true });
}

const isRelease = (v) => /^\d+(\.\d+)+$/.test(v);

/* ------------------------------------------------------------------ Mojang */

const MOJANG_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

async function mojangEntry(version) {
  const m = await getJson(MOJANG_MANIFEST);
  return m.versions.find((v) => v.id === version) || null;
}

async function mojangJavaMajor(version) {
  try {
    const entry = await mojangEntry(version);
    if (!entry) return null;
    const j = await getJson(entry.url);
    return j.javaVersion && j.javaVersion.majorVersion ? Number(j.javaVersion.majorVersion) : null;
  } catch { return null; }
}

/* ------------------------------------------------------------------ listing */

const TYPES = {
  paper: { label: 'Paper', blurb: 'Fast, stable, plugin-friendly. The best default for most servers.', plugins: true },
  purpur: { label: 'Purpur', blurb: 'Paper fork with extra gameplay options and plugin support.', plugins: true },
  vanilla: { label: 'Vanilla', blurb: 'Mojang\'s official server. No plugins or mods.', plugins: false },
  fabric: { label: 'Fabric', blurb: 'Lightweight mod loader. Drop mods in the mods folder.', plugins: false },
  custom: { label: 'Custom jar', blurb: 'Bring your own server jar (Forge, NeoForge, Folia, anything).', plugins: false },
};

async function listVersions(type, { snapshots = false } = {}) {
  switch (type) {
    case 'vanilla': {
      const m = await getJson(MOJANG_MANIFEST);
      return m.versions
        .filter((v) => snapshots || v.type === 'release')
        .map((v) => ({ id: v.id, stable: v.type === 'release', date: v.releaseTime }));
    }
    case 'paper': {
      const p = await getJson('https://fill.papermc.io/v3/projects/paper');
      const raw = Array.isArray(p.versions) ? p.versions : Object.values(p.versions || {}).flat();
      return [...new Set(raw)]
        .filter((v) => snapshots || isRelease(v))
        .sort((a, b) => compareVersions(b, a))
        .map((id) => ({ id, stable: isRelease(id) }));
    }
    case 'purpur': {
      const p = await getJson('https://api.purpurmc.org/v2/purpur');
      return (p.versions || [])
        .filter((v) => snapshots || isRelease(v))
        .sort((a, b) => compareVersions(b, a))
        .map((id) => ({ id, stable: isRelease(id) }));
    }
    case 'fabric': {
      const g = await getJson('https://meta.fabricmc.net/v2/versions/game');
      return g.filter((v) => snapshots || v.stable).map((v) => ({ id: v.version, stable: !!v.stable }));
    }
    case 'custom': return [];
    default: throw new Error(`Unknown server type "${type}"`);
  }
}

/* ------------------------------------------------------------------ resolve a download */

async function resolve(type, version) {
  if (!version) throw new Error('No version selected');
  switch (type) {
    case 'vanilla': {
      const entry = await mojangEntry(version);
      if (!entry) throw new Error(`Minecraft ${version} was not found in Mojang's version list`);
      const j = await getJson(entry.url);
      const dl = j.downloads && j.downloads.server;
      if (!dl) throw new Error(`Minecraft ${version} has no downloadable server`);
      return {
        url: dl.url, filename: `minecraft_server.${version}.jar`, hash: { algo: 'sha1', value: dl.sha1 },
        size: dl.size, javaMajor: j.javaVersion ? Number(j.javaVersion.majorVersion) : null,
      };
    }
    case 'paper': {
      const builds = await getJson(`https://fill.papermc.io/v3/projects/paper/versions/${encodeURIComponent(version)}/builds`);
      if (!Array.isArray(builds) || !builds.length) throw new Error(`Paper has no builds for ${version}`);
      const sorted = builds.slice().sort((a, b) => b.id - a.id);
      const build = sorted.find((b) => b.channel === 'STABLE') || sorted[0];
      const dl = build.downloads && build.downloads['server:default'];
      if (!dl) throw new Error('Paper build has no server download');
      return {
        url: dl.url, filename: dl.name || `paper-${version}-${build.id}.jar`,
        hash: dl.checksums && dl.checksums.sha256 ? { algo: 'sha256', value: dl.checksums.sha256 } : null,
        size: dl.size, build: String(build.id), channel: build.channel, javaMajor: await mojangJavaMajor(version),
      };
    }
    case 'purpur': {
      const info = await getJson(`https://api.purpurmc.org/v2/purpur/${encodeURIComponent(version)}/latest`);
      const build = String(info.build);
      return {
        url: `https://api.purpurmc.org/v2/purpur/${encodeURIComponent(version)}/${build}/download`,
        filename: `purpur-${version}-${build}.jar`,
        hash: info.md5 ? { algo: 'md5', value: info.md5 } : null,
        build, javaMajor: await mojangJavaMajor(version),
      };
    }
    case 'fabric': {
      const loaders = await getJson(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(version)}`);
      const loader = (loaders.find((l) => l.loader && l.loader.stable) || loaders[0] || {}).loader;
      if (!loader) throw new Error(`Fabric does not support ${version}`);
      const installers = await getJson('https://meta.fabricmc.net/v2/versions/installer');
      const installer = installers.find((i) => i.stable) || installers[0];
      return {
        url: `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(version)}/${loader.version}/${installer.version}/server/jar`,
        filename: `fabric-server-${version}-loader-${loader.version}.jar`,
        build: loader.version, javaMajor: await mojangJavaMajor(version),
      };
    }
    default: throw new Error(`Cannot download "${type}" automatically`);
  }
}

/** Best-effort guess when the API gave us nothing. */
function guessJavaMajor(version) {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(version || '');
  if (!m) return 21;
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
  if (major >= 26) return 25;
  if (major === 1) {
    if (minor <= 16) return 8;
    if (minor === 17) return 16;
    if (minor < 20 || (minor === 20 && patch < 5)) return 17;
    return 21;
  }
  return 21;
}

module.exports = { TYPES, listVersions, resolve, getJson, guessJavaMajor, compareVersions, UA };
