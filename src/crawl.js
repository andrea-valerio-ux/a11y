'use strict';
// Page discovery. Prefers breadth: one page of each template shape before
// a second page of any shape, so ten pages means ten different kinds of page.
const log = require('./util/log');

function shape(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    return parts.slice(0, -1).join('/') + '/*' + (parts.length ? '' : 'root');
  } catch (e) { return url; }
}

async function discover(page, startUrl, limit) {
  const origin = new URL(startUrl).origin;
  const found = [{ url: startUrl, shape: 'entry' }];
  const shapes = new Set(['entry']);

  const links = await page.evaluate(o => {
    const out = [];
    document.querySelectorAll('a[href]').forEach(a => {
      const h = a.href;
      if (!h.startsWith(o)) return;
      if (/\.(pdf|zip|jpe?g|png|gif|webp|svg|docx?|xlsx?|pptx?|mp4|mp3)(\?|$)/i.test(h)) return;
      if (/^(mailto|tel|javascript):/i.test(h)) return;
      const clean = h.split('#')[0];
      if (clean && !out.includes(clean)) out.push(clean);
    });
    return out;
  }, origin);

  const start = startUrl.split('#')[0].replace(/\/$/, '');
  for (const url of links) {
    if (found.length >= limit) break;
    if (url.replace(/\/$/, '') === start) continue;
    const s = shape(url);
    if (shapes.has(s)) continue;
    shapes.add(s);
    found.push({ url, shape: s });
  }
  for (const url of links) {
    if (found.length >= limit) break;
    if (found.some(f => f.url === url) || url.replace(/\/$/, '') === start) continue;
    found.push({ url, shape: shape(url) });
  }

  log.step(`discovered ${found.length} page(s), ${shapes.size} template shape(s)`);
  return found.slice(0, limit);
}

module.exports = { discover, shape };
