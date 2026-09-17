'use strict';
// One picture per finding that has a position. The element is outlined in
// red with the rest of the crop dimmed, so the picture alone says where the
// problem is. Images are stored relative to the run folder so findings.json
// can be read from anywhere.
const fs = require('fs');
const path = require('path');
const log = require('./util/log');

const PAD = 36;
const MAX_W = 1400, MAX_H = 900;
// Small elements get a crop at least this big, so the picture shows where on
// the page the element sits, not just the element.
const MIN_W = 520, MIN_H = 220;

const HIGHLIGHT = (rect, label) => {
  const [x, y, w, h] = rect;
  const box = document.createElement('div');
  box.setAttribute('data-a11y-evidence', '1');
  box.style.cssText = `position:absolute;left:${x - 4}px;top:${y - 4}px;width:${w + 8}px;height:${h + 8}px;` +
    'border:3px solid #E5484D;border-radius:4px;box-shadow:0 0 0 2px #fff,0 0 0 100vmax rgba(15,15,30,.28);' +
    'pointer-events:none;z-index:2147483647;box-sizing:border-box;';
  const tag = document.createElement('div');
  tag.setAttribute('data-a11y-evidence', '1');
  tag.textContent = label;
  tag.style.cssText = `position:absolute;left:${Math.max(0, x - 4)}px;top:${Math.max(0, y - 26)}px;background:#E5484D;color:#fff;` +
    'font:700 11px/1 ui-monospace,Menlo,monospace;padding:5px 7px;border-radius:3px 3px 0 0;pointer-events:none;z-index:2147483647;letter-spacing:.04em;white-space:nowrap';
  document.body.appendChild(box); document.body.appendChild(tag);
  // Fixed-position elements are measured against the viewport; keep the page at top for them.
};
const CLEAR = () => document.querySelectorAll('[data-a11y-evidence]').forEach(e => e.remove());

async function capture(page, findings, dir, root, { maxPerRule = 15 } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  const perRule = {};
  const vp = page.viewport();

  for (const f of findings) {
    if (f.shot === false) continue;
    const rect = f.rect;
    if (!rect || !rect[2] || !rect[3]) continue;
    perRule[f.rule] = (perRule[f.rule] || 0) + 1;
    if (perRule[f.rule] > maxPerRule) { f.evidenceImage = null; f.evidenceSkipped = 'over the per-rule image budget'; continue; }

    const name = `${String(++n).padStart(3, '0')}-${f.rule.toLowerCase()}.png`;
    try {
      // Crop around the element, bounded so a full-width hero does not produce a 6000px image.
      const w = Math.min(Math.max(rect[2] + PAD * 2, MIN_W), MAX_W, vp.width);
      const h = Math.min(Math.max(rect[3] + PAD * 2, MIN_H), MAX_H);
      // Centre the element in the crop, then keep the crop inside the page.
      let x = rect[0] + rect[2] / 2 - w / 2, y = rect[1] + rect[3] / 2 - h / 2;
      x = Math.max(0, Math.min(x, vp.width - w)); y = Math.max(0, y);
      if (rect[3] + PAD * 2 > h) y = Math.max(0, rect[1] - PAD);   // tall elements: show the top
      x = Math.round(x); y = Math.round(y);
      const clip = { x, y, width: Math.max(40, w), height: Math.max(24, h) };
      const label = f.rule.toLowerCase().replace(/-/g, ' ');
      await page.evaluate(HIGHLIGHT, rect, label);
      const buf = await page.screenshot({ clip, captureBeyondViewport: true });
      await page.evaluate(CLEAR);
      fs.writeFileSync(path.join(dir, name), buf);
      f.evidenceImage = path.relative(root, path.join(dir, name)).split(path.sep).join('/');
    } catch (e) {
      n--;
      try { await page.evaluate(CLEAR); } catch (err) { /* ignore */ }
      f.evidenceImage = null;
      log.warn('no shot for ' + f.rule + ': ' + String(e.message).slice(0, 70));
    }
  }
  return n;
}

async function fullPage(page, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    const buf = await page.screenshot({ fullPage: true });
    fs.writeFileSync(file, buf);
    return file;
  } catch (e) {
    // Very tall pages exceed Chrome's texture limit; fall back to the first screen.
    const buf = await page.screenshot();
    fs.writeFileSync(file, buf);
    return file;
  }
}

module.exports = { capture, fullPage };
