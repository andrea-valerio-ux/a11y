'use strict';
// Page-level facts: language, title, viewport, refresh, ids, tab order
// attributes, title tooltips, landmarks, skip link, and stylesheet facts.
module.exports = {
  id: 'document',
  label: 'language, title, landmarks and global code',
  async collect(page) {
    return page.evaluate(() => {
      const H = window.__a11y;
      const cap = (arr, n = 25) => arr.slice(0, n);

      // --- language and title ------------------------------------------
      const lang = document.documentElement.getAttribute('lang');
      const langValid = !!lang && /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(lang.trim());
      const title = (document.title || '').trim();

      // --- viewport ----------------------------------------------------
      const vp = document.querySelector('meta[name="viewport"]');
      const vpContent = vp ? (vp.getAttribute('content') || '') : null;
      let userScalableNo = false, maxScale = null;
      if (vpContent) {
        userScalableNo = /user-scalable\s*=\s*(no|0)/i.test(vpContent);
        const m = /maximum-scale\s*=\s*([\d.]+)/i.exec(vpContent);
        if (m) maxScale = parseFloat(m[1]);
      }

      // --- meta refresh --------------------------------------------------
      const refresh = document.querySelector('meta[http-equiv="refresh" i]');

      // --- duplicate ids -------------------------------------------------
      const ids = new Map();
      document.querySelectorAll('[id]').forEach(e => {
        if (H.isSkipped(e)) return;
        const k = e.id; if (!ids.has(k)) ids.set(k, []); ids.get(k).push(e);
      });
      const dupIds = [];
      for (const [id, els] of ids) if (els.length > 1) {
        const referenced = !!document.querySelector('[for="' + CSS.escape(id) + '"],[aria-labelledby~="' + CSS.escape(id) + '"],[aria-describedby~="' + CSS.escape(id) + '"],[aria-controls~="' + CSS.escape(id) + '"],a[href="#' + CSS.escape(id) + '"]');
        dupIds.push({ id, count: els.length, referenced, sel: H.selOf(els[1]), path: H.pathOf(els[1]), rect: H.box(els[1]) || H.box(els[0]) });
      }

      // --- nested interactive ------------------------------------------
      const nested = [];
      document.querySelectorAll('a[href],button,[role=button],[role=link]').forEach(e => {
        const inner = e.querySelector('a[href],button,[role=button],[role=link],input,select,textarea');
        if (inner) nested.push({ sel: H.selOf(e), path: H.pathOf(e), rect: H.box(e), inner: H.selOf(inner), snippet: H.snippet(e) });
      });

      // --- tabindex and autofocus ----------------------------------------
      const tabindexPositive = [], tabindexZero = [];
      document.querySelectorAll('[tabindex]').forEach(e => {
        const v = parseInt(e.getAttribute('tabindex'), 10);
        if (isNaN(v)) return;
        if (v > 0) tabindexPositive.push({ sel: H.selOf(e), path: H.pathOf(e), rect: H.box(e), tabindex: v, name: H.accName(e).slice(0, 60) });
        else if (v === 0 && !e.matches('a[href],button,input,select,textarea,summary,[role],[contenteditable]')
                 && !e.matches('div[role=dialog] *') && e.tagName !== 'MAIN') {
          // A focusable region for scrolling is fine; a focusable paragraph is not.
          const s = getComputedStyle(e);
          const scrolls = (s.overflowY === 'auto' || s.overflowY === 'scroll' || s.overflowX === 'auto' || s.overflowX === 'scroll');
          if (!scrolls) tabindexZero.push({ sel: H.selOf(e), path: H.pathOf(e), rect: H.box(e), text: H.textOf(e).slice(0, 60) });
        }
      });
      const autofocus = [...document.querySelectorAll('[autofocus]')].map(e => ({ sel: H.selOf(e), path: H.pathOf(e), rect: H.box(e) }));

      // --- title attribute -----------------------------------------------
      const titleOnly = [], titleInfo = [];
      document.querySelectorAll('[title]').forEach(e => {
        if (e.tagName === 'IFRAME' || H.isSkipped(e) || e.closest('svg')) return;
        const t = (e.getAttribute('title') || '').trim();
        if (!t) return;
        if (H.isInteractive(e) || e.tagName === 'IMG') {
          if (H.nameFromTitleOnly(e)) titleOnly.push({ sel: H.selOf(e), path: H.pathOf(e), rect: H.box(e), title: t.slice(0, 80) });
          else if (H.visible(e) && t.toLowerCase() !== H.accName(e).toLowerCase()) titleInfo.push({ sel: H.selOf(e), path: H.pathOf(e), rect: H.box(e), title: t.slice(0, 80) });
        } else if (H.visible(e) && t.length > 2) {
          if (e.tagName === 'ABBR') return; // the one legitimate expansion use
          titleInfo.push({ sel: H.selOf(e), path: H.pathOf(e), rect: H.box(e), title: t.slice(0, 80) });
        }
      });

      // --- iframes -------------------------------------------------------
      const iframes = [...document.querySelectorAll('iframe')];
      const untitledIframes = iframes.filter(f => !(f.getAttribute('title') || '').trim() && !(f.getAttribute('aria-label') || '').trim() && H.visible(f))
        .map(f => ({ sel: H.selOf(f), path: H.pathOf(f), rect: H.box(f), src: (f.src || '').slice(0, 100) }));

      // --- landmarks -----------------------------------------------------
      const q = s => [...document.querySelectorAll(s)];
      const mains = q('main,[role=main]');
      const navs = q('nav,[role=navigation]');
      const landmarks = {
        main: mains.length, nav: navs.length,
        banner: q('header:not(article header):not(section header),[role=banner]').length,
        contentinfo: q('footer:not(article footer):not(section footer),[role=contentinfo]').length,
        outside: [], navWithoutList: []
      };
      const LM = 'main,[role=main],nav,[role=navigation],header,[role=banner],footer,[role=contentinfo],aside,[role=complementary],section[aria-label],section[aria-labelledby],[role=region][aria-label],form[aria-label],[role=search],[role=dialog],dialog';
      if (mains.length) {
        // Blocks of real text that sit in no landmark at all.
        q('p,h1,h2,h3,h4,h5,h6,li,td').forEach(e => {
          if (landmarks.outside.length >= 8) return;
          if (e.closest(LM) || H.isSkipped(e) || !H.visible(e)) return;
          const t = H.textOf(e);
          if (t.length < 40) return;
          landmarks.outside.push({ sel: H.selOf(e), path: H.pathOf(e), rect: H.box(e), text: t.slice(0, 70) });
        });
      }
      navs.forEach(n => {
        const links = n.querySelectorAll('a[href]').length;
        if (links >= 3 && !n.querySelector('ul,ol,[role=list],[role=menubar],[role=menu],[role=tablist]')) {
          landmarks.navWithoutList.push({ sel: H.selOf(n), path: H.pathOf(n), rect: H.box(n), links });
        }
      });
      // A menu of links that is not inside any nav.
      landmarks.menuOutsideNav = [];
      if (!navs.length) {
        q('ul,ol').forEach(l => {
          if (landmarks.menuOutsideNav.length >= 3) return;
          if (l.closest('nav,[role=navigation],footer,[role=contentinfo]')) return;
          const items = [...l.children].filter(c => c.tagName === 'LI');
          if (items.length >= 4 && items.every(li => li.querySelector('a[href]') && H.textOf(li).length < 40) && H.visible(l)) {
            landmarks.menuOutsideNav.push({ sel: H.selOf(l), path: H.pathOf(l), rect: H.box(l), links: items.length });
          }
        });
      }

      // --- skip link -----------------------------------------------------
      // The first in-page link in document order, before the main content.
      let skipLink = null;
      const firstInPage = [...document.querySelectorAll('a[href^="#"]')].find(a => {
        const href = a.getAttribute('href');
        return href && href.length > 1 && !mains.some(m => m.contains(a));
      });
      if (firstInPage) {
        const targetId = decodeURIComponent(firstInPage.getAttribute('href').slice(1));
        const target = document.getElementById(targetId) || document.querySelector('[name="' + CSS.escape(targetId) + '"]');
        skipLink = { sel: H.selOf(firstInPage), path: H.pathOf(firstInPage), rect: H.box(firstInPage),
          text: (H.accName(firstInPage) || '').slice(0, 60), href: firstInPage.getAttribute('href'),
          targetExists: !!target,
          targetIsMainish: !!target && (target.matches('main,[role=main],#main,#content,#main-content') || mains.some(m => m === target || m.contains(target) || target.contains(m))),
          looksLikeSkip: /skip|jump|main|content|navigation|nav/i.test(H.accName(firstInPage) || '') };
      }

      // --- stylesheet facts ----------------------------------------------
      let reducedMotionRules = 0;
      const selection = [];
      let portraitOnlyRules = 0;
      const walk = rules => {
        for (const r of rules) {
          try {
            if (r.media || r.conditionText !== undefined) {
              const cond = r.conditionText || (r.media && r.media.mediaText) || '';
              if (/prefers-reduced-motion/.test(cond)) reducedMotionRules++;
              if (/orientation\s*:\s*(portrait|landscape)/.test(cond)) {
                for (const inner of r.cssRules || []) {
                  if (inner.style && inner.style.display === 'none' && /body|main|html|#app|#root|\.app/.test(inner.selectorText || '')) portraitOnlyRules++;
                }
              }
              if (r.cssRules) walk(r.cssRules);
            } else if (r.selectorText && /::?selection/.test(r.selectorText)) {
              selection.push({ selector: r.selectorText.slice(0, 80), color: r.style.color || null, backgroundColor: r.style.backgroundColor || r.style.background || null });
            }
          } catch (e) { /* skip */ }
        }
      };
      for (const ss of document.styleSheets) { try { walk(ss.cssRules); } catch (e) { /* cross-origin */ } }

      let orientationLockCalls = 0;
      document.querySelectorAll('script:not([src])').forEach(s => { if (/orientation\.lock\s*\(/.test(s.textContent)) orientationLockCalls++; });

      return {
        lang, langValid, title,
        viewport: { content: vpContent, userScalableNo, maxScale },
        metaRefresh: refresh ? { content: refresh.getAttribute('content'), sel: 'meta[http-equiv=refresh]' } : null,
        dupIds: cap(dupIds), nestedInteractive: cap(nested),
        tabindexPositive: cap(tabindexPositive), tabindexZero: cap(tabindexZero, 15), autofocus,
        titleOnly: cap(titleOnly), titleInfo: cap(titleInfo, 15),
        iframes: { total: iframes.length, untitled: cap(untitledIframes) },
        landmarks, skipLink,
        reducedMotionRules, selection, orientation: { lockCalls: orientationLockCalls, portraitOnlyRules }
      };
    });
  }
};
