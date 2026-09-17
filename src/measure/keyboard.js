'use strict';
// Keyboard: what actually happens when you press Tab.
//
// Focus visibility cannot be read from the stylesheet: :focus-visible rules
// only resolve for a keyboard user, and the ring is often painted by an
// ancestor or a pseudo-element. So Tab is pressed for real and what changed
// is read back at every stop, along with where the stop is and whether it
// can be seen at all.
const { contrast } = require('../util/color');

module.exports = {
  id: 'keyboard',
  label: 'focus visibility, focus order and hidden tab stops',
  async collect(page, ctx = {}) {
    const budget = ctx.tabStops || 80;
    const rows = [];
    const seen = new Set();
    let wrapped = false;

    // Start from the top of the document so the first stop is the first stop.
    await page.evaluate(() => { window.scrollTo(0, 0); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

    for (let i = 0; i < budget; i++) {
      await page.keyboard.press('Tab');
      const r = await page.evaluate((index) => {
        const H = window.__a11y;
        const e = document.activeElement;
        if (!e || e === document.body || e === document.documentElement) return null;
        const hex = c => { const v = H.rgb(c); return v ? H.hex(v) : null; };
        const hexLoose = c => {   // indicators count even when fairly transparent
          const m = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)/.exec(c || '');
          if (!m) return null; if (m[4] !== undefined && parseFloat(m[4]) < 0.15) return null;
          return H.hex([+m[1], +m[2], +m[3]]);
        };

        let bg = null, n = e;
        while (n && n !== document.documentElement) { const h = hex(getComputedStyle(n).backgroundColor); if (h) { bg = h; break; } n = n.parentElement; }
        if (!bg) bg = '#FFFFFF';
        let outer = null, o = e.parentElement;
        while (o && o !== document.documentElement) { const h = hex(getComputedStyle(o).backgroundColor); if (h) { outer = h; break; } o = o.parentElement; }
        if (!outer) outer = '#FFFFFF';

        const indicators = [];
        const scan = (el, label, depth) => {
          const c = getComputedStyle(el);
          const ow = parseFloat(c.outlineWidth) || 0;
          if (c.outlineStyle !== 'none' && ow > 0) {
            const h = hexLoose(c.outlineColor);
            if (h) indicators.push({ source: label + 'outline', color: h, width: ow, userAgent: c.outlineStyle === 'auto', offset: depth === 0 ? (parseFloat(c.outlineOffset) || 0) : null });
          }
          if (c.boxShadow && c.boxShadow !== 'none') {
            const m = c.boxShadow.match(/rgba?\([^)]+\)/);
            const h = m ? hexLoose(m[0]) : null;
            if (h) indicators.push({ source: label + 'box-shadow', color: h, width: 2, userAgent: false, offset: depth === 0 && !/inset/.test(c.boxShadow) ? 0 : null });
          }
          for (const pe of ['::before', '::after']) {
            const pc = getComputedStyle(el, pe);
            if (pc.content === 'none' || pc.content === '' || pc.display === 'none') continue;
            const bw = Math.max(parseFloat(pc.borderTopWidth) || 0, parseFloat(pc.borderBottomWidth) || 0);
            if (pc.borderTopStyle !== 'none' && bw > 0) { const h = hexLoose(pc.borderTopColor) || hexLoose(pc.borderBottomColor); if (h) indicators.push({ source: label + 'pseudo-border', color: h, width: bw, userAgent: false }); }
            const po = parseFloat(pc.outlineWidth) || 0;
            if (pc.outlineStyle !== 'none' && po > 0) { const h = hexLoose(pc.outlineColor); if (h) indicators.push({ source: label + 'pseudo-outline', color: h, width: po, userAgent: false }); }
            if (pc.boxShadow && pc.boxShadow !== 'none') { const m = pc.boxShadow.match(/rgba?\([^)]+\)/); const h = m ? hexLoose(m[0]) : null; if (h) indicators.push({ source: label + 'pseudo-box-shadow', color: h, width: 2, userAgent: false }); }
          }
          if (depth > 0) {
            const cls = typeof el.className === 'string' ? el.className : '';
            if (/-focused|is-focus|focus/.test(cls) || el.matches(':focus-within')) {
              const bw = parseFloat(c.borderTopWidth) || 0;
              if (c.borderTopStyle !== 'none' && bw > 0 && /-focused|is-focus|focus/.test(cls)) { const h = hexLoose(c.borderTopColor); if (h) indicators.push({ source: label + 'border', color: h, width: bw, userAgent: false }); }
            }
          }
        };
        scan(e, '', 0);
        let m = e.parentElement;
        for (let k = 1; k <= 5 && m && m !== document.body; k++) { scan(m, 'ancestor' + k + '-', k); m = m.parentElement; }

        // Did anything change compared with the unfocused state? Compare the
        // control's own border/background with a sibling of the same class,
        // as a fallback signal when no ring is found.
        let changed = false;
        if (!indicators.length) {
          const before = e.getAttribute('data-a11y-base');
          const c = getComputedStyle(e);
          const now = [c.backgroundColor, c.borderTopColor, c.color, c.textDecorationLine, c.borderBottomColor].join('|');
          // Same-class sibling not focused
          const twin = e.parentElement && [...e.parentElement.children].find(x => x !== e && x.tagName === e.tagName && x.className === e.className);
          if (twin) { const t = getComputedStyle(twin); const base = [t.backgroundColor, t.borderTopColor, t.color, t.textDecorationLine, t.borderBottomColor].join('|'); changed = base !== now; }
          else if (before) changed = before !== now;
        }

        const rect = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        const opacity = (() => { let x = e, op = 1; while (x && x !== document.documentElement) { op *= parseFloat(getComputedStyle(x).opacity); x = x.parentElement; } return op; })();
        const offscreen = rect.right <= 0 || rect.bottom <= 0 || rect.left >= document.documentElement.scrollWidth + 1 || (rect.left >= innerWidth && s.position === 'fixed');
        const zero = rect.width === 0 || rect.height === 0;
        const clipped = (() => {   // inside an overflow:hidden ancestor that does not show it
          let x = e.parentElement;
          while (x && x !== document.body) {
            const cs = getComputedStyle(x);
            if (/hidden|clip/.test(cs.overflow + cs.overflowX + cs.overflowY)) {
              const pr = x.getBoundingClientRect();
              if (rect.right <= pr.left || rect.left >= pr.right || rect.bottom <= pr.top || rect.top >= pr.bottom) return true;
            }
            x = x.parentElement;
          }
          return false;
        })();
        const srOnly = (s.clip && s.clip !== 'auto' && rect.width <= 1) || (rect.width <= 1 && rect.height <= 1 && s.overflow === 'hidden');
        const inAriaHidden = H.inAriaHidden(e);
        const hiddenReason = zero ? 'no size' : offscreen ? 'off screen' : opacity < 0.05 ? 'transparent' : s.visibility === 'hidden' ? 'visibility hidden' : clipped ? 'clipped by an overflow:hidden ancestor' : inAriaHidden ? 'inside aria-hidden' : null;

        return {
          index, sel: H.selOf(e), path: H.pathOf(e), snippet: H.snippet(e), tag: e.tagName.toLowerCase(),
          name: H.accName(e).slice(0, 50), href: e.getAttribute && (e.getAttribute('href') || '').slice(0, 60),
          tabindex: e.getAttribute('tabindex'),
          rect: [Math.round(rect.x + scrollX), Math.round(rect.y + scrollY), Math.round(rect.width), Math.round(rect.height)],
          viewportTop: Math.round(rect.y),
          background: bg, outer, indicators, changed, hiddenReason, srOnly, inAriaHidden,
          isSkipLink: e.tagName === 'A' && /^#./.test(e.getAttribute('href') || '') && index === 0
        };
      }, i);

      if (!r) { if (i > 0) { wrapped = true; break; } else continue; }
      const key = r.path + '|' + r.name + '|' + r.rect.join(',');
      if (seen.has(key)) { wrapped = true; break; }
      seen.add(key);
      rows.push(r);
    }

    // Skip link: if the first stop is an in-page link, is it visible now that it has focus?
    let skipLink = null;
    if (rows[0] && rows[0].isSkipLink) {
      skipLink = { ...rows[0], visibleOnFocus: !rows[0].hiddenReason && !rows[0].srOnly && rows[0].rect[2] > 2 && rows[0].rect[3] > 2 };
    }

    function ringRatio(i, r) {
      const inner = contrast(i.color, r.background);
      if (i.offset == null || !r.outer) return inner;
      const around = contrast(i.color, r.outer);
      if (i.offset > 0) return around;
      return Math.min(inner === null ? 99 : inner, around === null ? 99 : around);
    }

    let none = 0, userAgentOnly = 0, pass = 0, low = 0;
    const noIndicator = [], lowContrast = [], defaultOnly = [], shadowOnly = [];
    const hidden = rows.filter(r => r.hiddenReason && !r.srOnly);   // sr-only skip links are legitimate
    for (const r of rows) {
      if (r.hiddenReason) continue;                                 // graded separately
      if (!r.indicators.length) { if (r.changed) { pass++; continue; } none++; noIndicator.push(r); continue; }
      if (r.indicators.every(i => i.userAgent)) { userAgentOnly++; defaultOnly.push(r); continue; }
      const designed = r.indicators.filter(i => !i.userAgent);
      if (designed.length && designed.every(i => /box-shadow/.test(i.source))) shadowOnly.push(r);
      const best = designed.map(i => ({ ...i, ratio: ringRatio(i, r) })).filter(i => i.ratio !== null).sort((a, b) => b.ratio - a.ratio)[0];
      if (!best) { none++; noIndicator.push(r); continue; }
      if (best.ratio < 3) { low++; lowContrast.push({ ...r, indicator: best }); } else pass++;
    }

    // Focus order versus visual order: a stop that jumps well above the
    // previous one after focus has been traveling downwards.
    const jumps = [];
    const vis = rows.filter(r => !r.hiddenReason);
    for (let i = 1; i < vis.length; i++) {
      const a = vis[i - 1], b = vis[i];
      const dy = b.rect[1] - a.rect[1];
      // Back up the page by more than a screen-quarter, and not a wrap to a new row (which goes down).
      if (dy < -Math.max(150, (ctx.viewportHeight || 900) / 4) && a.rect[1] > 200) {
        // Ignore jumps into fixed headers (they sit at top by design)
        jumps.push({ from: { sel: a.sel, name: a.name, rect: a.rect }, to: { sel: b.sel, path: b.path, name: b.name, rect: b.rect, snippet: b.snippet }, dy });
      }
    }

    return {
      stops: rows.length, requested: budget, complete: wrapped || rows.length < budget,
      none, userAgentOnly, low, pass,
      noIndicator: noIndicator.slice(0, 25), lowContrast: lowContrast.slice(0, 25), defaultOnly: defaultOnly.slice(0, 25), shadowOnly: shadowOnly.slice(0, 15),
      hidden: hidden.slice(0, 25), hiddenCount: hidden.length,
      jumps: jumps.slice(0, 10), skipLink,
      order: rows.map(r => ({ sel: r.sel, name: r.name, rect: r.rect, hidden: r.hiddenReason }))
    };
  }
};
