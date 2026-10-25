'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { Readable } = require('stream');
const { UA } = require('./providers');

/**
 * Stream a URL to disk with progress + optional checksum verification.
 * Writes to "<dest>.part" first so a broken download never looks like a real jar.
 */
async function downloadFile(url, dest, { onProgress, hash, headers } = {}) {
  const part = `${dest}.part`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...(headers || {}) }, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed: ${new URL(url).host} answered HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const hasher = hash ? crypto.createHash(hash.algo) : null;
  const out = fs.createWriteStream(part);
  let received = 0;
  let lastEmit = 0;
  try {
    await new Promise((resolve, reject) => {
      const src = Readable.fromWeb(res.body);
      src.on('data', (chunk) => {
        received += chunk.length;
        if (hasher) hasher.update(chunk);
        const now = Date.now();
        if (onProgress && now - lastEmit > 120) { lastEmit = now; onProgress(received, total); }
      });
      src.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      src.pipe(out);
    });
  } catch (e) {
    out.destroy();
    fs.rmSync(part, { force: true });
    throw e;
  }
  if (hasher && hash.value) {
    const digest = hasher.digest('hex');
    if (digest.toLowerCase() !== String(hash.value).toLowerCase()) {
      fs.rmSync(part, { force: true });
      throw new Error('Downloaded file failed its checksum — please try again.');
    }
  }
  fs.renameSync(part, dest);
  if (onProgress) onProgress(received, total || received);
  return received;
}

module.exports = { downloadFile };
