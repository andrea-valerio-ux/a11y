'use strict';
// The local app. Binds to 127.0.0.1 only and requires a token minted at
// startup, because any web page you have open can POST to localhost.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.css': 'text/css',
  '.js': 'text/javascript', '.csv': 'text/csv; charset=utf-8', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.vtt': 'text/vtt', '.mp3': 'audio/mpeg',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

function sendJSON(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(s), 'cache-control': 'no-store' });
  res.end(s);
}
function within(base, target) {
  const b = path.resolve(base) + path.sep, t = path.resolve(target);
  return t === path.resolve(base) || t.startsWith(b);
}
function readBody(req, limit, cb) {
  let body = '';
  req.on('data', c => { body += c; if (body.length > limit) req.destroy(); });
  req.on('end', () => { let o; try { o = JSON.parse(body || '{}'); } catch (e) { return cb(null); } cb(o); });
}

// <runs>/<client>/<date>, or <date>-2, -3 when that day already has a run.
function runFolder(runsRoot, client) {
  const day = new Date().toISOString().slice(0, 10);
  const base = path.join(runsRoot, client);
  let name = day, n = 1;
  while (fs.existsSync(path.join(base, name, 'run.json'))) name = `${day}-${++n}`;
  return path.join(base, name);
}

// <site>-<date>-<time>.<ext> for a report file: the run folder gives the site,
// run.json gives the moment the scan finished.
function downloadName(file) {
  const ext = path.extname(file);
  const runDir = path.dirname(path.dirname(file));
  const site = path.basename(path.dirname(runDir)).replace(/[^A-Za-z0-9.-]+/g, '-');
  let stamp = path.basename(runDir);
  try {
    const m = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
    const d = new Date(m.finishedAt);
    // Local time, the way the person remembers the scan: 2026-09-16-2038
    const two = n => String(n).padStart(2, '0');
    if (!isNaN(d)) stamp = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
  } catch (e) { /* keep the folder name */ }
  return `${site}-${stamp}${ext}`;
}

function listRuns(runsRoot) {
  const out = [];
  if (!fs.existsSync(runsRoot)) return out;
  for (const client of fs.readdirSync(runsRoot)) {
    const cdir = path.join(runsRoot, client);
    if (client.startsWith('.') || !fs.statSync(cdir).isDirectory()) continue;
    for (const date of fs.readdirSync(cdir)) {
      const dir = path.join(cdir, date);
      const manifest = path.join(dir, 'run.json');
      if (!fs.existsSync(manifest)) continue;
      try {
        const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        out.push({ client, date, dir, startUrl: m.startUrl, level: m.level, widths: m.widths, summary: m.summary, checklist: m.checklist || null,
          total: m.totalFindings, pages: (m.pages || []).length, finishedAt: m.finishedAt, seconds: m.durationSeconds, hasReport: fs.existsSync(path.join(dir, 'report', 'report.html')) });
      } catch (e) { /* half-written run */ }
    }
  }
  return out.sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
}

async function doctor(runsRoot) {
  const out = { ok: true, node: process.version, runsRoot, chrome: null, puppeteer: fs.existsSync(path.join(ROOT, 'node_modules', 'puppeteer-core')), problems: [] };
  try { out.chrome = require('../browser').findChrome(); } catch (e) { out.ok = false; out.problems.push(e.message); }
  if (!out.puppeteer) { out.ok = false; out.problems.push('puppeteer-core is not installed. Run npm install in ' + ROOT); }
  const major = parseInt(process.version.slice(1), 10);
  if (major < 18) { out.ok = false; out.problems.push('Node 18 or later is required; this is ' + process.version); }
  try { fs.mkdirSync(runsRoot, { recursive: true }); } catch (e) { out.ok = false; out.problems.push('Cannot create the runs folder ' + runsRoot); }
  return out;
}

