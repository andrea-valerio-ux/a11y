#!/usr/bin/env node
'use strict';
// Runs one scan on the GitHub machine and publishes its progress to the
// website every few seconds, so the page shows what the desktop app shows:
// which page and width is being checked, which topic is being measured,
// how many findings so far, and a short log.
//
// Environment (set by .github/workflows/scan.yml):
//   URL PAGES WIDTHS LEVEL CLIENT REQUEST_ID      what to scan
//   FTP_HOST FTP_USER FTP_PASSWORD                where to publish progress
//   FTP_PROTOCOL FTP_PORT FTP_DIR FTP_VERIFY      (optional, as in the workflow)
//
// The progress file lands at <FTP_DIR>/_progress/<REQUEST_ID>.json, next to the
// run folders, where api/index.php reads it. Without FTP settings the scan
// still runs; only the live view is missing.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const env = process.env;
const id = String(env.REQUEST_ID || 'manual').replace(/[^a-z0-9]/gi, '').slice(0, 12) || 'manual';
const OUT = path.resolve('run');
const FILE = path.resolve('progress.json');
const EVERY_MS = 4000;

const MODULES = ['document', 'content', 'images', 'controls', 'forms', 'media', 'contrast', 'keyboard', 'targets', 'responsive'];
const state = {
  id, url: env.URL, state: 'starting', startedAt: new Date().toISOString(), updatedAt: null,
  level: env.LEVEL || 'AA', widths: (env.WIDTHS || '1440,390').split(',').map(Number).filter(Boolean),
  targets: null,                       // { count, total, list }
  current: null,                       // { page, url, width, index, of, module, moduleLabel }
  pages: [],                           // [{ page, url, width, status, findings, images, error, modules: {id: 'ok'|'bad'} }]
  done: { n: 0, total: 0 }, findings: 0, log: []
};
let dirty = true, uploading = false;

const log = line => { state.log.push(line); if (state.log.length > 40) state.log.shift(); };
const pageOf = (page, width) => state.pages.find(p => p.page === page && p.width === width);

function onProgress(e) {
  dirty = true;
  if (e.type === 'start') { state.state = 'running'; log(`Scanning ${e.url} at ${e.widths.join(', ')} px, level ${e.level}`); }
  if (e.type === 'targets') { state.targets = { count: e.count, total: e.total, list: e.list }; state.done.total = e.total; log(`${e.count} page(s) found · ${e.total} page-width checks`); e.list.forEach(u => log('  ' + u)); }
  if (e.type === 'page') {
    state.current = { page: e.page, url: e.url, width: e.width, index: e.index, of: e.of, module: MODULES[0], moduleLabel: '' };
    if (!pageOf(e.page, e.width)) state.pages.push({ page: e.page, url: e.url, width: e.width, status: 'running', findings: null, images: null, error: null, modules: {} });
    log(`${e.page} @ ${e.width}px`);
  }
  if (e.type === 'module') {
    const p = state.current && pageOf(state.current.page, state.current.width);
    if (p) p.modules[e.module] = e.ok ? 'ok' : 'bad';
    if (state.current) { const next = MODULES[MODULES.indexOf(e.module) + 1]; state.current.module = next || null; state.current.moduleLabel = e.label || ''; }
    if (!e.ok) log(`    ${e.module} failed: ${e.error}`);
  }
  if (e.type === 'pageDone') { const p = pageOf(e.page, e.width); if (p) { p.status = 'done'; p.findings = e.findings; p.images = e.images; } state.done.n++; state.findings += e.findings; log(`    ${e.findings} finding(s) · ${e.images} image(s)`); }
  if (e.type === 'pageError') { const p = pageOf(e.page, e.width); if (p) { p.status = 'error'; p.error = e.error; } state.done.n++; log(`    could not load: ${e.error}`); }
  if (e.type === 'done') { state.state = 'finishing'; state.current = null; state.findings = e.total; log(`Scan done: ${e.total} findings in ${e.seconds}s. Building the reports…`); }
  if (e.type === 'failed') { state.state = 'failed'; state.error = e.error; log('Failed: ' + e.error); }
}

function write() {
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(FILE, JSON.stringify(state));
}

// One lftp call, never two at once. Errors are logged and otherwise ignored:
// progress is a convenience, the scan matters.
function upload(cb) {
  if (!env.FTP_HOST) { if (cb) cb(); return; }
  if (uploading) { if (cb) cb(); return; }
  uploading = true;
  const proto = env.FTP_PROTOCOL || 'ftp', port = env.FTP_PORT || '21', dir = env.FTP_DIR || '.', verify = env.FTP_VERIFY || 'no';
  const script = `set ssl:verify-certificate ${verify}; set ftp:ssl-force true; set ftp:ssl-protect-data true; set sftp:auto-confirm yes; set net:max-retries 1; set net:timeout 15; set cmd:fail-exit false; cd "${dir}"; mkdir -p _progress; put -O _progress "${FILE}" -o ${id}.json; bye`;
  const child = spawn('lftp', ['-u', `${env.FTP_USER},${env.FTP_PASSWORD}`, `${proto}://${env.FTP_HOST}:${port}`, '-e', script], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', d => { err += d; });
  child.on('exit', code => { uploading = false; if (code !== 0 && err.trim()) console.error('progress upload: ' + err.trim().split('\n').pop()); if (cb) cb(); });
  child.on('error', e => { uploading = false; console.error('progress upload: ' + e.message); if (cb) cb(); });
}

const timer = setInterval(() => { if (!dirty) return; dirty = false; write(); upload(); }, EVERY_MS);

(async () => {
  write(); upload();
  let code = 0;
  try {
    await require('../../src/scan').run({
      url: env.URL, client: env.CLIENT || undefined,
      pages: parseInt(env.PAGES || '1', 10) || 1, widths: env.WIDTHS || null, level: env.LEVEL || 'AA',
      out: OUT, tabStops: 80, onProgress
    });
    if (state.state !== 'finishing') state.state = 'finishing';
  } catch (e) {
    onProgress({ type: 'failed', error: String((e && e.message) || e).slice(0, 300) });
    console.error(e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
    code = 2;
  }
  clearInterval(timer);
  write();
  await new Promise(r => upload(r));
  process.exit(code);
})();
