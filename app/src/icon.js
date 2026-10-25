'use strict';
/** Tiny PNG encoder + a deterministic "identicon" so every new server gets a proper 64x64 server-icon.png. */
const zlib = require('zlib');
const crypto = require('crypto');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function hsl(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}

/** 64x64 symmetrical pixel-art icon derived from the server name. */
function identicon(seed) {
  const h = crypto.createHash('sha256').update(String(seed)).digest();
  const hue = (h[0] * 360) / 256;
  const fg = hsl(hue, 70, 62);
  const fg2 = hsl((hue + 40) % 360, 75, 52);
  const bgTop = hsl((hue + 200) % 360, 45, 16);
  const bgBot = hsl((hue + 230) % 360, 50, 8);
  const cells = 8; // 8x8 grid, each cell 8px, mirrored horizontally
  const px = 64;
  const buf = Buffer.alloc(px * px * 4);
  const on = [];
  for (let y = 0; y < cells; y++) {
    on[y] = [];
    for (let x = 0; x < cells / 2; x++) {
      const bit = h[1 + ((y * 4 + x) >> 3)] >> ((y * 4 + x) & 7) & 1;
      on[y][x] = bit; on[y][cells - 1 - x] = bit;
    }
  }
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const cx = Math.floor(x / 8), cy = Math.floor(y / 8);
      const t = y / (px - 1);
      let c = bgTop.map((v, i) => Math.round(v + (bgBot[i] - v) * t));
      if (on[cy][cx]) {
        const edge = x % 8 === 0 || y % 8 === 0;
        c = (cx + cy) % 2 ? fg : fg2;
        if (edge) c = c.map((v) => Math.round(v * 0.82));
      }
      const o = (y * px + x) * 4;
      buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = 255;
    }
  }
  return encodePng(px, px, buf);
}

module.exports = { identicon, encodePng };