function start({ port = 4173, runsRoot, explicitPort = false } = {}) {
  const token = crypto.randomBytes(16).toString('hex');
  const jobs = new Map();
  fs.mkdirSync(runsRoot, { recursive: true });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const route = url.pathname;
    // "Is the scanner running?" asked by the start page, which is opened from
    // disk and so is on another origin. An empty 204 and nothing else: it tells
    // that page only what a refused connection would have told it anyway.
    if (route === '/ping') { res.writeHead(204, { 'cache-control': 'no-store', 'access-control-allow-origin': '*' }); return res.end(); }
    const origin = req.headers.origin;
    if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return sendJSON(res, 403, { error: 'cross-origin requests are refused' });

    if (route === '/') {
      const html = fs.readFileSync(path.join(__dirname, 'app.html'), 'utf8').replace('__TOKEN__', token).replace('__DEMO__', `http://127.0.0.1:${port}/demo/`);
      res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
      return res.end(html);
    }
    if (route === '/checklist.js') {
      // The checklist data, for the app to render items with.
      const cl = require('../checklist');
      const body = 'window.CHECKLIST=' + JSON.stringify({ SECTIONS: cl.SECTIONS, ITEMS: cl.ITEMS.map(i => cl.itemFor(i.id)) }) + ';';
      res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'no-store' });
      return res.end(body);
    }
    // The practice page: a fixed local file with deliberate problems, so a
    // first scan needs no authorization question.
    if (route === '/demo' || route.startsWith('/demo/')) {
      const rel = (route === '/demo' || route === '/demo/') ? 'index.html' : decodeURIComponent(route.slice('/demo/'.length));
      const dir = path.join(ROOT, 'test', 'fixture');
      const file = path.join(dir, rel);
      if (!within(dir, file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      return res.end(fs.readFileSync(file));
    }

    if (route.startsWith('/api/') || route === '/file') {
      const given = url.searchParams.get('token') || req.headers['x-a11y-token'];
      if (given !== token) return sendJSON(res, 401, { error: 'bad or missing token' });
    }

    if (route === '/api/doctor') return doctor(runsRoot).then(r => sendJSON(res, 200, r)).catch(e => sendJSON(res, 500, { error: String(e.message || e) }));
    if (route === '/api/runs') return sendJSON(res, 200, { runsRoot, runs: listRuns(runsRoot) });

    if (route === '/api/run') {
      const dir = url.searchParams.get('dir') || '';
      if (!within(runsRoot, dir)) return sendJSON(res, 403, { error: 'outside the runs folder' });
      try {
        const read = f => fs.existsSync(path.join(dir, f)) ? JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) : null;
        const { group, summarize } = require('../report/group');
        const findings = read('findings.json') || [];
        const groups = group(findings);
        return sendJSON(res, 200, { dir, run: read('run.json'), findings, checklist: read('checklist.json'), tokens: read('tokens.json'), groups: groups.map(g => ({ ...g, sample: undefined })), summary: summarize(findings, groups),
          reports: fs.existsSync(path.join(dir, 'report')) ? fs.readdirSync(path.join(dir, 'report')).filter(f => f.startsWith('report.')).map(f => ({ format: path.extname(f).slice(1), file: path.join(dir, 'report', f), bytes: fs.statSync(path.join(dir, 'report', f)).size })) : [] });
      } catch (e) { return sendJSON(res, 404, { error: 'run not readable: ' + String(e.message) }); }
    }

    if (route === '/file') {
      const f = url.searchParams.get('path') || '';
      if (!within(runsRoot, f) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
      const headers = { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' };
      if (url.searchParams.get('download')) headers['content-disposition'] = `attachment; filename="${downloadName(f)}"`;
      res.writeHead(200, headers);
      return fs.createReadStream(f).pipe(res);
    }

    if (route === '/api/report' && req.method === 'POST') {
      return readBody(req, 1e5, async o => {
        if (!o) return sendJSON(res, 400, { error: 'bad body' });
        if (!within(runsRoot, o.dir || '')) return sendJSON(res, 403, { error: 'outside the runs folder' });
        try {
          const out = await require('../report/build').build(o.dir, { formats: o.formats, images: o.images !== false, severity: o.severity || null });
          return sendJSON(res, 200, { outDir: out.outDir, files: out.written, issues: out.groups.length, findings: out.summary.findings });
        } catch (e) { return sendJSON(res, 500, { error: String(e.message || e) }); }
      });
    }

    if (route === '/api/compare') {
      const dir = url.searchParams.get('dir') || '', baseline = url.searchParams.get('baseline') || '';
      if (!within(runsRoot, dir) || !within(runsRoot, baseline)) return sendJSON(res, 403, { error: 'outside the runs folder' });
      try {
        const { readRun } = require('../report/build');
        const { compare } = require('../report/compare');
        return sendJSON(res, 200, compare({ dir: baseline, ...readRun(baseline) }, { dir, ...readRun(dir) }));
      } catch (e) { return sendJSON(res, 500, { error: String(e.message || e) }); }
    }

    if (route === '/api/runs/clear' && req.method === 'POST') {
      return readBody(req, 1e4, o => {
        if (!o || o.confirm !== true) return sendJSON(res, 400, { error: 'not confirmed' });
        let removed = 0;
        for (const name of fs.readdirSync(runsRoot)) {
          if (name.startsWith('.')) continue;
          const dir = path.join(runsRoot, name);
          if (!within(runsRoot, dir) || !fs.statSync(dir).isDirectory()) continue;
          for (const day of fs.readdirSync(dir)) if (fs.existsSync(path.join(dir, day, 'run.json'))) removed++;
          fs.rmSync(dir, { recursive: true, force: true });
        }
        return sendJSON(res, 200, { removed });
      });
    }
    if (route === '/api/run/delete' && req.method === 'POST') {
      return readBody(req, 1e4, o => {
        if (!o || !within(runsRoot, o.dir || '') || path.resolve(o.dir) === path.resolve(runsRoot) || !fs.existsSync(path.join(o.dir, 'run.json'))) return sendJSON(res, 400, { error: 'not a run folder' });
        fs.rmSync(o.dir, { recursive: true, force: true });
        const parent = path.dirname(o.dir);
        try { if (!fs.readdirSync(parent).filter(x => !x.startsWith('.')).length) fs.rmSync(parent, { recursive: true, force: true }); } catch (e) { /* ignore */ }
        return sendJSON(res, 200, { ok: true });
      });
    }

    if (route === '/api/scan' && req.method === 'POST') {
      return readBody(req, 1e5, o => {
        if (!o) return sendJSON(res, 400, { error: 'bad body' });
        if (!o.authorized) return sendJSON(res, 400, { error: 'A scan sends real traffic. Confirm you are authorized to scan this site.' });
        let target;
        try { target = new URL(String(o.url).includes('://') ? o.url : 'https://' + o.url).href; } catch (e) { return sendJSON(res, 400, { error: 'That does not look like a web address.' }); }
        const client = (o.client || new URL(target).hostname.replace(/^www\./, '')).replace(/[^a-z0-9.-]+/gi, '-').slice(0, 60) || 'site';
        const id = crypto.randomBytes(8).toString('hex');
        const job = { id, events: [], listeners: [], done: false, url: target };
        jobs.set(id, job);
        const push = evt => { job.events.push(evt); job.listeners.forEach(l => l(evt)); if (evt.type === 'done' || evt.type === 'failed') job.done = true; };
        const child = spawn(process.execPath, [path.join(__dirname, 'runner.js')], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
        child.stdin.end(JSON.stringify({ url: target, client, pages: o.pages || 1, widths: o.widths || '1440,390', level: o.level || 'AA', out: runFolder(runsRoot, client), tabStops: o.tabStops || 80 }));
        let buf = '';
        child.stdout.on('data', d => { buf += d.toString(); const lines = buf.split('\n'); buf = lines.pop(); for (const line of lines) { if (line.trim()) { try { push(JSON.parse(line)); } catch (e) { /* not json */ } } } });
        let stderr = '';
        child.stderr.on('data', d => { stderr += d.toString().slice(0, 4000); });
        child.on('exit', code => { if (!job.done) push({ type: 'failed', error: stderr.trim().split('\n').slice(-3).join(' ') || ('scan exited with code ' + code) }); });
        job.child = child;
        sendJSON(res, 200, { id });
      });
    }
    if (route === '/api/stream') {
      const job = jobs.get(url.searchParams.get('id'));
      if (!job) return sendJSON(res, 404, { error: 'no such scan' });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      const write = evt => res.write('data: ' + JSON.stringify(evt) + '\n\n');
      job.events.forEach(write);
      if (job.done) return res.end();
      const listener = evt => { write(evt); if (evt.type === 'done' || evt.type === 'failed') res.end(); };
      job.listeners.push(listener);
      req.on('close', () => { job.listeners = job.listeners.filter(l => l !== listener); });
      return;
    }
    if (route === '/api/stop' && req.method === 'POST') {
      const job = jobs.get(url.searchParams.get('id'));
      if (job && job.child) { try { job.child.kill(); } catch (e) { /* ignore */ } }
      return sendJSON(res, 200, { stopped: !!job });
    }
    res.writeHead(404); res.end('not found');
  });

  // With no explicit port, walk up from the default until one is free: the
  // usual reason 4173 is taken is another scanner left running.
  const attempts = explicitPort ? [port] : Array.from({ length: 20 }, (_, i) => port + i);
  return new Promise((resolve, reject) => {
    // One 'listening' handler, reading the port the socket really got: a
    // per-attempt callback would fire for the first attempt even when it was
    // the retry that succeeded, and report the wrong port.
    server.once('listening', () => {
      port = server.address().port;
      resolve({ server, link: `http://127.0.0.1:${port}/?token=${token}`, token, port });
    });
    const tryPort = i => {
      const pt = attempts[i];
      server.once('error', e => {
        if (e.code === 'EADDRINUSE' && i + 1 < attempts.length) return tryPort(i + 1);
        reject(e.code === 'EADDRINUSE' ? new Error(`Port ${pt} is already in use. Try:  a11y ui --port ${pt + 1}`) : e);
      });
      server.listen(pt, '127.0.0.1');
    };
    tryPort(0);
  });
}

module.exports = { start, listRuns, runFolder, doctor, downloadName };
