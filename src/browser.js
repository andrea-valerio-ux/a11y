'use strict';
// Drives the Chrome (or Edge) already installed on this machine. Nothing is
// downloaded. CHROME_PATH overrides the search.
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');
const log = require('./util/log');

const HOME = os.homedir();
const LOCAL = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  path.join(HOME, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.win32.join(LOCAL, 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

function findChrome() {
  if (process.env.CHROME_PATH) {
    if (!fs.existsSync(process.env.CHROME_PATH)) {
      throw new Error('CHROME_PATH is set but no file is there: ' + process.env.CHROME_PATH);
    }
    return process.env.CHROME_PATH;
  }
  const hit = CANDIDATES.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  if (!hit) throw new Error('No Chrome or Edge found. Install Google Chrome, or set CHROME_PATH to the binary.');
  return hit;
}

async function launch({ width = 1440, height = 900 } = {}) {
  const executablePath = findChrome();
  log.step('chrome ' + executablePath);
  return puppeteer.launch({
    executablePath,
    headless: true,
    defaultViewport: { width, height },
    args: ['--no-sandbox', '--hide-scrollbars', '--disable-features=IsolateOrigins,site-per-process',
           '--autoplay-policy=no-user-gesture-required']
  });
}

// Consent overlays sit on top of everything and poison contrast, focus order
// and screenshots. They are hidden, not accepted.
const OVERLAYS = [
  '.osano-cm-window', '.cc-window', '#onetrust-banner-sdk', '#onetrust-consent-sdk',
  '#usercentrics-root', '.truste_overlay', '.truste_box_overlay', '[id*="cookie-banner"]',
  '[class*="cookie-banner"]', '[aria-label*="cookie" i][role="dialog"]', '#CybotCookiebotDialog',
  '.qc-cmp2-container', '#didomi-host'
];

async function hideOverlays(page, extra = []) {
  return page.evaluate(list => {
    let n = 0;
    for (const one of list) {
      try {
        document.querySelectorAll(one).forEach(e => {
          if (e.offsetParent !== null || getComputedStyle(e).position === 'fixed') {
            e.style.setProperty('display', 'none', 'important'); n++;
          }
        });
      } catch (err) { /* a bad selector is not worth stopping for */ }
    }
    return n;
  }, OVERLAYS.concat(extra));
}

// Load, settle, scroll through once so lazy content appears, return to top.
async function prepare(page, url, { settle = 2000 } = {}) {
  let status = null;
  try {
    const res = await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
    status = res ? res.status() : null;
  } catch (e) {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    status = res ? res.status() : null;
  }
  await sleep(settle);
  await page.evaluate(async () => {
    const h = Math.min(document.body ? document.body.scrollHeight : 0, 20000);
    for (let y = 0; y < h; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); }
    window.scrollTo(0, 0);
  });
  await sleep(900);
  const hidden = await hideOverlays(page);
  return { hiddenOverlays: hidden, status };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = { launch, prepare, hideOverlays, findChrome, sleep };
