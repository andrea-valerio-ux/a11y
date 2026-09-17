#!/usr/bin/env node
'use strict';
const path = require('path');
const os = require('os');
const log = require('../src/util/log');

const DEFAULT_RUNS = path.join(os.homedir(), 'a11y-checklist-runs');

const USAGE = `
a11y — accessibility scanner organised around The A11Y Project checklist

  a11y ui                          open the app in your browser (no terminal needed after this)
  a11y scan <url> [options]        scan a site and write a run folder
  a11y report <run folder>         build the HTML, PDF, Excel, Word, CSV and JSON report for a run
  a11y doctor                      check this machine can run a scan

scan options
  --pages <n>            discover and scan up to n pages           default: 1
  --targets <file>       scan these addresses (one per line) instead of crawling
  --widths <list>        viewport widths, comma separated          default: 1440,390
  --level <AA|AAA>       conformance level                         default: AA
  --client <name>        name for the run folder                   default: hostname
  --out <dir>            run folder                                default: <runs>/<client>/<date>
  --runs <dir>           where runs are kept                       default: ${DEFAULT_RUNS}
  --tab-stops <n>        how far to tab through each page          default: 80
  --max-images <n>       evidence pictures per rule per page       default: 15
  --no-full-page         skip the full-page screenshot

report options
  --format <list>        html,pdf,xlsx,docx,csv,json                default: all six
  --severity <s>         only findings at or above this severity   default: all
  --no-images            leave the evidence pictures out
  --out <dir>            where to write                            default: <run>/report

ui options
  --port <n>             port to listen on                         default: 4173
  --runs <dir>           where runs are kept                       default: ${DEFAULT_RUNS}
  --no-open              do not open a browser window

Requires Node 18 or later and Google Chrome or Microsoft Edge. Set CHROME_PATH to choose a browser.
A scan sends real traffic to the site. Only scan sites you are authorised to test.
`;

function parse(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (m, c) => c.toUpperCase());
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) opts[key] = true; else { opts[key] = next; i++; }
    } else opts._.push(a);
  }
  return opts;
}

async function main() {
  const opts = parse(process.argv.slice(2));
  const command = opts._[0];
  if (!command || opts.help || opts.h) { process.stdout.write(USAGE); return 0; }
  if (opts.quiet) log.setQuiet(true);
  const runsRoot = typeof opts.runs === 'string' ? path.resolve(opts.runs) : DEFAULT_RUNS;

  switch (command) {
    case 'scan': {
      const url = opts._[1];
      if (!url) { log.fail('scan needs a url:  a11y scan https://example.com'); return 2; }
      let target;
      try { target = new URL(url.includes('://') ? url : 'https://' + url).href; } catch (e) { log.fail('not a url: ' + url); return 2; }
      const client = typeof opts.client === 'string' ? opts.client : new URL(target).hostname.replace(/^www\./, '').replace(/[^a-z0-9.-]+/gi, '-');
      const { manifest } = await require('../src/scan').run({
        url: target, client,
        pages: opts.pages ? parseInt(opts.pages, 10) : 1,
        targets: typeof opts.targets === 'string' ? opts.targets : null,
        widths: typeof opts.widths === 'string' ? opts.widths : null,
        level: typeof opts.level === 'string' ? opts.level : 'AA',
        out: typeof opts.out === 'string' ? opts.out : require('../src/ui/server').runFolder(runsRoot, client),
        tabStops: opts.tabStops ? parseInt(opts.tabStops, 10) : 80,
        maxImagesPerRule: opts.maxImages ? parseInt(opts.maxImages, 10) : 15,
        noFullPage: !!opts.noFullPage
      });
      return manifest.summary.critical > 0 ? 1 : 0;
    }
    case 'report': {
      const dir = opts._[1];
      if (!dir) { log.fail('report needs a run folder:  a11y report ~/a11y-checklist-runs/example.com/2026-09-16'); return 2; }
      const res = await require('../src/report/build').build(path.resolve(dir), {
        formats: typeof opts.format === 'string' ? opts.format.split(',') : null,
        severity: typeof opts.severity === 'string' ? opts.severity : null,
        images: !opts.noImages, out: typeof opts.out === 'string' ? opts.out : null
      });
      log.out(`\n  ${res.summary.findings} findings grouped into ${res.summary.issues} issues\n`);
      res.written.forEach(w => log.out(`    ${w.format.padEnd(5)} ${(w.bytes / 1024).toFixed(0).padStart(6)} KB  ${w.file}`));
      log.out('');
      return 0;
    }
    case 'doctor': {
      const r = await require('../src/ui/server').doctor(runsRoot);
      log.out(JSON.stringify(r, null, 2));
      return r.ok ? 0 : 1;
    }
    case 'ui': {
      const { start } = require('../src/ui/server');
      const info = await start({ port: opts.port ? parseInt(opts.port, 10) : 4173, explicitPort: !!opts.port, runsRoot });
      process.stdout.write('\n  Accessibility scanner is running.\n\n  Open this in your browser:\n  ' + info.link + '\n\n  Leave this window open while you use it. Press Ctrl+C to stop.\n\n');
      if (!opts.noOpen) {
        const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        try { require('child_process').spawn(opener, [info.link], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' }).unref(); } catch (e) { /* ignore */ }
      }
      return new Promise(() => {});
    }
    default:
      log.fail('unknown command: ' + command);
      process.stdout.write(USAGE);
      return 2;
  }
}

main().then(c => process.exit(c)).catch(e => { log.fail(e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e)); process.exit(2); });
