'use strict';
const fs = require('fs');
const path = require('path');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Turn a display name into a safe folder name (Windows + Unix). */
function slugifyFolder(name) {
  let s = String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^[.\-\s]+|[.\-\s]+$/g, '')
    .slice(0, 48);
  if (!s) s = 'server';
  if (WIN_RESERVED.test(s)) s += '-server';
  return s;
}

function validFolderName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 64 &&
    !/[<>:"/\\|?*\u0000-\u001f]/.test(name) && !/^[.\s]|[.\s]$/.test(name) && !WIN_RESERVED.test(name);
}

function uniqueDir(parent, base) {
  let candidate = path.join(parent, base);
  let n = 2;
  while (fs.existsSync(candidate)) candidate = path.join(parent, `${base}-${n++}`);
  return candidate;
}

async function dirSize(dir) {
  let total = 0;
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    try {
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) total += await dirSize(p);
      else if (e.isFile()) total += (await fs.promises.stat(p)).size;
    } catch { /* file vanished */ }
  }
  return total;
}

function tailLines(file, n = 300, maxBytes = 256 * 1024) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const { size } = fs.fstatSync(fd);
      const len = Math.min(size, maxBytes);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      const lines = buf.toString('utf8').split(/\r?\n/);
      if (size > len) lines.shift();
      while (lines.length && lines[lines.length - 1] === '') lines.pop();
      return lines.slice(-n);
    } finally { fs.closeSync(fd); }
  } catch { return []; }
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;
const stripAnsi = (s) => s.replace(ANSI, '');

function isPlainObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  if (!isPlainObject(extra)) return out;
  for (const [k, v] of Object.entries(extra)) {
    if (isPlainObject(v) && isPlainObject(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

function clamp(n, lo, hi, fallback) {
  n = Number(n);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/** Split a command line into argv without invoking a shell. Supports "quotes". */
function splitCommand(line) {
  const out = [];
  let cur = '';
  let quote = null;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
    } else if (c === '"' || c === "'") { quote = c; has = true; }
    else if (/\s/.test(c)) {
      if (cur || has) { out.push(cur); cur = ''; has = false; }
    } else cur += c;
  }
  if (cur || has) out.push(cur);
  return out;
}

function fmtErr(e) { return e && e.message ? e.message : String(e); }

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

module.exports = {
  readJson, writeJson, slugifyFolder, validFolderName, uniqueDir, dirSize, tailLines,
  stripAnsi, deepMerge, isPlainObject, clamp, splitCommand, fmtErr, HttpError,
};
