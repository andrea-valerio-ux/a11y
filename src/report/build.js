'use strict';
// Reports from a run folder. Nothing here visits a site: it groups what the
// scan wrote and formats it, organized the way the checklist is.
//
//   html  the readable report: every checklist section and item, its status,
//         the criterion, what it is about, the links, and each issue with its
//         picture, explanation and page address
//   pdf   that HTML printed by the same Chrome the scanner drives
//   xlsx  the workbook: checklist, issues with pictures in the cells, findings, pages, measurements
//   docx  the written report, one block per issue
//   csv   one row per finding, for filtering and ticketing
//   json  findings and checklist status, for other tools
const fs = require('fs');
const path = require('path');
const checklist = require('../checklist');
const { group, summarize } = require('./group');

const ALL = ['html', 'pdf', 'xlsx', 'docx', 'csv', 'json'];
const SEV = ['critical', 'serious', 'moderate', 'minor'];
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function readRun(dir) {
  const f = path.join(dir, 'findings.json');
  if (!fs.existsSync(f)) throw new Error(`No findings.json in ${dir}. Point this at a run folder.`);
  const run = fs.existsSync(path.join(dir, 'run.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')) : {};
  const cl = fs.existsSync(path.join(dir, 'checklist.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'checklist.json'), 'utf8')) : null;
  const tokens = fs.existsSync(path.join(dir, 'tokens.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'tokens.json'), 'utf8')) : null;
  return { run, findings: JSON.parse(fs.readFileSync(f, 'utf8')), checklist: cl, tokens };
}

// ------------------------------------------------------------------ CSV ---
const COLUMNS = ['Severity', 'Section', 'Checklist item', 'WCAG', 'Criterion', 'Level', 'Rule', 'Finding', 'Explanation', 'Page', 'Address', 'Width', 'Selector', 'Path', 'Screenshot', 'Rule link', 'Checklist link'];
function csvCell(v) {
  const s = String(v == null ? '' : v);
  const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
  return /[",\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}
function csv(findings, meta) {
  const rows = findings.map(f => {
    const it = checklist.itemFor(f.item) || {};
    const cr = it.criterion || {};
    return [f.severity, it.sectionTitle || '', it.title || f.item, cr.code || '', cr.name || '', cr.level || '', f.rule, f.title, f.detail || '', f.page, f.url, f.width,
      f.sel || '', f.path || '', f.evidenceImage ? path.join(meta.dir, f.evidenceImage) : '', cr.url || '', it.checklistUrl || ''];
  });
  return [COLUMNS, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ----------------------------------------------------------------- HTML ---
const STATUS_LABEL = { fail: 'Fails', pass: 'Passes', review: 'Needs a person', na: 'Not applicable' };

function html(findings, meta, opts = {}) {
  const groups = group(findings);
  const summary = summarize(findings, groups);
  const img = (rel) => {
    if (!opts.images || !rel) return '';
    const file = path.join(meta.dir, rel);
    if (!fs.existsSync(file)) return '';
    return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
  };
  const cl = meta.checklist || { items: {}, sections: [] };

  const issue = (g, idx) => {
    const pic = img(g.evidenceImage);
    const others = g.examples.filter(e => e.evidenceImage && e.evidenceImage !== g.evidenceImage).slice(0, 3);
    return `
    <article class="issue ${g.severity}" id="issue-${idx}">
      <header>
        <span class="pill ${g.severity}">${g.severity}</span>
        <h4>${esc(g.title)}</h4>
        <p class="meta">${g.occurrences} occurrence${g.occurrences === 1 ? '' : 's'} on ${g.pageCount} page${g.pageCount === 1 ? '' : 's'}${g.width ? ` at ${g.width}px` : ''} · rule <code>${esc(g.rule)}</code></p>
      </header>
      ${g.detail ? `<p class="explain">${esc(g.detail)}</p>` : ''}
      ${g.path ? `<p class="where"><span>Element</span> <code>${esc(g.path)}</code>${g.snippet ? `<br><code class="snip">${esc(g.snippet)}</code>` : ''}</p>` : ''}
      <p class="where"><span>Page${g.pages.length === 1 ? '' : 's'}</span> ${g.pages.map(p => `<a href="${esc(g.urls[p] || meta.startUrl)}">${esc(g.urls[p] || p)}</a>`).join('<br>')}</p>
      ${pic ? `<figure><img src="${pic}" alt="Screenshot of the page with the affected element outlined in red: ${esc(g.title)}"><figcaption>Where it is: ${esc(g.sample.url || '')} at ${g.sample.width}px. The element is outlined in red.</figcaption></figure>` : (opts.images ? '<p class="nopic">No screenshot: this finding is about the page as a whole, not one element.</p>' : '')}
      ${others.length ? `<div class="more">${others.map(e => { const p2 = img(e.evidenceImage); return p2 ? `<figure><img src="${p2}" alt="Another occurrence on ${esc(e.url)}"><figcaption>${esc(e.url)} · ${e.width}px</figcaption></figure>` : ''; }).join('')}</div>` : ''}
      <details><summary>What was measured</summary><pre>${esc(JSON.stringify(g.evidence, null, 2))}</pre></details>
    </article>`;
  };

  let issueIndex = 0;
  const itemBlock = (it) => {
    const item = checklist.itemFor(it.id);
    const st = (cl.items && cl.items[it.id]) || { status: 'na', findings: 0, notes: [] };
    const mine = groups.filter(g => g.item === it.id);
    const cr = item.criterion;
    return `
  <section class="item ${st.status}" id="${esc(it.id)}">
    <details ${st.status === 'fail' ? 'open' : ''}>
      <summary>
        <span class="status ${st.status}">${STATUS_LABEL[st.status]}${st.status === 'fail' ? ` · ${mine.length} issue${mine.length === 1 ? '' : 's'} · ${st.findings} finding${st.findings === 1 ? '' : 's'}` : ''}</span>
        <h3>${esc(item.title)}</h3>
      </summary>
      <div class="body">
        <p class="criterion"><a href="${esc(cr.url)}">${esc(cr.code)} ${esc(cr.name)}</a> <span class="lvl">${cr.level === 'Technique' ? 'WCAG technique' : 'Level ' + esc(cr.level)}</span>${cr.note ? `<br><small>${esc(cr.note)}</small>` : ''}</p>
        <p class="desc">${esc(item.description)}</p>
        <dl class="rule">
          <dt>What the rule is about</dt><dd>${esc(item.about)}</dd>
          <dt>What was checked</dt><dd>${esc(item.measures)}${st.notes && st.notes.length ? ' ' + st.notes.map(esc).join(' ') : ''}</dd>
          <dt>How to fix it</dt><dd>${esc(item.fix)}</dd>
        </dl>
        <p class="links"><a href="${esc(item.checklistUrl)}">This item on The A11Y Project checklist</a> · <a href="${esc(cr.url)}">Understanding ${esc(cr.code)}</a> · <a href="#${esc(it.id)}" class="share">Share link</a></p>
        ${mine.length ? `<div class="issues">${mine.map(g => issue(g, ++issueIndex)).join('')}</div>` : ''}
      </div>
    </details>
  </section>`;
  };

  const sections = checklist.SECTIONS.map(s => {
    const items = checklist.ITEMS.filter(i => i.section === s.id);
    const agg = (cl.sections || []).find(x => x.id === s.id) || {};
    return `
<section class="group" id="section-${s.id}">
  <h2>${esc(s.title)} <span class="counts">${agg.fail ? `<b class="c-fail">${agg.fail} failing</b>` : ''}${agg.review ? `<b class="c-review">${agg.review} to review</b>` : ''}${agg.pass ? `<b class="c-pass">${agg.pass} passing</b>` : ''}${agg.na ? `<b class="c-na">${agg.na} n/a</b>` : ''}</span></h2>
  <p class="blurb">${esc(s.blurb)}</p>
  ${items.map(itemBlock).join('')}
</section>`;
  }).join('');

  const t = (cl.totals) || {};
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Accessibility report – ${esc(meta.client)}</title>
<style>
:root{--ink:#1C1F33;--ink2:#474B63;--ink3:#6B6F86;--ground:#F6F4EF;--surface:#fff;--rule:#DED9D0;--accent:#5B5FC7;--accent2:#EEEFFA;
  --critical:#B93A37;--serious:#9A5B00;--moderate:#2B5FD9;--minor:#6B6F86;--fail:#B93A37;--pass:#1E7A4B;--review:#9A5B00;--na:#8A8DA0;
  --ui:'Noto Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--ui);line-height:1.6}
.wrap{max-width:960px;margin:0 auto;padding:44px 32px 80px}
h1{font-size:32px;letter-spacing:-.02em;margin:0 0 6px}.lede{color:var(--ink2);font-family:var(--mono);font-size:13px;margin:0 0 24px;word-break:break-all}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:0 0 14px}
.kpi{background:var(--surface);border:1px solid var(--rule);border-top:3px solid var(--rule);border-radius:6px;padding:12px 15px}
.kpi b{display:block;font-size:26px}.kpi span{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink3);font-weight:600}
.kpi.critical{border-top-color:var(--critical)}.kpi.serious{border-top-color:var(--serious)}.kpi.moderate{border-top-color:var(--moderate)}.kpi.minor{border-top-color:var(--minor)}
.kpi.fail{border-top-color:var(--fail)}.kpi.review{border-top-color:var(--review)}.kpi.pass{border-top-color:var(--pass)}.kpi.na{border-top-color:var(--na)}
.note{background:var(--surface);border-left:3px solid var(--accent);padding:14px 20px;border-radius:0 6px 6px 0;margin:14px 0 34px;font-size:14px;color:var(--ink2)}
.toc{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 30px}.toc a{font-size:12.5px;font-weight:600;color:var(--ink);background:var(--surface);border:1px solid var(--rule);border-radius:20px;padding:5px 12px;text-decoration:none}
.toc a b{color:var(--fail);margin-left:4px}
.group{margin:0 0 36px}.group h2{font-size:24px;letter-spacing:-.01em;margin:0 0 4px;display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;line-height:1.2}
.counts{display:contents}
.counts b{font-size:12px;font-weight:600;border-radius:12px;padding:3px 9px;background:var(--rule);color:var(--ink2);white-space:nowrap}
.counts .c-fail{background:#F8E3E2;color:var(--fail)}.counts .c-review{background:#F7E8CC;color:var(--review)}.counts .c-pass{background:#DDF1E4;color:var(--pass)}
.blurb{margin:0 0 14px;color:var(--ink2);font-size:14px}
.item{margin:0 0 10px}.item details{background:var(--surface);border:1px solid var(--rule);border-radius:8px;overflow:hidden}
.item > details > summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:auto 1fr;gap:6px 14px;align-items:center;padding:14px 18px;background:var(--accent2);border-left:5px solid var(--na)}
.item > details > summary::-webkit-details-marker{display:none}.item > details > summary::before{content:"";grid-row:1/3;width:10px;height:10px;border-right:2px solid var(--ink);border-bottom:2px solid var(--ink);transform:rotate(-45deg);margin:0 6px;transition:transform .15s}
.item > details[open] > summary::before{transform:rotate(45deg)}
.item.fail > details > summary{border-left-color:var(--fail)}.item.pass > details > summary{border-left-color:var(--pass)}.item.review > details > summary{border-left-color:var(--review)}
.item > details > summary h3{margin:0;font-size:16px;font-weight:600;grid-column:2}
.status{grid-column:2;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--na)}
.status.fail{color:var(--fail)}.status.pass{color:var(--pass)}.status.review{color:var(--review)}
.body{padding:18px 22px 20px}
.criterion{font-family:var(--mono);font-size:13px;text-transform:uppercase;letter-spacing:.06em;margin:0 0 8px}.criterion a{color:var(--accent);text-decoration:underline;text-underline-offset:3px}
.criterion .lvl{color:var(--ink3);font-size:11px;margin-left:8px}.criterion small{text-transform:none;letter-spacing:0;font-family:var(--ui);color:var(--ink3)}
.desc{margin:0 0 12px;font-size:15px}
dl.rule{margin:0 0 12px;font-size:14px;color:var(--ink2);display:grid;grid-template-columns:150px 1fr;gap:4px 14px}dl.rule dt{font-weight:600;color:var(--ink3);font-size:12px;text-transform:uppercase;letter-spacing:.06em;padding-top:3px}dl.rule dd{margin:0}
.links{font-family:var(--mono);font-size:12px;text-transform:uppercase;letter-spacing:.06em;margin:0 0 6px}.links a{color:var(--accent)}
.issues{margin-top:16px;display:grid;gap:12px}
.issue{border:1px solid var(--rule);border-left:4px solid var(--rule);border-radius:0 6px 6px 0;padding:16px 20px;background:#FCFBF9}
.issue.critical{border-left-color:var(--critical)}.issue.serious{border-left-color:var(--serious)}.issue.moderate{border-left-color:var(--moderate)}.issue.minor{border-left-color:var(--minor)}
.issue h4{margin:2px 0 4px;font-size:15.5px}.issue .meta,.issue .where{font-family:var(--mono);font-size:12px;color:var(--ink3);margin:0 0 6px;word-break:break-word}
.issue .where span{text-transform:uppercase;letter-spacing:.07em;font-size:10.5px;font-weight:600;margin-right:6px}.issue .where a{color:var(--accent)}
.issue .explain{margin:0 0 8px;font-size:14px;color:var(--ink2)}
.pill{display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#fff;background:var(--ink);border-radius:3px;padding:1px 6px}
.pill.critical{background:var(--critical)}.pill.serious{background:var(--serious)}.pill.moderate{background:var(--moderate)}.pill.minor{background:var(--minor)}
figure{margin:10px 0}figure img{display:block;max-width:100%;max-height:520px;border:1px solid var(--rule);border-radius:4px;background:#fff}figcaption{font-size:12px;color:var(--ink3);margin-top:4px;font-family:var(--mono)}
.more{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}.more img{max-height:180px;object-fit:cover;width:100%}
.nopic{font-size:12px;color:var(--ink3);font-style:italic}
code{font-family:var(--mono);font-size:12px;background:#EFEDE8;padding:1px 5px;border-radius:3px}.snip{color:var(--ink2)}
details.measured{margin-top:8px}summary{font-size:12.5px;color:var(--ink3);cursor:pointer}pre{background:#0D1117;color:#C9D1D9;font-family:var(--mono);font-size:11.5px;padding:12px 14px;border-radius:5px;overflow-x:auto}
@media (max-width:640px){.kpis{grid-template-columns:repeat(2,1fr)}dl.rule{grid-template-columns:1fr}.wrap{padding:24px 16px 60px}}
@media print{body{background:#fff}.wrap{max-width:none;padding:0}.issue,.kpi,figure{break-inside:avoid}.item details{border:1px solid #ccc}
  .item details:not([open])>.body{display:block}details>.body{display:block}pre{display:none}summary::before{display:none}
  .issue .where a::after,.links a::after{content:" (" attr(href) ")";color:var(--ink3);font-size:10px;word-break:break-all}}
</style></head><body><div class="wrap">
<h1>Accessibility report – ${esc(meta.client)}</h1>
<p class="lede">${esc(meta.startUrl)} · ${meta.pages} page-width check${meta.pages === 1 ? '' : 's'} · widths ${esc((meta.widths || []).join(', '))}px · level ${esc(meta.level)} · ${esc(meta.date)}</p>
<div class="kpis">${SEV.map(s => `<div class="kpi ${s}"><b>${groups.filter(g => g.severity === s).length}</b><span>${s} issues</span></div>`).join('')}</div>
<div class="kpis">${['fail', 'review', 'pass', 'na'].map(s => `<div class="kpi ${s}"><b>${t[s] || 0}</b><span>${STATUS_LABEL[s]}</span></div>`).join('')}</div>
<div class="note"><strong>${summary.findings} findings, grouped into ${summary.issues} issues</strong> by what causes them, and organized under the ${checklist.ITEMS.length} items of <a href="${checklist.CHECKLIST_BASE}">The A11Y Project checklist</a>.
  Each issue shows a screenshot with the affected element outlined in red, the explanation, what the rule is about, a link to the criterion, and the address of every page it was seen on.
  Items marked "needs a person" are the parts of the checklist a scanner cannot decide.</div>
<nav class="toc" aria-label="Sections">${checklist.SECTIONS.map(s => { const a = (cl.sections || []).find(x => x.id === s.id) || {}; return `<a href="#section-${s.id}">${esc(s.title)}${a.fail ? `<b>${a.fail}</b>` : ''}</a>`; }).join('')}</nav>
${sections}
</div>
<script>
// Share link: copy the address of an item to the clipboard.
document.querySelectorAll('a.share').forEach(function(a){a.addEventListener('click',function(e){
  var u=location.href.split('#')[0]+a.getAttribute('href');
  if(navigator.clipboard){e.preventDefault();navigator.clipboard.writeText(u).then(function(){var t=a.textContent;a.textContent='Copied';setTimeout(function(){a.textContent=t},1200)});}
});});
if(location.hash){var el=document.querySelector(location.hash);if(el){var d=el.querySelector('details');if(d)d.open=true;el.scrollIntoView();}}
</script>
</body></html>`;
}

async function toPDF(htmlText, outFile) {
  const browser = require('../browser');
  const b = await browser.launch({ width: 1200, height: 1600 });
  try {
    const p = await b.newPage();
    await p.setContent(htmlText, { waitUntil: 'load' });
    await p.pdf({ path: outFile, format: 'A4', printBackground: true, margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' } });
  } finally { await b.close(); }
  return outFile;
}

async function build(dir, opts = {}) {
  const { run, findings, checklist: cl, tokens } = readRun(dir);
  let chosen = findings;
  if (opts.severity && opts.severity !== 'all') {
    const min = SEV.indexOf(opts.severity);
    chosen = findings.filter(f => SEV.indexOf(f.severity) <= min);
  }
  const groups = group(chosen);
  const summary = summarize(chosen, groups);
  const meta = { dir, client: run.client || path.basename(path.dirname(dir)), startUrl: run.startUrl || '', level: run.level || 'AA', widths: run.widths || [],
    pages: (run.pages || []).length, pageList: run.pages || [], date: (run.finishedAt || new Date().toISOString()).slice(0, 10), summary, checklist: cl, tokens };
  const want = (opts.formats && opts.formats.length ? opts.formats : ALL).map(f => String(f).toLowerCase()).filter(f => ALL.includes(f));
  const outDir = opts.out || path.join(dir, 'report');
  fs.mkdirSync(outDir, { recursive: true });
  const images = opts.images !== false;
  const written = [];
  const htmlText = (want.includes('html') || want.includes('pdf')) ? html(chosen, meta, { images }) : null;
  for (const f of want) {
    const file = path.join(outDir, 'report.' + f);
    if (f === 'csv') fs.writeFileSync(file, csv(chosen, meta));
    if (f === 'xlsx') fs.writeFileSync(file, require('./xlsx').build(groups, chosen, meta, { images }));
    if (f === 'docx') fs.writeFileSync(file, require('./docx').build(groups, meta, { images }));
    if (f === 'json') fs.writeFileSync(file, JSON.stringify({ run: { client: meta.client, startUrl: meta.startUrl, level: meta.level, widths: meta.widths, date: meta.date, pages: meta.pageList },
      checklist: cl, tokens, summary, issues: groups.map(g => ({ ...g, sample: undefined })), findings: chosen }, null, 2));
    if (f === 'html') fs.writeFileSync(file, htmlText);
    if (f === 'pdf') await toPDF(htmlText, file);
    written.push({ format: f, file, bytes: fs.statSync(file).size });
  }
  return { meta, summary, groups, written, outDir };
}

module.exports = { build, readRun, html, csv, ALL };
