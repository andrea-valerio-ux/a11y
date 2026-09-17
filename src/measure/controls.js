'use strict';
// Links and buttons: names, generic text, duplicates, new windows, fake
// links and fake buttons, and icons that vanish in forced-colors mode.
module.exports = {
  id: 'controls',
  label: 'links and buttons',
  async collect(page) {
    return page.evaluate(() => {
      const H = window.__a11y;
      const cap = (arr, n = 25) => arr.slice(0, n);
      const entry = (e, extra) => ({ sel: H.selOf(e), path: H.pathOf(e), rect: H.box(e), snippet: H.snippet(e), name: H.accName(e).slice(0, 60), ...extra });

      const GENERIC = /^(read more|learn more|more|click here|click|here|discover more|explore|see more|see all|view all|find out more|link|details|view|more info|more information|continue|go|download|open|start|this|this page|website|watch|listen|read|info|button|submit|>|→|»|\.\.\.|…)\.?$/i;

      const links = [...document.querySelectorAll('a[href]')].filter(a => !H.isSkipped(a) && H.visible(a) && !H.inAriaHidden(a));
      const unnamed = [], generic = [], newWindow = [], byText = new Map();
      links.forEach(a => {
        const name = H.accName(a);
        if (!name) { unnamed.push(entry(a, { href: (a.getAttribute('href') || '').slice(0, 80) })); return; }
        if (GENERIC.test(name.replace(/\s+/g, ' '))) generic.push(entry(a, { href: (a.getAttribute('href') || '').slice(0, 80) }));
        if (a.target === '_blank' && !/new (window|tab)|opens in|external/i.test(name + ' ' + (a.getAttribute('title') || '') + ' ' + (a.getAttribute('aria-describedby') ? (document.getElementById(a.getAttribute('aria-describedby')) || {}).textContent : ''))) {
          newWindow.push(entry(a, { href: (a.getAttribute('href') || '').slice(0, 80) }));
        }
        const key = name.toLowerCase().replace(/\s+/g, ' ').trim();
        if (key.length > 1 && !GENERIC.test(key)) {
          const href = a.href.split('#')[0];
          if (!byText.has(key)) byText.set(key, new Map());
          const m = byText.get(key);
          if (!m.has(href)) m.set(href, a);
        }
      });
      const duplicateText = [];
      for (const [name, m] of byText) {
        if (m.size > 1 && duplicateText.length < 15) {
          const els = [...m.values()];
          duplicateText.push({ name: name.slice(0, 60), hrefs: [...m.keys()].slice(0, 5).map(h => h.slice(0, 90)), count: m.size,
            sel: H.selOf(els[0]), path: H.pathOf(els[0]), rect: H.box(els[1]) || H.box(els[0]), snippet: H.snippet(els[1]) });
        }
      }

      // Anchors that are not links, and things pretending to be links.
      const noHref = [...document.querySelectorAll('a:not([href])')].filter(a => H.visible(a) && !H.isSkipped(a) && (a.hasAttribute('onclick') || a.getAttribute('role') === 'link' || a.getAttribute('role') === 'button' || (H.textOf(a) && getComputedStyle(a).cursor === 'pointer')))
        .map(a => entry(a, { role: a.getAttribute('role') }));
      const roleLinkNonA = [...document.querySelectorAll('[role=link]:not(a)')].filter(H.visible).map(e => entry(e));
      const hashHref = [...document.querySelectorAll('a[href="#"],a[href^="javascript:"],a[href=""]')].filter(a => H.visible(a) && !H.isSkipped(a)).map(a => entry(a, { href: a.getAttribute('href') }));

      // Buttons
      const buttons = [...document.querySelectorAll('button,[role=button],input[type=button],input[type=submit],input[type=reset],input[type=image],summary')].filter(b => !H.isSkipped(b) && H.visible(b) && !H.inAriaHidden(b));
      const bUnnamed = buttons.filter(b => !H.accName(b)).map(b => entry(b));
      const roleButtonNonButton = [...document.querySelectorAll('[role=button]')].filter(e => !e.matches('button,input,summary,a[href]') && H.visible(e)).map(e => entry(e, { tag: e.tagName.toLowerCase(), focusable: e.tabIndex >= 0 }));
      const clickable = [...document.querySelectorAll('div[onclick],span[onclick],li[onclick],img[onclick],td[onclick],p[onclick],div[ng-click],span[ng-click]')]
        .filter(e => H.visible(e) && !e.getAttribute('role') && !e.closest('a[href],button,[role=button],[role=link]'))
        .map(e => entry(e, { tag: e.tagName.toLowerCase() }));
      // Pointer-cursor elements with no role are a strong hint of a fake control.
      document.querySelectorAll('div,span,li').forEach(e => {
        if (clickable.length >= 20 || !H.visible(e) || H.isSkipped(e)) return;
        if (e.getAttribute('role') || e.closest('a[href],button,[role=button],[role=link],label,select,summary,[role=tab],[role=menuitem],[role=option],[role=listbox],[role=combobox],[role=slider],[contenteditable]')) return;
        if (e.querySelector('a[href],button,input,select,textarea,[role=button],label')) return;
        const s = getComputedStyle(e);
        if (s.cursor !== 'pointer') return;
        const t = H.textOf(e);
        if (!t || t.length > 40) return;
        if (e.tabIndex >= 0) return;
        clickable.push(entry(e, { tag: e.tagName.toLowerCase(), hint: 'cursor:pointer with no role' }));
      });

      // Toggle buttons in players without a pressed state
      const togglesNoState = [...buttons].filter(b => /mute|unmute|play|pause|toggle|expand|collapse|menu/i.test(H.accName(b)) && !b.hasAttribute('aria-pressed') && !b.hasAttribute('aria-expanded') && !b.closest('video,audio') && (b.closest('[class*=player],[class*=video],[class*=audio],[class*=media]')))
        .map(b => entry(b));

      return {
        links: { total: links.length, unnamed: cap(unnamed, 40), generic: cap(generic, 40), duplicateText, newWindow: cap(newWindow, 30), noHref: cap(noHref), roleLinkNonA: cap(roleLinkNonA), hashHref: cap(hashHref) },
        buttons: { total: buttons.length, unnamed: cap(bUnnamed, 40), roleButtonNonButton: cap(roleButtonNonButton), clickable: cap(clickable), togglesNoState: cap(togglesNoState, 10) }
      };
    });
  }
};
