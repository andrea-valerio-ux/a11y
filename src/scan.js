'use strict';
// The scan. Loads each page at each width, injects the helpers, runs every
// measurement module, applies the rules, photographs every finding with a
// position, and writes a run folder that stands on its own:
//
//   run.json           what was scanned, when, and the checklist status per page
//   findings.json      every finding, worst first, with its picture path
//   checklist.json     the checklist with status and counts across the run
//   measurements.json  raw measurements per page and width
//   shots/<page>-<width>/000-full-page.png and one image per finding
const fs = require('fs');
const path = require('path');
const browser = require('./browser');
const crawl = require('./crawl');
const rules = require('./rules');
const evidence = require('./evidence');
const helpers = require('./measure/helpers');
const checklist = require('./checklist');
const log = require('./util/log');

const MODULES = [
  require('./measure/document'),
  require('./measure/content'),
  require('./measure/images'),
  require('./measure/controls'),
  require('./measure/forms'),
  require('./measure/media'),
  require('./measure/contrast'),
  require('./measure/keyboard'),
  require('./measure/targets'),
  require('./measure/responsive'),
  require('./measure/tokens')
];

function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'page'; }

function readTargets(text) {
  const t = text.trim();
  const list = t.startsWith('[') ? JSON.parse(t) : t.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const out = list.map((x, i) => typeof x === 'string' ? { url: x, shape: 'listed-' + (i + 1) } : x).filter(x => x && x.url);
  for (const x of out) new URL(x.url);
  if (!out.length) throw new Error('The targets file lists no addresses.');
  return out;
}

// Titles must be unique across pages, so this is decided once every page is in.
function crossPageRules(pageResults) {
  const out = [];
  const byTitle = new Map();
  for (const p of pageResults) {
    const t = p.measurements && p.measurements.document && p.measurements.document.title;
    if (!t || p.error) continue;
    const k = t.trim().toLowerCase();
    if (!byTitle.has(k)) byTitle.set(k, new Map());
    if (!byTitle.get(k).has(p.url)) byTitle.get(k).set(p.url, p);   // first width only: once per page
  }
  for (const [, pages] of byTitle) {
    if (pages.size < 2) continue;
    for (const p of pages.values()) {
      out.push({ item: 'unique-title', rule: 'TITLE-DUPLICATE', severity: 'moderate',
        title: `${pages.size} pages share the title "${p.measurements.document.title}"`,
        detail: 'Also used by: ' + [...pages.keys()].filter(u => u !== p.url).slice(0, 4).join(', '),
        sel: 'title', path: 'head > title', snippet: null, rect: null, shot: false,
        evidence: { title: p.measurements.document.title, pages: [...pages.keys()] },
        page: p.page, url: p.url, width: null, evidenceImage: null, id: `${p.page}-TITLE-DUPLICATE` });   // a page fact, not a rendering: no width
    }
  }
  return out;
}

// The checklist with status across the whole run: fail beats review beats
// pass beats n/a, and counts are summed.
function aggregateChecklist(pageResults, findings) {
  const RANK = { fail: 0, review: 1, pass: 2, na: 3 };
  const items = {};
  for (const it of checklist.ITEMS) {
    let status = 'na', notes = new Set(), pages = new Set();
    for (const p of pageResults) {
      const s = p.items && p.items[it.id];
      if (!s) continue;
      if (RANK[s.status] < RANK[status]) status = s.status;
      if (s.note) notes.add(s.note);
      if (s.status === 'fail') pages.add(p.page);
    }
    const mine = findings.filter(f => f.item === it.id);
    if (mine.length) status = 'fail';
    const worst = mine.reduce((w, f) => rules.ORDER[f.severity] < rules.ORDER[w] ? f.severity : w, 'minor');
    items[it.id] = { status, findings: mine.length, worst: mine.length ? worst : null, pages: [...pages].sort(),
      widths: [...new Set(mine.map(f => f.width))].sort((a, b) => a - b), notes: [...notes].slice(0, 3) };
  }
  const sections = checklist.SECTIONS.map(s => {
    const ids = checklist.ITEMS.filter(i => i.section === s.id).map(i => i.id);
    const st = ids.map(id => items[id]);
    return { id: s.id, title: s.title, items: ids, fail: st.filter(x => x.status === 'fail').length, review: st.filter(x => x.status === 'review').length,
      pass: st.filter(x => x.status === 'pass').length, na: st.filter(x => x.status === 'na').length, findings: st.reduce((n, x) => n + x.findings, 0) };
  });
  return { items, sections, totals: {
    fail: Object.values(items).filter(x => x.status === 'fail').length, review: Object.values(items).filter(x => x.status === 'review').length,
    pass: Object.values(items).filter(x => x.status === 'pass').length, na: Object.values(items).filter(x => x.status === 'na').length, items: checklist.ITEMS.length } };
}

