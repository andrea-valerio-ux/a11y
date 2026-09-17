#!/usr/bin/env node
'use strict';
// npm run package — builds the zips people install on another computer.
//
//   node scripts/package.js                        every platform
//   node scripts/package.js --only darwin-arm64    just one
//   node scripts/package.js --node 24.21.0         a specific Node.js instead of the latest LTS
//
// Each zip is the whole scanner, ready to run: its own Node.js (the official
// build from nodejs.org, checked against the published SHA-256 checksums), its
// dependencies already installed, the practice page, and a double-click
// starter. Nothing else needs installing except Chrome or Edge.
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const TOOL = path.join(__dirname, '..');
const OUT = path.join(TOOL, 'dist');
const CACHE = path.join(TOOL, '.cache', 'node');
const NAME = 'Accessibility Checklist Scanner';

const TARGETS = {
  'darwin-arm64': { os: 'mac', label: 'Mac (Apple silicon, M1 or later)', archive: 'tar.gz' },
  'darwin-x64':   { os: 'mac', label: 'Mac (Intel)', archive: 'tar.gz' },
  'win-x64':      { os: 'win', label: 'Windows (64-bit)', archive: 'zip' }
};

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'a11y-package' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return resolve(get(res.headers.location));
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`${url} → HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function nodeVersion() {
  const pinned = flag('node');
  if (pinned) return pinned.replace(/^v/, '');
  const index = JSON.parse(await get('https://nodejs.org/dist/index.json'));
  return index.find(r => r.lts).version.replace(/^v/, '');
}

async function fetchNode(version, target) {
  const t = TARGETS[target];
  const file = `node-v${version}-${target}.${t.archive}`;
  fs.mkdirSync(CACHE, { recursive: true });
  const local = path.join(CACHE, file);
  const sums = (await get(`https://nodejs.org/dist/v${version}/SHASUMS256.txt`)).toString();
  const line = sums.split('\n').find(l => l.trim().endsWith('  ' + file));
  if (!line) throw new Error('No published checksum for ' + file);
  const want = line.split(/\s+/)[0];
  const have = () => crypto.createHash('sha256').update(fs.readFileSync(local)).digest('hex');
  if (!fs.existsSync(local) || have() !== want) {
    process.stdout.write(`  downloading ${file} from nodejs.org… `);
    fs.writeFileSync(local, await get(`https://nodejs.org/dist/v${version}/${file}`));
    process.stdout.write(`${(fs.statSync(local).size / 1e6).toFixed(1)} MB\n`);
  }
  if (have() !== want) { fs.rmSync(local); throw new Error(`Checksum mismatch for ${file}; refusing to use it.`); }
  process.stdout.write(`  ${file}: checksum matches nodejs.org\n`);
  return { local, file, stem: file.replace(/\.(tar\.gz|zip)$/, '') };
}

