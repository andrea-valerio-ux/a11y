'use strict';
// Reflow, zoom and forced colors: change the environment and re-read the
// page, rather than reading the stylesheet.
const { sleep } = require('../browser');

const SNAPSHOT = () => {
  const H = window.__a11y;
  const doc = document.documentElement;
  const overflowing = [];
  const vw = innerWidth;
  if (doc.scrollWidth > vw + 1) {
    document.querySelectorAll('body *').forEach(e => {
      if (overflowing.length >= 40 || H.isSkipped(e)) return;
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 2 && r.left < vw) {
        const s = getComputedStyle(e);
        if (s.position === 'fixed' && r.left >= vw) return;
        // Prefer the outermost offender: skip if the parent overflows just as much.
        const p = e.parentElement; const pr = p ? p.getBoundingClientRect() : null;
        if (pr && pr.right >= r.right - 1 && p !== document.body) return;
        overflowing.push({ sel: H.selOf(e), path: H.pathOf(e), snippet: H.snippet(e), rect: H.box(e), right: Math.round(r.right), width: Math.round(r.width) });
      }
    });
  }
  const clipped = [];
  const textEls = [];
  document.querySelectorAll('body *').forEach(e => {
    if (H.isSkipped(e)) return;
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden') return;
    const own = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 2);
    if (own) textEls.push(e);
    // A box that hides part of the text inside it, its own or a descendant's.
    if ((s.overflowY === 'hidden' || s.overflowY === 'clip') && e.clientHeight > 0 && e.scrollHeight > e.clientHeight + 3
        && s.textOverflow !== 'ellipsis' && s.webkitLineClamp === 'none' && (e.textContent || '').trim().length > 2
        && !e.matches('body,html,main,[role=main]') && !e.querySelector('video,canvas,iframe')) {
      // Carousels and sliders move sideways; only count boxes whose hidden part is text.
      if (clipped.length < 25) clipped.push({ sel: H.selOf(e), path: H.pathOf(e), snippet: H.snippet(e), rect: H.box(e), visible: e.clientHeight, actual: e.scrollHeight, text: H.textOf(e).slice(0, 50) });
    }
  });
  // Overlapping text: two text elements whose boxes intersect substantially and neither contains the other.
  const overlaps = [];
  const sample = textEls.slice(0, 500);
  // Only the visible part of a box counts: text hidden by an overflow:hidden
  // ancestor cannot overlap anything.
  const visibleRect = e => {
    let r = e.getBoundingClientRect();
    let x = { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
    let a = e.parentElement;
    while (a && a !== document.body) {
      const cs = getComputedStyle(a);
      if (/hidden|clip/.test(cs.overflow + cs.overflowX + cs.overflowY)) {
        const ar = a.getBoundingClientRect();
        x = { x: Math.max(x.x, ar.x), y: Math.max(x.y, ar.y), right: Math.min(x.right, ar.right), bottom: Math.min(x.bottom, ar.bottom) };
      }
      a = a.parentElement;
    }
    return { x: x.x, y: x.y, right: x.right, bottom: x.bottom, width: Math.max(0, x.right - x.x), height: Math.max(0, x.bottom - x.y) };
  };
  const boxes = sample.map(visibleRect);
  for (let i = 0; i < sample.length && overlaps.length < 15; i++) {
    const a = boxes[i]; if (a.width < 10 || a.height < 8) continue;
    for (let j = i + 1; j < sample.length; j++) {
      const b = boxes[j]; if (b.width < 10 || b.height < 8) continue;
      if (sample[i].contains(sample[j]) || sample[j].contains(sample[i])) continue;
      const ix = Math.min(a.right, b.right) - Math.max(a.x, b.x);
      const iy = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
      if (ix > 8 && iy > 6 && ix * iy > 0.25 * Math.min(a.width * a.height, b.width * b.height)) {
        // Positioned overlays (badges, labels on cards) are design, not breakage, when one is absolute over an image.
        const sa = getComputedStyle(sample[i]), sb = getComputedStyle(sample[j]);
        if ((sa.position === 'absolute' || sb.position === 'absolute') && Math.abs(a.y - b.y) > 6) continue;
        overlaps.push({ a: { sel: H.selOf(sample[i]), text: H.textOf(sample[i]).slice(0, 40) }, b: { sel: H.selOf(sample[j]), text: H.textOf(sample[j]).slice(0, 40) }, sel: H.selOf(sample[i]), path: H.pathOf(sample[i]), rect: H.box(sample[i]) });
        break;
      }
    }
  }
  return { viewport: vw, documentWidth: doc.scrollWidth, horizontalScroll: doc.scrollWidth > vw + 1,
    overflowing, overflowingCount: overflowing.length, clipped, clippedCount: clipped.length, overlaps, overlapCount: overlaps.length };
};

module.exports = {
  id: 'responsive',
  label: 'reflow, zoom and forced colors',
  async collect(page, ctx = {}) {
    const original = page.viewport();
    const base = await page.evaluate(SNAPSHOT);

    // 1.4.10: 320 CSS px wide is the reflow test. Skip if we are already narrower.
    let narrow = null;
    if (original.width > 330) {
      await page.setViewport({ width: 320, height: 800, deviceScaleFactor: 1 });
      await sleep(800);
      narrow = await page.evaluate(SNAPSHOT);
      await page.setViewport(original);
      await sleep(600);
    }

    // 1.4.4: 200% zoom. CSS zoom on the root scales text and layout together
    // the way browser zoom does, within the same viewport.
    await page.evaluate(() => { document.documentElement.style.setProperty('zoom', '2', 'important'); });
    await sleep(700);
    const zoomed = await page.evaluate(SNAPSHOT);
    await page.evaluate(() => { document.documentElement.style.removeProperty('zoom'); });
    await sleep(400);

    // Forced colors: find controls whose only visual is a background image
    // or box-shadow, which forced-colors mode removes.
    let forced = { measured: false, lost: [] };
    try {
      await page.emulateMediaFeatures([{ name: 'forced-colors', value: 'active' }, { name: 'prefers-color-scheme', value: 'light' }]);
      await sleep(400);
      forced = await page.evaluate(() => {
        const H = window.__a11y;
        const lost = [];
        document.querySelectorAll('a[href],button,[role=button],input[type=checkbox],input[type=radio],[role=checkbox],[role=switch]').forEach(c => {
          if (lost.length >= 15 || !H.visible(c) || H.isSkipped(c)) return;
          if (H.textOf(c) || c.querySelector('img,svg,[role=img]')) return;
          const s = getComputedStyle(c), b = getComputedStyle(c, '::before'), a = getComputedStyle(c, '::after');
          const hadIcon = [s, b, a].some(x => (x.maskImage && x.maskImage !== 'none') || (x.webkitMaskImage && x.webkitMaskImage !== 'none') || (x.backgroundImage && x.backgroundImage !== 'none'));
          const border = [s, b, a].some(x => x.borderTopStyle !== 'none' && parseFloat(x.borderTopWidth) > 0);
          if (hadIcon && !border) lost.push({ sel: H.selOf(c), path: H.pathOf(c), rect: H.box(c), snippet: H.snippet(c), name: H.accName(c).slice(0, 40), why: 'icon drawn with a background or mask image and no border' });
        });
        return { measured: matchMedia('(forced-colors: active)').matches, lost };
      });
    } catch (e) { forced.error = String(e.message || e).slice(0, 100); }
    finally { try { await page.emulateMediaFeatures([{ name: 'forced-colors', value: 'none' }]); } catch (e) { /* ignore */ } }

    return { width: original.width, base, narrow, zoomed, forced };
  }
};