// The design tokens seen across the run: colors and typefaces merged by
// value, variables by name, icon libraries by name.
function aggregateTokens(pageResults) {
  const colors = {}, fonts = {}, variables = {}, libraries = {}, iconColors = {};
  let inlineSvg = 0, sprite = 0, imgIcons = 0, svgImg = 0, pages = 0;
  const iconFonts = new Set(), spriteFiles = new Set(), fontFaces = new Map();
  for (const p of pageResults) {
    const t = p.measurements && p.measurements.tokens;
    if (!t || t.error) continue;
    pages++;
    for (const c of t.colors || []) {
      const x = colors[c.value] = colors[c.value] || { value: c.value, hits: 0, pages: 0, props: {}, where: [], variables: new Set() };
      x.hits += c.hits; x.pages++;
      for (const [k, v] of Object.entries(c.props)) x.props[k] = (x.props[k] || 0) + v;
      for (const w of c.where) if (x.where.length < 6 && !x.where.includes(w)) x.where.push(w);
      for (const v of c.variables || []) x.variables.add(v);
    }
    for (const f of t.fonts || []) {
      const x = fonts[f.family] = fonts[f.family] || { family: f.family, hits: 0, pages: 0, sizes: {}, weights: {}, roles: {}, stack: f.stack, webfont: f.webfont, variables: new Set() };
      x.hits += f.hits; x.pages++; x.webfont = x.webfont || f.webfont;
      for (const [k, v] of Object.entries(f.sizes)) x.sizes[k] = (x.sizes[k] || 0) + v;
      for (const [k, v] of Object.entries(f.weights)) x.weights[k] = (x.weights[k] || 0) + v;
      for (const [k, v] of Object.entries(f.roles || {})) x.roles[k] = (x.roles[k] || 0) + v;
      for (const v of f.variables || []) x.variables.add(v);
    }
    for (const v of t.variables || []) { if (!variables[v.name]) variables[v.name] = { ...v, pages: 0 }; variables[v.name].pages++; }
    for (const ff of t.fontFaces || []) if (ff.family && !fontFaces.has(ff.family + '|' + ff.weight)) fontFaces.set(ff.family + '|' + ff.weight, ff);
    const ic = t.icons || {};
    for (const l of ic.libraries || []) { const x = libraries[l.name] = libraries[l.name] || { name: l.name, count: 0, pages: 0, hint: l.hint, weak: !!l.weak }; x.count += l.count; x.pages++; }
    for (const f of ic.iconFonts || []) iconFonts.add(f);
    for (const f of ic.spriteFiles || []) spriteFiles.add(f);
    for (const c of ic.colors || []) { const x = iconColors[c.value] = iconColors[c.value] || { value: c.value, hits: 0, variables: new Set() }; x.hits += c.hits; for (const v of c.variables || []) x.variables.add(v); }
    inlineSvg += ic.inlineSvg || 0; sprite += ic.sprite || 0; imgIcons += ic.imgIcons || 0; svgImg += ic.svgImg || 0;
  }
  const setToArr = o => ({ ...o, variables: [...o.variables] });
  const libs = Object.values(libraries).sort((a, b) => b.count - a.count);
  const strong = libs.filter(l => !l.weak);
  const system = strong.length ? strong[0].name : inlineSvg && sprite ? 'Inline SVG with a sprite sheet' : inlineSvg ? 'Inline SVG' : iconFonts.size ? 'Icon font' : svgImg ? 'SVG images' : imgIcons ? 'Image icons' : 'None detected';
  const byKind = {};
  for (const v of Object.values(variables)) byKind[v.kind] = (byKind[v.kind] || 0) + 1;
  return {
    generated: new Date().toISOString(), pages,
    colors: Object.values(colors).map(setToArr).sort((a, b) => b.hits - a.hits),
    fonts: Object.values(fonts).map(setToArr).sort((a, b) => b.hits - a.hits),
    fontFaces: [...fontFaces.values()],
    variables: Object.values(variables).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)),
    variablesByKind: byKind,
    icons: { system, libraries: libs, iconFonts: [...iconFonts], inlineSvg, sprite, spriteFiles: [...spriteFiles], imgIcons, svgImg, colors: Object.values(iconColors).map(setToArr).sort((a, b) => b.hits - a.hits) }
  };
}

