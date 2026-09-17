'use strict';
// Contrast, measured rather than inferred.
//
// Text on a solid background is computed from resolved colors. Text over
// an image or gradient is measured from pixels: glyphs are made transparent,
// the region is screenshotted, and the real backdrop is sampled. Icons, input
// borders, link color and ::selection colors are computed too.
const { contrast, toHex } = require('../util/color');
const png = require('../util/png');
const { sleep } = require('../browser');

const HIDE_GLYPHS = '*{color:transparent !important;text-shadow:none !important;-webkit-text-fill-color:transparent !important;caret-color:transparent !important}';

module.exports = {
  id: 'contrast',
  label: 'color contrast of text, icons and borders',
  async collect(page, ctx = {}) {
    const level = ctx.level || 'AA';

    const found = await page.evaluate((level) => {
      const H = window.__a11y;
      const out = [];
      let sampled = 0;

      document.querySelectorAll('body *').forEach(e => {
        if (H.isSkipped(e) || e.closest('svg,[aria-hidden="true"],option')) return;
        const own = [...e.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim().length > 1);
        if (!own.length) return;
        const r = e.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) return;
        const s = getComputedStyle(e);
        if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) === 0) return;
        // Clipped-away visually hidden text (sr-only) is not seen, so not measured.
        if ((s.clip && s.clip !== 'auto' && r.width <= 1) || (s.position === 'absolute' && r.width <= 1 && r.height <= 1)) return;
        if (r.bottom < -5 || r.right < -5) return;
        const fg = H.rgb(s.color);
        if (!fg) return;
        // Placeholder-only inputs and disabled controls are exempt from 1.4.3.
        if (e.matches(':disabled,[aria-disabled="true"]') || e.closest(':disabled')) return;

        const size = parseFloat(s.fontSize);
        const large = H.isLarge(size, s.fontWeight);
        const req = level === 'AAA' ? (large ? 4.5 : 7) : (large ? 3 : 4.5);
        sampled++;

        const { bg, backdrop } = H.bgOf(e);
        const text = own.map(x => x.textContent.trim()).join(' ').replace(/\s+/g, ' ').slice(0, 60);
        const base = { text, sel: H.selOf(e), path: H.pathOf(e), snippet: H.snippet(e), foreground: H.hex(fg), size: +size.toFixed(1), weight: s.fontWeight, large, required: req,
          family: s.fontFamily.split(',')[0].replace(/["']/g, ''), rect: H.box(e) };

        // Text sitting over a positioned image or video is a backdrop too.
        if (!backdrop) {
          const cx = r.x + Math.min(r.width, 40) / 2, cy = r.y + r.height / 2;
          if (cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight) {
            const stack = document.elementsFromPoint(cx, cy);
            const idx = stack.indexOf(e);
            const behind = idx >= 0 ? stack.slice(idx + 1) : [];
            const media = behind.find(x => (x.tagName === 'IMG' || x.tagName === 'VIDEO' || x.tagName === 'PICTURE' || x.tagName === 'CANVAS') && !e.contains(x));
            if (media) {
              // Only if nothing opaque sits between the text and the media
              const between = behind.slice(0, behind.indexOf(media));
              const opaque = between.some(x => H.rgb(getComputedStyle(x).backgroundColor));
              if (!opaque) { out.push({ ...base, backdrop: { kind: media.tagName === 'VIDEO' ? 'video' : 'image', sel: H.selOf(media), value: (media.currentSrc || media.src || '').split('/').pop().slice(0, 60) }, method: 'pixel-pending' }); return; }
            }
          }
        }
        if (backdrop) { out.push({ ...base, backdrop, method: 'pixel-pending' }); return; }
        const ratio = H.contrast(fg, bg);
        if (ratio < req) out.push({ ...base, background: H.hex(bg), ratio, method: 'computed', pass: false });
      });

      // --- icons: SVGs in controls with no text -----------------------------
      const icons = [];
      document.querySelectorAll('button svg, a[href] svg, [role=button] svg, button i[class*=icon], a[href] i[class*=icon]').forEach(sv => {
        if (icons.length >= 30) return;
        const c = sv.closest('button,a[href],[role=button]');
        if (!c || !H.visible(c) || H.textOf(c).length > 1) return;   // icon beside a label is not the only cue
        const r = sv.getBoundingClientRect(); if (r.width < 8) return;
        const s = getComputedStyle(sv);
        let col = null;
        const fillAttr = sv.getAttribute('fill');
        const fill = s.fill && s.fill !== 'none' ? H.rgb(s.fill) : null;
        const stroke = s.stroke && s.stroke !== 'none' ? H.rgb(s.stroke) : null;
        col = fill || stroke || H.rgb(s.color);
        if (fillAttr === 'currentColor' || !fill) col = H.rgb(s.color) || col;
        // If paths carry their own fills, take the first opaque one.
        const p = sv.querySelector('path[fill]:not([fill=none]):not([fill=currentColor]),circle[fill]:not([fill=none])');
        if (p) { const pc = H.rgb(getComputedStyle(p).fill); if (pc) col = pc; }
        if (!col) return;
        const { bg, backdrop } = H.bgOf(sv);
        if (backdrop || !bg) return;
        const ratio = H.contrast(col, bg);
        if (ratio < 3) icons.push({ sel: H.selOf(c), path: H.pathOf(c), rect: H.box(c), snippet: H.snippet(c), name: H.accName(c).slice(0, 50), foreground: H.hex(col), background: H.hex(bg), ratio, required: 3 });
      });

      // --- input borders ---------------------------------------------------
      const inputBorders = [];
      document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=submit]):not([type=button]),select,textarea').forEach(f => {
        if (inputBorders.length >= 20 || !H.visible(f) || f.matches(':disabled')) return;
        const s = getComputedStyle(f);
        const bw = Math.max(parseFloat(s.borderTopWidth) || 0, parseFloat(s.borderBottomWidth) || 0);
        const bc = bw > 0 && s.borderBottomStyle !== 'none' ? (H.rgb(s.borderBottomColor) || H.rgb(s.borderTopColor)) : null;
        const own = H.rgb(s.backgroundColor);
        const around = H.bgOf(f.parentElement || document.body);
        if (!around.bg) return;
        // A filled field distinguished by its own background passes on that instead.
        const fillRatio = own ? H.contrast(own, around.bg) : null;
        if (fillRatio && fillRatio >= 3) return;
        const shadow = s.boxShadow && s.boxShadow !== 'none' ? H.rgb((s.boxShadow.match(/rgba?\([^)]+\)/) || [])[0]) : null;
        const edge = bc || shadow;
        if (!edge) { inputBorders.push({ sel: H.selOf(f), path: H.pathOf(f), rect: H.box(f), snippet: H.snippet(f), type: f.type || f.tagName.toLowerCase(), border: null, background: H.hex(around.bg), ratio: fillRatio || 1, required: 3, note: 'no border and no distinguishing fill' }); return; }
        const ratio = H.contrast(edge, around.bg);
        if (ratio < 3) inputBorders.push({ sel: H.selOf(f), path: H.pathOf(f), rect: H.box(f), snippet: H.snippet(f), type: f.type || f.tagName.toLowerCase(), border: H.hex(edge), background: H.hex(around.bg), ratio, required: 3, width: bw });
      });
      // Checkboxes and radios: the box edge itself (native ones are drawn by the browser and pass).
      document.querySelectorAll('input[type=checkbox],input[type=radio]').forEach(f => {
        if (inputBorders.length >= 25 || !H.visible(f)) return;
        const s = getComputedStyle(f);
        if (s.appearance !== 'none' && s.webkitAppearance !== 'none') return;
        const bc = H.rgb(s.borderBottomColor);
        const around = H.bgOf(f.parentElement || document.body);
        if (!bc || !around.bg) return;
        const ratio = H.contrast(bc, around.bg);
        if (ratio < 3) inputBorders.push({ sel: H.selOf(f), path: H.pathOf(f), rect: H.box(f), snippet: H.snippet(f), type: f.type, border: H.hex(bc), background: H.hex(around.bg), ratio, required: 3 });
      });

      // --- links distinguished by color alone ------------------------------
      const linksColorOnly = [];
      document.querySelectorAll('p a[href], li a[href], td a[href], dd a[href], blockquote a[href], figcaption a[href]').forEach(a => {
        if (linksColorOnly.length >= 20 || !H.visible(a) || H.isSkipped(a)) return;
        const parent = a.parentElement;
        if (!parent || parent.closest('nav,[role=navigation],footer,header,[role=list] > li:only-child,.menu,.nav')) return;
        // Must be inline within a sentence: parent has meaningful own text.
        const ownText = [...parent.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim().length > 2).map(n => n.textContent.trim()).join(' ');
        if (ownText.length < 15) return;
        if (a.querySelector('img,svg') || !H.textOf(a)) return;
        const s = getComputedStyle(a);
        const deco = (s.textDecorationLine || s.textDecoration || '');
        if (/underline|overline|line-through/.test(deco)) return;
        if (s.borderBottomStyle !== 'none' && parseFloat(s.borderBottomWidth) > 0) return;
        const bs = s.boxShadow && s.boxShadow !== 'none';
        if (bs) return;
        const abg = H.rgb(s.backgroundImage !== 'none' ? '' : s.backgroundColor);
        const pbgInfo = H.bgOf(parent);
        if (abg && pbgInfo.bg && H.contrast(abg, pbgInfo.bg) >= 3) return;
        const fg = H.rgb(s.color), pfg = H.rgb(getComputedStyle(parent).color);
        if (!fg || !pfg) return;
        const bold = parseInt(s.fontWeight, 10) >= 700 && parseInt(getComputedStyle(parent).fontWeight, 10) < 700;
        const ratio = H.contrast(fg, pfg);
        if (ratio < 3 || (ratio >= 3 && !bold && s.fontStyle === getComputedStyle(parent).fontStyle && false)) {
          linksColorOnly.push({ sel: H.selOf(a), path: H.pathOf(a), rect: H.box(a), snippet: H.snippet(a), text: H.textOf(a).slice(0, 50), link: H.hex(fg), text_color: H.hex(pfg), ratio, required: 3, bold });
        }
      });

      return { sampled, candidates: out, icons, inputBorders, linksColorOnly };
    }, level);

    const computed = found.candidates.filter(c => c.method === 'computed');
    const overArt = found.candidates.filter(c => c.method === 'pixel-pending');
    const measured = [];

    if (overArt.length) {
      await page.addStyleTag({ content: HIDE_GLYPHS });
      await sleep(300);
      // Group by backdrop element: the same hero measured once per distinct text box, up to a budget.
      for (const c of overArt.slice(0, ctx.maxPixelSamples || 80)) {
        try {
          if (!c.rect || c.rect[2] < 4 || c.rect[3] < 4) continue;
          const clip = { x: Math.max(0, c.rect[0]), y: Math.max(0, c.rect[1]), width: Math.max(4, Math.min(c.rect[2], 1600)), height: Math.max(4, Math.min(c.rect[3], 800)) };
          const buf = await page.screenshot({ clip, captureBeyondViewport: true });
          const pixels = png.decode(buf);
          if (!pixels) continue;
          const stats = png.extremes(pixels);
          const worst = [stats.lightest, stats.darkest]
            .map(bg => ({ bg, ratio: contrast(c.foreground, bg) }))
            .filter(x => x.ratio !== null).sort((a, b) => a.ratio - b.ratio)[0];
          if (!worst) continue;
          measured.push({ ...c, method: 'pixel', background: toHex(worst.bg),
            backgroundRange: { lightest: toHex(stats.lightest), darkest: toHex(stats.darkest), spread: stats.spread },
            ratio: worst.ratio, pass: worst.ratio >= c.required });
        } catch (e) { /* off-screen or zero-sized; skip */ }
      }
      await page.evaluate(() => {
        [...document.querySelectorAll('style')].filter(s => s.textContent.includes('-webkit-text-fill-color:transparent !important')).forEach(s => s.remove());
      });
      await sleep(150);
    }

    // ::selection rules come from the document module; computed here so the
    // color maths lives in one place.
    const selection = (ctx.selectionRules || []).map(r => {
      const fg = r.color, bg = r.backgroundColor;
      const ratio = (fg && bg) ? contrast(fg, bg) : null;
      return { ...r, ratio, required: 4.5, pass: ratio === null ? null : ratio >= 4.5 };
    }).filter(r => r.ratio !== null && !r.pass);

    return {
      level, sampled: found.sampled,
      solid: computed,
      overArt: measured.filter(m => !m.pass),
      overArtChecked: measured.length, overArtSkipped: Math.max(0, overArt.length - measured.length),
      icons: found.icons, inputBorders: found.inputBorders, linksColorOnly: found.linksColorOnly, selection
    };
  }
};
