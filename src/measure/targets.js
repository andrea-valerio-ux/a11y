'use strict';
// Pointer targets: size (2.5.8 at 24px AA, 2.5.5 at 44px AAA) and the space
// between neighboring controls.
module.exports = {
  id: 'targets',
  label: 'target size and spacing',
  async collect(page) {
    return page.evaluate(() => {
      const H = window.__a11y;
      const els = [...document.querySelectorAll('a[href],button,[role=button],input:not([type=hidden]),select,textarea,summary,[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=switch],[role=option],[tabindex]:not([tabindex="-1"])')]
        .filter(e => H.visible(e) && !H.isSkipped(e) && !H.inAriaHidden(e) && !e.closest('a[href] a, button button'));
      const rects = els.map(e => e.getBoundingClientRect());

      const undersized = [], crowded = [];
      for (let i = 0; i < els.length; i++) {
        const e = els[i], r = rects[i];
        if (r.width === 0 || r.height === 0) continue;
        const w = Math.round(r.width), h = Math.round(r.height);

        // Inline exception: sized by the sentence it sits in.
        const inline = (() => {
          const p = e.parentElement; if (!p) return false;
          const d = getComputedStyle(e).display;
          if (d !== 'inline' && d !== 'inline-block') return false;
          const words = [...p.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim().length > 1).length;
          return words > 0 && /^(block|list-item|table-cell|flex)/.test(getComputedStyle(p).display) && e.tagName === 'A';
        })();

        // Nearest neighbor gap and whether a 24px circle centered here overlaps a neighbor's.
        let minGap = Infinity, neighbor = null, overlap24 = false;
        const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
        for (let j = 0; j < els.length; j++) {
          if (j === i) continue;
          const o = rects[j]; if (o.width === 0) continue;
          if (els[j].contains(e) || e.contains(els[j])) continue;
          const gx = Math.max(0, Math.max(r.x, o.x) - Math.min(r.right, o.right));
          const gy = Math.max(0, Math.max(r.y, o.y) - Math.min(r.bottom, o.bottom));
          const gap = Math.hypot(gx, gy);
          // Only neighbors roughly in the same row or column count as adjacent.
          const sameRow = !(r.bottom < o.y || o.bottom < r.y);
          const sameCol = !(r.right < o.x || o.right < r.x);
          if ((sameRow || sameCol) && gap < minGap) { minGap = gap; neighbor = els[j]; }
          const ox = o.x + o.width / 2, oy = o.y + o.height / 2;
          if (Math.hypot(cx - ox, cy - oy) < 24) overlap24 = true;
        }

        const base = { sel: H.selOf(e), path: H.pathOf(e), snippet: H.snippet(e), name: H.accName(e).slice(0, 40), size: [w, h], rect: H.box(e) };
        if (w < 24 || h < 24) {
          undersized.push({ ...base, inlineException: inline, spacingException: !overlap24, failsAA: !inline && overlap24, failsAAA: true });
        } else if (w < 44 || h < 44) {
          undersized.push({ ...base, inlineException: inline, spacingException: true, failsAA: false, failsAAA: !inline });
        }
        if (neighbor && minGap < 8 && !inline && (w >= 24 || h >= 24) && crowded.length < 25) {
          crowded.push({ ...base, gap: Math.round(minGap), neighbor: H.selOf(neighbor), neighborName: H.accName(neighbor).slice(0, 30) });
        }
      }

      return {
        checked: els.length,
        undersized: undersized.slice(0, 80),
        failingAA: undersized.filter(u => u.failsAA).length,
        failingAAA: undersized.filter(u => u.failsAAA && !u.inlineException).length,
        crowded
      };
    });
  }
};