async function run(opts) {
  const started = new Date();
  const emit = (type, data) => { if (opts.onProgress) { try { opts.onProgress({ type, ...data }); } catch (e) { /* ignore */ } } };
  const level = (opts.level || 'AA').toUpperCase();
  const widths = String(opts.widths || '1440,390').split(',').map(w => parseInt(w.trim(), 10)).filter(Boolean);
  const client = opts.client || slug(new URL(opts.url).hostname.replace(/^www\./, ''));
  const outRoot = opts.out || path.join(process.cwd(), 'runs', client, started.toISOString().slice(0, 10));
  fs.mkdirSync(outRoot, { recursive: true });
  log.step(`run folder ${outRoot}`);
  emit('start', { client, url: opts.url, level, widths, out: outRoot });

  const b = await browser.launch({ width: widths[0], height: 900 });
  const pageResults = [];
  const allFindings = [];

  try {
    let targets;
    if (opts.targets) targets = readTargets(fs.readFileSync(opts.targets, 'utf8'));
    else if (opts.pages && opts.pages > 1) {
      const p = await b.newPage();
      await browser.prepare(p, opts.url);
      targets = await crawl.discover(p, opts.url, opts.pages);
      await p.close();
    } else targets = [{ url: opts.url, shape: 'entry' }];
    emit('targets', { count: targets.length, total: targets.length * widths.length, list: targets.map(t => t.url) });

    let index = 0;
    for (const t of targets) {
      index++;
      const pageId = slug(new URL(t.url).pathname) || 'home';
      for (const width of widths) {
        const label = `${pageId} @ ${width}`;
        log.step(`[${index}/${targets.length}] ${label}  ${t.url}`);
        emit('page', { page: pageId, url: t.url, width, index, of: targets.length });
        const p = await b.newPage();
        await p.setViewport({ width, height: 900, deviceScaleFactor: 1 });
        const measurements = { meta: { url: t.url, width, template: t.shape || null, capturedAt: new Date().toISOString() } };
        try {
          const prep = await browser.prepare(p, t.url);
          measurements.meta.overlaysHidden = prep.hiddenOverlays;
          measurements.meta.status = prep.status;
          await helpers.inject(p);

          for (const mod of MODULES) {
            const t0 = Date.now();
            try {
              await helpers.inject(p);   // a navigation or reload would drop it
              const ctx = { level, width, tabStops: opts.tabStops, viewportHeight: 900,
                selectionRules: measurements.document ? measurements.document.selection : [] };
              measurements[mod.id] = await mod.collect(p, ctx);
              log.step(`    ${mod.id.padEnd(11)} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
              emit('module', { module: mod.id, label: mod.label, seconds: +((Date.now() - t0) / 1000).toFixed(1), ok: true });
            } catch (e) {
              measurements[mod.id] = { error: String(e.message || e).slice(0, 200) };
              log.warn(`    ${mod.id} failed: ${String(e.message || e).slice(0, 120)}`);
              emit('module', { module: mod.id, label: mod.label, ok: false, error: String(e.message || e).slice(0, 160) });
            }
          }

          const { findings, items } = rules.evaluate(measurements, { level, page: pageId, url: t.url, width });
          const shotDir = path.join(outRoot, 'shots', `${pageId}-${width}`);
          await p.evaluate(() => window.scrollTo(0, 0));
          const captured = await evidence.capture(p, findings, shotDir, outRoot, { maxPerRule: opts.maxImagesPerRule || 15 });
          if (!opts.noFullPage) await evidence.fullPage(p, path.join(shotDir, '000-full-page.png'));

          findings.forEach((f, i) => { f.id = `${pageId}-${width}-${f.rule}-${i + 1}`; });
          allFindings.push(...findings);
          pageResults.push({ page: pageId, url: t.url, width, template: t.shape || null, measurements, items, findings: findings.length,
            fullPage: `shots/${pageId}-${width}/000-full-page.png` });
          const counts = findings.reduce((m, f) => (m[f.severity] = (m[f.severity] || 0) + 1, m), {});
          log.step(`    ${findings.length} finding(s) ${JSON.stringify(counts)} · ${captured} image(s)`);
          emit('pageDone', { page: pageId, width, findings: findings.length, counts, images: captured });
        } catch (e) {
          log.fail(`${label}: ${String(e.message || e).slice(0, 160)}`);
          emit('pageError', { page: pageId, width, error: String(e.message || e).slice(0, 200) });
          pageResults.push({ page: pageId, url: t.url, width, error: String(e.message || e).slice(0, 200), measurements, items: {} });
        } finally { try { await p.close(); } catch (e) { /* ignore */ } }
      }
    }
  } finally { await b.close(); }

  allFindings.push(...crossPageRules(pageResults));
  allFindings.sort((a, b) => (rules.ORDER[a.severity] - rules.ORDER[b.severity]) || String(a.page).localeCompare(String(b.page)) || (a.width || 0) - (b.width || 0) || a.rule.localeCompare(b.rule));
  const summary = allFindings.reduce((m, f) => (m[f.severity] = (m[f.severity] || 0) + 1, m), { critical: 0, serious: 0, moderate: 0, minor: 0 });
  const agg = aggregateChecklist(pageResults, allFindings);

  const tokens = aggregateTokens(pageResults);
  const manifest = {
    client, startUrl: opts.url, level, widths,
    startedAt: started.toISOString(), finishedAt: new Date().toISOString(),
    durationSeconds: Math.round((Date.now() - started) / 1000),
    pages: pageResults.map(p => ({ page: p.page, url: p.url, width: p.width, template: p.template, findings: p.findings || 0, error: p.error || null,
      title: p.measurements && p.measurements.document ? p.measurements.document.title : null, fullPage: p.fullPage || null,
      items: Object.fromEntries(Object.entries(p.items || {}).map(([k, v]) => [k, v.status])) })),
    summary, totalFindings: allFindings.length, checklist: agg.totals,
    tokens: { colors: tokens.colors.length, variables: tokens.variables.length, fonts: tokens.fonts.length, icons: tokens.icons.system },
    engine: require('../package.json').version
  };

  fs.writeFileSync(path.join(outRoot, 'run.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(outRoot, 'findings.json'), JSON.stringify(allFindings, null, 2));
  fs.writeFileSync(path.join(outRoot, 'checklist.json'), JSON.stringify(agg, null, 2));
  fs.writeFileSync(path.join(outRoot, 'tokens.json'), JSON.stringify(tokens, null, 2));
  fs.writeFileSync(path.join(outRoot, 'measurements.json'), JSON.stringify(pageResults.map(p => ({ page: p.page, url: p.url, width: p.width, items: p.items, ...p.measurements })), null, 2));

  emit('done', { summary, total: allFindings.length, out: outRoot, seconds: manifest.durationSeconds, pages: manifest.pages.length, checklist: agg.totals });
  log.step('');
  log.out(`Scanned ${manifest.pages.length} page-width combination(s) of ${client} in ${manifest.durationSeconds}s`);
  log.out(`  critical ${summary.critical}   serious ${summary.serious}   moderate ${summary.moderate}   minor ${summary.minor}`);
  log.out(`  checklist: ${agg.totals.fail} failing, ${agg.totals.review} to review, ${agg.totals.pass} passing, ${agg.totals.na} not applicable`);
  log.out(`  ${outRoot}`);
  return { manifest, findings: allFindings, checklist: agg, tokens, out: outRoot };
}

module.exports = { run, readTargets, MODULES, aggregateChecklist, aggregateTokens };
