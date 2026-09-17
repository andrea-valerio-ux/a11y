'use strict';
// Helpers that run inside the page. Injected once per page as window.__a11y
// so every measurement module names elements, measures boxes and computes
// colors the same way. Written as a plain function and stringified, so the
// browser gets exactly the code you read here.

function install() {
  if (window.__a11y) return;
  const H = {};

  H.selOf = e => {
    if (!e || !e.tagName) return '';
    let s = e.tagName.toLowerCase();
    if (e.id) s += '#' + e.id;
    else if (typeof e.className === 'string' && e.className.trim()) {
      s += '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.');
    }
    return s;
  };

  // A path a developer can paste into the inspector: nearest id, then
  // nth-of-type steps down to the element.
  H.pathOf = e => {
    const parts = [];
    let n = e;
    while (n && n.nodeType === 1 && n !== document.documentElement) {
      if (n.id) { parts.unshift('#' + n.id); break; }
      const tag = n.tagName.toLowerCase();
      const sibs = n.parentElement ? [...n.parentElement.children].filter(c => c.tagName === n.tagName) : [];
      parts.unshift(sibs.length > 1 ? tag + ':nth-of-type(' + (sibs.indexOf(n) + 1) + ')' : tag);
      n = n.parentElement;
      if (parts.length > 6) break;
    }
    return parts.join(' > ');
  };

  H.snippet = e => {
    try {
      const clone = e.cloneNode(false);
      const open = clone.outerHTML.replace(/<\/[^>]+>$/, '');
      const txt = (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      return (open + (txt ? txt + '…' : '')).slice(0, 180);
    } catch (err) { return H.selOf(e); }
  };

  H.box = e => {
    if (!e || !e.getBoundingClientRect) return null;
    const r = e.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return [Math.round(r.x + scrollX), Math.round(r.y + scrollY), Math.round(r.width), Math.round(r.height)];
  };

  H.visible = e => {
    if (!e) return false;
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  H.textOf = e => (e.innerText || e.textContent || '').trim().replace(/\s+/g, ' ');

  H.rgb = c => {
    const m = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)/.exec(c || '');
    if (!m) return null;
    if (m[4] !== undefined) {
      const a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      if (a < 0.5) return null;
    }
    return [+m[1], +m[2], +m[3]];
  };
  H.hex = a => '#' + a.map(x => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase();
  H.lum = ([r, g, b]) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  H.contrast = (a, b) => {
    if (!a || !b) return null;
    const l1 = H.lum(a), l2 = H.lum(b);
    return +(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2));
  };

  // First thing painted behind an element: a solid color, or a backdrop
  // (image or gradient) that has to be sampled from pixels instead.
  H.bgOf = e => {
    let n = e;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        return { bg: null, backdrop: { kind: /gradient/.test(cs.backgroundImage) ? 'gradient' : 'image',
                 sel: H.selOf(n), value: cs.backgroundImage.slice(0, 120) }, el: n };
      }
      const b = H.rgb(cs.backgroundColor);
      if (b) return { bg: b, backdrop: null, el: n };
      // A positioned image or video sitting behind this element also counts.
      n = n.parentElement;
    }
    const body = H.rgb(getComputedStyle(document.body).backgroundColor)
      || H.rgb(getComputedStyle(document.documentElement).backgroundColor);
    return { bg: body || [255, 255, 255], backdrop: null, el: document.body };
  };

  // Approximate accessible name computation for controls and images.
  H.accName = e => {
    if (!e) return '';
    let n = (e.getAttribute('aria-label') || '').trim();
    if (n) return n;
    const lb = e.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\s+/).map(id => { const x = document.getElementById(id); return x ? H.textOf(x) : ''; }).join(' ').trim();
      if (t) return t;
    }
    if (e.tagName === 'IMG' || e.tagName === 'AREA') return (e.getAttribute('alt') || '').trim();
    if (e.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(e.type)) {
      n = (e.value || '').trim(); if (n) return n;
      if (e.type === 'submit') return 'Submit'; if (e.type === 'reset') return 'Reset';
    }
    if (e.tagName === 'INPUT' && e.type === 'image') { n = (e.alt || '').trim(); if (n) return n; }
    if (e.labels && e.labels.length) { n = [...e.labels].map(H.textOf).join(' ').trim(); if (n) return n; }
    n = H.textOf(e);
    if (n) return n;
    const im = e.querySelector('img[alt], svg[aria-label], [aria-label]');
    if (im) { const a = (im.getAttribute('alt') || im.getAttribute('aria-label') || '').trim(); if (a) return a; }
    const sv = e.querySelector('svg > title');
    if (sv && sv.textContent.trim()) return sv.textContent.trim();
    const t = (e.getAttribute('title') || '').trim();
    if (t) return t;
    return '';
  };

  // Does the name come only from a title attribute?
  H.nameFromTitleOnly = e => {
    const t = (e.getAttribute('title') || '').trim();
    if (!t) return false;
    const clone = e.cloneNode(true); clone.removeAttribute('title');
    clone.querySelectorAll('[title]').forEach(x => x.removeAttribute('title'));
    document.body.appendChild(clone);
    const without = H.accName(clone);
    clone.remove();
    return !without;
  };

  H.FOCUSABLE = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"]),[contenteditable="true"],audio[controls],video[controls],iframe';
  H.INTERACTIVE = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=switch],[role=option],[tabindex]:not([tabindex="-1"])';
  H.isInteractive = e => !!(e && e.matches && e.matches(H.INTERACTIVE));

  H.inAriaHidden = e => !!(e.closest && e.closest('[aria-hidden="true"]'));

  H.isLarge = (sizePx, weight) => sizePx >= 24 || (sizePx >= 18.66 && parseInt(weight, 10) >= 700);

  H.isSkipped = e => !!(e.closest && e.closest('script,style,noscript,template,svg *,[data-a11y-evidence]'));

  window.__a11y = H;
}

const SRC = '(' + install.toString() + ')()';

async function inject(page) {
  await page.evaluate(SRC);
}

module.exports = { inject, SRC };
