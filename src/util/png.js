'use strict';
// Minimal PNG reader: 8-bit truecolor with or without alpha, non-interlaced,
// which is exactly what Chrome's screenshots are. Used to sample the real
// backdrop pixels behind text that sits on a photograph or gradient.
const zlib = require('zlib');

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function decode(input) {
  const buf = Buffer.isBuffer(input) ? input
    : (input && typeof input.byteLength === 'number') ? Buffer.from(input) : null;
  if (!buf || buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) return null;
  let off = 8, width = 0, height = 0, depth = 0, color = 0, interlace = 0;
  const idat = [];

  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; color = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }

  if (depth !== 8 || interlace !== 0) return null;
  const channels = color === 6 ? 4 : color === 2 ? 3 : color === 0 ? 1 : null;
  if (!channels) return null;

  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch (e) { return null; }

  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let pos = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prior ? prior[x] : 0;
      const c = (prior && x >= channels) ? prior[x - channels] : 0;
      let v = line[x];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
        default: return null;
      }
      cur[x] = v;
    }
  }

  return { width, height, channels, data: out };
}

function lum(r, g, b) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

// Lightest and darkest color present, at the 5th and 95th percentile so a
// single antialiased pixel cannot decide the verdict.
function extremes(img) {
  const { width, height, channels, data } = img;
  const list = [];
  const stepX = Math.max(1, Math.floor(width / 120));
  const stepY = Math.max(1, Math.floor(height / 120));

  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const i = (y * width + x) * channels;
      if (channels === 4 && data[i + 3] < 200) continue;
      const r = data[i], g = channels === 1 ? data[i] : data[i + 1], b = channels === 1 ? data[i] : data[i + 2];
      list.push({ rgb: [r, g, b], l: lum(r, g, b) });
    }
  }
  if (!list.length) return { lightest: [255, 255, 255], darkest: [255, 255, 255], spread: 0, samples: 0 };

  list.sort((a, b) => a.l - b.l);
  const lo = list[Math.floor(list.length * 0.05)];
  const hi = list[Math.floor(list.length * 0.95)];
  return { darkest: lo.rgb, lightest: hi.rgb, spread: +(hi.l - lo.l).toFixed(4), samples: list.length };
}

module.exports = { decode, extremes, lum };
