'use strict';
// Content structure: headings, lists, text alignment, reading level and
// instructions that rely on the senses.
module.exports = {
  id: 'content',
  label: 'headings, lists, alignment and reading level',
  async collect(page) {
    return page.evaluate(() => {
      const H = window.__a11y;
      const cap = (arr, n = 25) => arr.slice(0, n);

      // --- headings ------------------------------------------------------
      const hEls = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')].filter(e => !H.isSkipped(e));
      const levelOf = e => e.matches('[role=heading]') ? (parseInt(e.getAttribute('aria-level'), 10) || 2) : +e.tagName[1];
      const list = hEls.map(e => ({ level: levelOf(e), text: H.textOf(e).slice(0, 80), sel: H.selOf(e), path: H.pathOf(e),
        rect: H.box(e), empty: !H.accName(e) && !e.querySelector('img[alt]:not([alt=""])'), visible: H.visible(e) }));
      const h1Count = list.filter(h => h.level === 1).length;

      const skips = [], sequence = [];
      let seen = new Set();
      for (let i = 0; i < list.length; i++) {
        const h = list[i];
        if (i === 0 && h.level !== 1) sequence.push({ ...h, reason: 'The first heading on the page is an h' + h.level + ', not an h1.' });
        if (i > 0 && h.level - list[i - 1].level > 1) skips.push({ from: list[i - 1].level, to: h.level, at: h.text.slice(0, 50), sel: h.sel, path: h.path, rect: h.rect });
        if (h.level > 2 && !seen.has(h.level - 1) && i > 0 && list[i - 1].level < h.level - 1) {
          sequence.push({ ...h, reason: 'An h' + h.level + ' appears before any h' + (h.level - 1) + '.' });
        }
        seen.add(h.level);
      }

      // Text that looks like a heading but is not one: short, large or bold,
      // block-level, followed by more content.
      const bodySize = parseFloat(getComputedStyle(document.body).fontSize) || 16;
      const fake = [];
      document.querySelectorAll('p,div,span,strong,b').forEach(e => {
        if (fake.length >= 15 || H.isSkipped(e) || !H.visible(e)) return;
        if (e.closest('h1,h2,h3,h4,h5,h6,[role=heading],a,button,nav,label,li,td,th,figcaption,blockquote,[aria-hidden="true"]')) return;
        const own = [...e.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
        if (!own || own.length > 70 || own.length < 3 || /[.!?:;,]$/.test(own)) return;
        if (e.children.length > 1) return;
        const s = getComputedStyle(e);
        const size = parseFloat(s.fontSize);
        const big = size >= bodySize * 1.4;
        const bold = parseInt(s.fontWeight, 10) >= 600 && size >= bodySize * 1.15;
        if (!(big || bold)) return;
        if (!/^(block|flex|grid|list-item|table-cell)/.test(s.display) && e.tagName !== 'SPAN') return;
        if (e.tagName === 'SPAN' && !/^(block|flex)/.test(s.display)) return;
        const next = e.nextElementSibling;
        if (!next || !H.textOf(next) || H.textOf(next).length < 60) return;
        fake.push({ sel: H.selOf(e), path: H.pathOf(e), rect: H.box(e), text: own.slice(0, 70), size: Math.round(size), weight: s.fontWeight });
      });

      // --- lists ---------------------------------------------------------
      const lists = { siblingAnchors: [], fakeBullets: [], orphanLi: [], singleItem: [] };
      document.querySelectorAll('div,section,span,p,footer,header,aside').forEach(c => {
        if (lists.siblingAnchors.length >= 10 || H.isSkipped(c) || !H.visible(c)) return;
        if (c.closest('ul,ol,dl,[role=list],[role=menubar],[role=menu],[role=tablist],[role=listbox],table,nav[aria-label*=breadcrumb i],[aria-label*=pagination i],[role=navigation][aria-label*=pag i]')) return;
        const kids = [...c.children];
        if (kids.length < 3) return;
        const anchors = kids.filter(k => k.tagName === 'A' && k.hasAttribute('href'));
        // All children are links, or all but one non-link separator
        if (anchors.length >= 3 && anchors.length >= kids.length - 1) {
          // Skip inline runs of links within a sentence
          const hasText = [...c.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 10);
          if (hasText) return;
          lists.siblingAnchors.push({ sel: H.selOf(c), path: H.pathOf(c), rect: H.box(c), count: anchors.length, sample: anchors.slice(0, 3).map(a => H.accName(a).slice(0, 30)) });
        }
      });
      const BULLET = /^\s*([•·▪◦‣\-–*]|\d+[.)])\s+\S/;
      document.querySelectorAll('p,div,span,br').forEach(e => {
        if (lists.fakeBullets.length >= 10 || H.isSkipped(e)) return;
        if (e.tagName === 'BR') {
          const n = e.nextSibling;
          if (n && n.nodeType === 3 && BULLET.test(n.textContent) && e.parentElement && !e.parentElement.closest('li,pre,code')) {
            const p = e.parentElement;
            if (!lists.fakeBullets.some(x => x.path === H.pathOf(p))) lists.fakeBullets.push({ sel: H.selOf(p), path: H.pathOf(p), rect: H.box(p), text: n.textContent.trim().slice(0, 60) });
          }
          return;
        }
        if (e.closest('li,pre,code,ul,ol,dl') || !H.visible(e)) return;
        const own = [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('');
        if (!BULLET.test(own)) return;
        // Needs a sibling that also starts with a bullet to be a list.
        const sib = e.nextElementSibling;
        if (!sib || sib.tagName !== e.tagName) return;
        const sibOwn = [...sib.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('');
        if (!BULLET.test(sibOwn)) return;
        if (!lists.fakeBullets.some(x => x.path === H.pathOf(e))) lists.fakeBullets.push({ sel: H.selOf(e), path: H.pathOf(e), rect: H.box(e), text: own.trim().slice(0, 60) });
      });
      document.querySelectorAll('li').forEach(li => {
        if (lists.orphanLi.length >= 10) return;
        const p = li.parentElement;
        if (p && !p.matches('ul,ol,menu,[role=list],[role=menu],[role=menubar],[role=listbox],[role=tablist]')) {
          lists.orphanLi.push({ sel: H.selOf(li), path: H.pathOf(li), rect: H.box(li), parent: H.selOf(p) });
        }
      });

      // --- text alignment -------------------------------------------------
      const alignment = [];
      const dir = (document.documentElement.getAttribute('dir') || getComputedStyle(document.documentElement).direction || 'ltr').toLowerCase();
      document.querySelectorAll('p,li,dd,blockquote,div').forEach(e => {
        if (alignment.length >= 15 || H.isSkipped(e) || !H.visible(e)) return;
        const own = [...e.childNodes].filter(n => n.nodeType === 3 || n.nodeType === 1 && /^(A|EM|STRONG|B|I|SPAN|CODE|ABBR)$/.test(n.tagName)).map(n => n.textContent).join(' ').trim();
        if (own.length < 150) return;
        const s = getComputedStyle(e);
        const ta = s.textAlign;
        const bad = ta === 'justify' || ta === 'center' || (dir === 'ltr' && (ta === 'right' || ta === 'end')) || (dir === 'rtl' && (ta === 'left' || ta === 'start'));
        if (!bad) return;
        alignment.push({ sel: H.selOf(e), path: H.pathOf(e), rect: H.box(e), align: ta, chars: own.length, text: own.slice(0, 70) });
      });

      // --- reading level --------------------------------------------------
      const paras = [...document.querySelectorAll('main p, article p, [role=main] p, p')].filter(p => H.visible(p) && !H.isSkipped(p) && !p.closest('nav,footer,header,aside'));
      const text = paras.map(H.textOf).filter(t => t.length > 40).join(' ').slice(0, 20000);
      const sentences = Math.max(1, (text.match(/[.!?]+(\s|$)/g) || []).length);
      const wordsArr = text.split(/\s+/).filter(w => /[a-zA-Z]/.test(w));
      const words = wordsArr.length;
      const syllable = w => {
        w = w.toLowerCase().replace(/[^a-z]/g, '');
        if (!w) return 0;
        if (w.length <= 3) return 1;
        w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
        const m = w.match(/[aeiouy]{1,2}/g);
        return m ? m.length : 1;
      };
      const syllables = wordsArr.reduce((n, w) => n + syllable(w), 0);
      const grade = words > 100 ? +((0.39 * (words / sentences)) + (11.8 * (syllables / words)) - 15.59).toFixed(1) : null;
      const readability = { words, sentences, syllables, grade, wordsPerSentence: words ? +(words / sentences).toFixed(1) : 0,
        sample: text.slice(0, 160), longSentences: 0, rect: paras[0] ? H.box(paras[0]) : null, sel: paras[0] ? H.selOf(paras[0]) : null };
      readability.longSentences = (text.match(/[^.!?]{180,}[.!?]/g) || []).length;

      // --- sensory instructions -------------------------------------------
      const SENSORY = /\b(click|press|select|tap|use|see|find|choose)\b[^.]{0,40}\b(the\s+)?(red|green|blue|yellow|orange|purple|gray|gray)\s+(button|link|icon|box|text|tab)|\b(on|to|at)\s+the\s+(left|right)(\s+(side|hand side|column))?\b|\b(above|below)\s+(the\s+)?(button|link|image|form|field)\b|\b(round|square|circular)\s+(button|icon)\b|\bafter the (tone|beep|sound)\b|\bwhen you hear\b/i;
      const sensory = [];
      document.querySelectorAll('p,li,td,label,span,div').forEach(e => {
        if (sensory.length >= 10 || H.isSkipped(e) || !H.visible(e)) return;
        const own = [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ');
        const m = SENSORY.exec(own);
        if (!m) return;
        sensory.push({ sel: H.selOf(e), path: H.pathOf(e), rect: H.box(e), phrase: m[0].slice(0, 60), text: own.trim().slice(0, 120) });
      });

      return {
        headings: { total: list.length, h1Count, list: cap(list, 80), skips: cap(skips), sequence: cap(sequence, 10),
                    empty: cap(list.filter(h => h.empty)), fake: cap(fake) },
        lists, alignment: cap(alignment), readability, sensory
      };
    });
  }
};