// Only the node binary and its license. npm is not needed: the dependencies are already in the zip.
function extractNode(pkg, target, runtimeDir) {
  const tmp = fs.mkdtempSync(path.join(CACHE, 'x-'));
  try {
    if (TARGETS[target].archive === 'tar.gz') {
      execFileSync('tar', ['-xzf', pkg.local, '-C', tmp, `${pkg.stem}/bin/node`, `${pkg.stem}/LICENSE`]);
      fs.mkdirSync(path.join(runtimeDir, 'bin'), { recursive: true });
      fs.copyFileSync(path.join(tmp, pkg.stem, 'bin', 'node'), path.join(runtimeDir, 'bin', 'node'));
      fs.chmodSync(path.join(runtimeDir, 'bin', 'node'), 0o755);
    } else {
      execFileSync('unzip', ['-q', pkg.local, `${pkg.stem}/node.exe`, `${pkg.stem}/LICENSE`, '-d', tmp]);
      fs.mkdirSync(runtimeDir, { recursive: true });
      fs.copyFileSync(path.join(tmp, pkg.stem, 'node.exe'), path.join(runtimeDir, 'node.exe'));
    }
    fs.copyFileSync(path.join(tmp, pkg.stem, 'LICENSE'), path.join(runtimeDir, 'LICENSE-node.txt'));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// What goes in: the tool without runs, caches, build output or the dev-only bits.
const SKIP = new Set(['dist', '.cache', 'runs', '.claude', '.git', '.DS_Store', 'scripts', 'packaging', 'deploy', 'DEPLOY.md', 'web']);
function copyTool(dest) {
  fs.cpSync(TOOL, dest, { recursive: true, filter: src => {
    const rel = path.relative(TOOL, src);
    if (!rel) return true;
    if (path.basename(src) === '.DS_Store') return false;
    if (rel === path.join('node_modules', '.bin')) return false;     // symlinks, which a Windows unzip turns into junk
    return !SKIP.has(rel.split(path.sep)[0]);
  } });
}

const crlf = s => s.replace(/\r?\n/g, '\r\n');

function readme(t) {
  const mac = t.os === 'mac';
  const start = mac ? 'Start Accessibility Checklist Scanner.command' : 'Start Accessibility Checklist Scanner.bat';
  return [
    `${NAME} — ${t.label}`,
    '',
    'WHAT YOU NEED',
    mac ? '  Google Chrome (or Microsoft Edge). Nothing else: the scanner brings its own Node.js.'
        : '  Microsoft Edge, which comes with Windows, or Google Chrome. Nothing else: the scanner brings its own Node.js.',
    '',
    'TO START',
    `  1. Unzip this folder anywhere you like (for example in Documents). Keep everything inside it together.`,
    `  2. Double-click "${mac ? 'launcher/Install launcher (Mac).command' : 'launcher\\Install launcher (Windows).bat'}" once.`,
    mac ? '     The first time, macOS may say it cannot check the file. If so: right-click the file,\n     choose Open, then Open again. You only do this once.'
        : '     If Windows shows "Windows protected your PC", choose "More info", then "Run anyway".',
    '  3. Open index.html in your browser and press "Start the scanner". The first time, the browser asks',
    '     whether to open Accessibility Checklist Scanner: allow it. The scanner starts in the background and',
    '     opens in your browser. The same card offers "Stop the scanner" when you are finished.',
    `     Prefer a window you can see? Double-click "${start}" instead; it does the same in a terminal window.`,
    '  4. In the scanner, type a web address, tick the box to confirm you may scan the site, and press Start scan.',
    '     First time? Press "Try the practice page" to see what a report looks like.',
    '',
    'TO STOP',
    '  Press "Stop the scanner" on index.html. If you started it from the Start file instead, close its window.',
    '',
    'WHERE THINGS GO',
    '  Every scan is saved in a folder called a11y-checklist-runs in your home folder,',
    '  with the screenshots and the reports you build (web page, PDF, Excel, Word, CSV).',
    '',
    'PRIVACY',
    '  Everything runs on this computer. Nothing is uploaded anywhere. To the website you scan',
    '  it looks like an ordinary visit. Only scan sites you are allowed to test.',
    ''
  ].join(mac ? '\n' : '\r\n');
}

async function build(target, version, pkgVersion) {
  const t = TARGETS[target];
  const mac = t.os === 'mac';
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-package-' + target + '-'));
  const root = path.join(stage, NAME);
  fs.mkdirSync(root, { recursive: true });

  process.stdout.write(`\n${t.label}\n`);
  const pkg = await fetchNode(version, target);
  copyTool(root);
  extractNode(pkg, target, path.join(root, 'runtime'));

  // The other platform's start file and launcher helpers are noise in this one's folder.
  const otherStart = mac ? 'Start Accessibility Checklist Scanner.bat' : 'Start Accessibility Checklist Scanner.command';
  fs.rmSync(path.join(root, otherStart), { force: true });
  const startName = mac ? 'Start Accessibility Checklist Scanner.command' : 'Start Accessibility Checklist Scanner.bat';
  if (mac) fs.chmodSync(path.join(root, startName), 0o755); else fs.writeFileSync(path.join(root, startName), crlf(fs.readFileSync(path.join(root, startName), 'utf8')));
  const launcher = path.join(root, 'launcher');
  for (const f of fs.readdirSync(launcher)) {
    const isWin = f.endsWith('.bat');
    if (mac === isWin) fs.rmSync(path.join(launcher, f));
    else if (isWin) fs.writeFileSync(path.join(launcher, f), crlf(fs.readFileSync(path.join(launcher, f), 'utf8')));
    else if (f.endsWith('.command')) fs.chmodSync(path.join(launcher, f), 0o755);
  }
  fs.writeFileSync(path.join(root, 'READ ME FIRST.txt'), readme(t));
  // The launch config is for developing in this folder, not for the copy people install.
  fs.rmSync(path.join(root, '.gitignore'), { force: true });

  fs.mkdirSync(OUT, { recursive: true });
  const zip = path.join(OUT, `${NAME.replace(/ /g, '-')}-${pkgVersion}-${target}.zip`);
  fs.rmSync(zip, { force: true });
  // Plain zip keeps the execute bits the Mac files need and adds no ._ metadata files that Windows would show.
  execFileSync('zip', ['-qrX', zip, NAME], { cwd: stage });
  process.stdout.write(`  → ${path.relative(TOOL, zip)}  ${(fs.statSync(zip).size / 1e6).toFixed(1)} MB\n`);
  fs.rmSync(stage, { recursive: true, force: true });
  return zip;
}

(async () => {
  if (!fs.existsSync(path.join(TOOL, 'node_modules', 'puppeteer-core'))) {
    console.error('Run npm install first: the zips carry the installed dependencies.');
    process.exit(1);
  }
  const only = flag('only');
  const targets = only ? only.split(',') : Object.keys(TARGETS);
  for (const t of targets) if (!TARGETS[t]) { console.error('Unknown target ' + t + '. Choose from ' + Object.keys(TARGETS).join(', ')); process.exit(1); }
  const version = await nodeVersion();
  const pkgVersion = require(path.join(TOOL, 'package.json')).version;
  process.stdout.write(`Packaging ${NAME} ${pkgVersion} with Node.js ${version}\n`);
  for (const t of targets) await build(t, version, pkgVersion);
  process.stdout.write(`\nDone. Share the zips in ${path.relative(process.cwd(), OUT) || 'dist'}: one per kind of computer.\n`);
})().catch(e => { console.error('\n' + (e.message || e)); process.exit(1); });
