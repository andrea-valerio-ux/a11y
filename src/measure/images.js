'use strict';
// Images and graphics: alt attributes, decorative markers, complex graphics
// that need a long description, and likely images of text.
module.exports = {
  id: 'images',
  label: 'images and text alternatives',
  async collect(page) {
    return page.evaluate(() => {
      const H = window.__a11y;
      const cap = (arr, n = 25) => arr.slice(0, n);
      const imgs = [...document.querySelectorAll('img, input[type=image], [role=img], svg, canvas, picture > img, object[type^="image"]')]
        .filter(e => !H.isSkipped(e) || e.tagName === 'svg');

      const fileName = i => ((i.currentSrc || i.src || i.getAttribute('src') || i.getAttribute('data') || '').split('?')[0].split('/').pop() || '').slice(0, 70);
      const isDecorativeMarked = i => i.getAttribute('role') === 'presentation' || i.getAttribute('role') === 'none' || i.getAttribute('aria-hidden') === 'true';
      const PLACEHOLDER = /^(image|img|photo|picture|pic|icon|graphic|spacer|banner|logo|thumbnail|thumb|placeholder|untitled|dsc|screenshot|screen shot)[\s\-_]*\d*$/i;
      const FILEISH = /\.(jpe?g|png|webp|gif|svg|avif|bmp|tiff?)$/i;

      const missingAlt = [], badAlt = [], complex = [], logoLike = [], svgNoName = [], areaMissing = [];

      imgs.forEach(e => {
        const tag = e.tagName.toLowerCase();
        const rect = H.box(e);
        const base = { sel: H.selOf(e), path: H.pathOf(e), rect, src: fileName(e), snippet: H.snippet(e) };
        const w = rect ? rect[2] : 0, h = rect ? rect[3] : 0;
        const linkEl = e.closest('a[href],button');
        const inLink = !!linkEl;
        const linkName = inLink ? H.textOf(linkEl) : '';

        if (tag === 'img' || (tag === 'input' && e.type === 'image')) {
          if (!e.hasAttribute('alt') && tag === 'img') {
            if (isDecorativeMarked(e)) return;                       // role=presentation is an acceptable decorative marker
            if (H.visible(e) || w > 0) missingAlt.push(base); else missingAlt.push({ ...base, hidden: true });
            return;
          }
          if (tag === 'input' && !(e.alt || '').trim() && !e.getAttribute('aria-label')) { missingAlt.push({ ...base, kind: 'image button' }); return; }
          const alt = (e.getAttribute('alt') || '').trim();
          if (alt) {
            if (FILEISH.test(alt) || /^[\w-]+\.(jpe?g|png|webp|gif|svg)/i.test(alt)) badAlt.push({ ...base, alt: alt.slice(0, 80), reason: 'filename' });
            else if (PLACEHOLDER.test(alt)) badAlt.push({ ...base, alt: alt.slice(0, 80), reason: 'placeholder word' });
            else if (inLink && linkName && linkName.replace(/\s+/g, ' ').toLowerCase().includes(alt.toLowerCase()) && alt.length > 3 && linkName.length > alt.length) {
              badAlt.push({ ...base, alt: alt.slice(0, 80), reason: 'repeats link text' });
            }
            else if (/^(image|photo|picture|graphic) of\b/i.test(alt)) badAlt.push({ ...base, alt: alt.slice(0, 80), reason: 'starts with "image of"' });
          } else if (isDecorativeMarked(e) === false && inLink && !H.accName(linkEl)) {
            // Empty alt on the only content of a link: the link has no name.
            badAlt.push({ ...base, alt: '', reason: 'empty alt on a link\'s only content' });
          }
          // Complex graphics: big, or named like a chart, with no long description.
          const looksComplex = (w >= 400 && h >= 250) || /\b(chart|graph|diagram|map|infographic|plot|flowchart|timeline)s?\b/i.test(alt + ' ' + base.src);
          if (alt && looksComplex && H.visible(e)) {
            const fig = e.closest('figure');
            const described = e.getAttribute('aria-describedby') || e.getAttribute('longdesc') || (fig && fig.querySelector('figcaption') && H.textOf(fig.querySelector('figcaption')).length > 20) || (e.closest('details'));
            if (!described) complex.push({ ...base, alt: alt.slice(0, 80), kind: 'img', size: w + 'x' + h });
          }
          // Likely image of text: logos and banners
          if (H.visible(e) && (inLink && e.closest('header,[role=banner],nav') || /logo|brand|banner|badge/i.test(alt + ' ' + base.src + ' ' + (e.className || '')) || (w > 200 && h > 0 && w / h > 3))) {
            if (logoLike.length < 10) logoLike.push({ ...base, alt: alt.slice(0, 80), size: w + 'x' + h });
          }
          return;
        }

        if (tag === 'svg') {
          if (e.closest('button,a[href],[role=button]') && (H.accName(e.closest('button,a[href],[role=button]')))) return; // named by the control
          if (e.getAttribute('aria-hidden') === 'true' || e.getAttribute('role') === 'presentation' || e.getAttribute('focusable') === 'false' && !e.getAttribute('role')) return;
          if (!H.visible(e) || w < 12) return;
          const named = e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || (e.querySelector(':scope > title') && e.querySelector(':scope > title').textContent.trim());
          if (e.getAttribute('role') === 'img' && !named) svgNoName.push({ ...base, kind: 'svg role=img' });
          else if (!named && !e.getAttribute('role') && w >= 100 && h >= 60 && !e.closest('a,button')) {
            svgNoName.push({ ...base, kind: 'svg graphic with no role or name' });
          }
          if (named && w >= 300 && h >= 200 && !e.getAttribute('aria-describedby') && !e.querySelector(':scope > desc')) complex.push({ ...base, kind: 'svg', size: w + 'x' + h });
          return;
        }

        if (tag === 'canvas') {
          if (!H.visible(e) || w < 50) return;
          const named = e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || H.textOf(e);
          if (!named) svgNoName.push({ ...base, kind: 'canvas with no fallback content or name' });
          else if (w >= 300 && !e.getAttribute('aria-describedby')) complex.push({ ...base, kind: 'canvas', size: w + 'x' + h });
          return;
        }

        if (e.getAttribute('role') === 'img' && tag !== 'svg') {
          if (!H.accName(e) && H.visible(e)) svgNoName.push({ ...base, kind: 'role=img with no name' });
        }
      });

      document.querySelectorAll('map area').forEach(a => {
        if (!(a.getAttribute('alt') || '').trim() && !a.getAttribute('aria-label')) areaMissing.push({ sel: H.selOf(a), path: H.pathOf(a), rect: null, href: (a.getAttribute('href') || '').slice(0, 60) });
      });

      // Background images used as content inside links/buttons with no text.
      const bgIcons = [];
      document.querySelectorAll('a[href],button,[role=button]').forEach(c => {
        if (bgIcons.length >= 15 || !H.visible(c) || H.textOf(c)) return;
        if (c.querySelector('img,svg,[role=img]') || H.accName(c)) return;
        const s = getComputedStyle(c), b = getComputedStyle(c, '::before'), a = getComputedStyle(c, '::after');
        const hasBg = [s, b, a].some(x => (x.backgroundImage && x.backgroundImage !== 'none') || (x.maskImage && x.maskImage !== 'none') || (x.webkitMaskImage && x.webkitMaskImage !== 'none'));
        if (hasBg) bgIcons.push({ sel: H.selOf(c), path: H.pathOf(c), rect: H.box(c) });
      });

      return { total: imgs.length, imgCount: document.querySelectorAll('img').length,
        missingAlt: cap(missingAlt, 40), badAlt: cap(badAlt), complex: cap(complex, 10), logoLike, svgNoName: cap(svgNoName), areaMissing: cap(areaMissing, 10), bgIcons };
    });
  }
};
