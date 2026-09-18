#!/usr/bin/env node
'use strict';
// Turns a finished run folder into the folder the website receives:
//
//   node scripts/ci/prepare-upload.js <run folder> <upload folder> <request id>
//
//   upload/<site>/<YYYY-MM-DD-HHMM>-<id>/
//     index.html                 the HTML report (screenshots embedded), so the
//                                folder's address opens the report directly
//     <site>-<stamp>.xlsx .docx .pdf .csv .json
//     meta.json                  what api.php lists: site, date, counts, files
//
// Only the reports travel; the shots/ folder stays behind because every report
// already embeds its pictures.
const fs = require('fs');
const path = require('path');

const [runDir, uploadRoot, requestId = 'manual', siteName = ''] = process.argv.slice(2);
if (!runDir || !uploadRoot) { console.error('usage: prepare-upload.js <run folder> <upload folder> [request id] [site name]'); process.exit(2); }

const read = f => { const p = path.join(runDir, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
const manifest = read('run.json');
if (!manifest) { console.error('no run.json in ' + runDir); process.exit(2); }

// The folder name: the name given on the form, else the site's host name.
const site = (siteName.trim() || (() => { try { return new URL(manifest.startUrl).hostname.replace(/^www\./, ''); } catch (e) { return 'site'; } })()).replace(/[^a-z0-9.-]+/gi, '-').replace(/^-+|-+$/g, '') || 'site';
const when = new Date(manifest.finishedAt || Date.now());
const two = n => String(n).padStart(2, '0');
const stamp = `${when.getUTCFullYear()}-${two(when.getUTCMonth() + 1)}-${two(when.getUTCDate())}-${two(when.getUTCHours())}${two(when.getUTCMinutes())}`;
const shortId = String(requestId).replace(/[^a-z0-9]/gi, '').slice(0, 12) || 'manual';
const folder = path.join(site, `${stamp}-${shortId}`);
const dest = path.join(uploadRoot, folder);
fs.mkdirSync(dest, { recursive: true });

// Checklist counts: from the manifest when it carries them, else from checklist.json.
function checklistCounts() {
  const c = manifest.checklist;
  if (c && typeof c === 'object' && ['fail', 'pass', 'review', 'na'].some(k => typeof c[k] === 'number')) return { fail: c.fail || 0, pass: c.pass || 0, review: c.review || 0, na: c.na || 0 };
  const cl = read('checklist.json');
  const items = Array.isArray(cl) ? cl : (cl && Array.isArray(cl.items)) ? cl.items : [];
  const out = { fail: 0, pass: 0, review: 0, na: 0 };
  for (const it of items) if (it && it.status in out) out[it.status]++;
  return out;
}

const reportDir = path.join(runDir, 'report');
const files = [];
if (fs.existsSync(reportDir)) {
  for (const f of fs.readdirSync(reportDir)) {
    if (!f.startsWith('report.')) continue;
    const ext = path.extname(f).slice(1);
    const name = ext === 'html' ? 'index.html' : `${site}-${stamp}.${ext}`;
    fs.copyFileSync(path.join(reportDir, f), path.join(dest, name));
    files.push({ format: ext, name, bytes: fs.statSync(path.join(dest, name)).size });
  }
}

// The design tokens (colors, typefaces, icon system, CSS variables) travel too,
// so the page can show them next to the reports.
let tokensFile = null;
if (fs.existsSync(path.join(runDir, 'tokens.json'))) {
  fs.copyFileSync(path.join(runDir, 'tokens.json'), path.join(dest, 'tokens.json'));
  tokensFile = 'tokens.json';
}

const meta = {
  id: shortId,
  tokens: tokensFile,
  requestId,
  url: manifest.startUrl,
  site,
  folder: folder.split(path.sep).join('/'),
  level: manifest.level,
  widths: manifest.widths,
  pages: (manifest.pages || []).length,
  pageList: (manifest.pages || []).map(p => ({ url: p.url, width: p.width, title: p.title || '', findings: p.findings, error: p.error || null })),
  startedAt: manifest.startedAt || null,
  finishedAt: manifest.finishedAt || when.toISOString(),
  seconds: manifest.durationSeconds || null,
  totalFindings: manifest.totalFindings || 0,
  summary: manifest.summary || {},
  checklist: checklistCounts(),
  files: files.sort((a, b) => ['html', 'xlsx', 'docx', 'pdf', 'csv', 'json'].indexOf(a.format) - ['html', 'xlsx', 'docx', 'pdf', 'csv', 'json'].indexOf(b.format))
};
fs.writeFileSync(path.join(dest, 'meta.json'), JSON.stringify(meta, null, 2));

const s = meta.summary;
console.log(`### ${meta.url}\n`);
console.log(`${meta.pages} page-width checks · ${meta.totalFindings} findings (critical ${s.critical || 0}, serious ${s.serious || 0}, moderate ${s.moderate || 0}, minor ${s.minor || 0}) · checklist: ${meta.checklist.fail} failing, ${meta.checklist.review} to review, ${meta.checklist.pass} passing\n`);
console.log(`Folder: \`${meta.folder}\` · files: ${files.map(f => f.name).join(', ')}`);
