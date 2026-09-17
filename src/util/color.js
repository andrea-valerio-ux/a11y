'use strict';
// Colour maths on the Node side. Mirrors the in-page helpers so a ratio
// printed in a finding agrees with the one measured in the browser.

function parse(c) {
  if (!c) return null;
  if (Array.isArray(c)) return c;
  if (c[0] === '#') {
    let h = c.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6 && h.length !== 8) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c);
  if (!m) return null;
  if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
  return [+m[1], +m[2], +m[3]];
}

function toHex(rgb) {
  return '#' + rgb.map(x => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function luminance(rgb) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

// WCAG 2.x contrast ratio, two decimals.
function contrast(a, b) {
  const ra = parse(a), rb = parse(b);
  if (!ra || !rb) return null;
  const l1 = luminance(ra), l2 = luminance(rb);
  return +(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2));
}

// 1.4.3 threshold for a run of text. "Large" is 24px, or 18.66px when bold.
function isLarge(fontSizePx, fontWeight) {
  const bold = parseInt(fontWeight, 10) >= 700;
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && bold);
}

function required(fontSizePx, fontWeight, level) {
  const large = isLarge(fontSizePx, fontWeight);
  if (level === 'AAA') return large ? 4.5 : 7;
  return large ? 3 : 4.5;
}

module.exports = { parse, toHex, luminance, contrast, required, isLarge };
