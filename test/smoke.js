'use strict';
// Smoke test: serve the practice page, scan it at two widths, and check the
// run folder has what a report needs: findings mapped to checklist items,
// a screenshot for findings with a position, and the checklist status file.
const fs = require('fs');
const path = require('path');
const os = require('os');

(async () => {
  const runsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-smoke-'));
  const { start } = require('../src/ui/server');
  const info = await start({ port: 4199 + Math.floor(Math.random() * 300), runsRoot });
  const checklist = require('../src/checklist');
  let failures = 0;
  const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) failures++; };

  try {
    const url = `http://127.0.0.1:${info.port}/demo/`;
    const res = await require('../src/scan').run({ url, client: 'demo', pages: 2, widths: '1280,390', level: 'AA', out: path.join(runsRoot, 'demo', 'run') });
    const f = res.findings;
    console.log(`\n  ${f.length} findings from ${res.manifest.pages.length} page-width checks in ${res.manifest.durationSeconds}s\n`);

    check(f.length > 20, 'the practice page produces findings');
    check(f.every(x => checklist.BY_ID[x.item]), 'every finding maps to a checklist item');
    check(f.every(x => x.url && x.page && (x.width || x.rule === 'TITLE-DUPLICATE')), 'every finding carries page, address and width (duplicate titles are page facts, no width)');
    const positioned = f.filter(x => x.rect && x.shot !== false);
    const withImage = positioned.filter(x => x.evidenceImage && fs.existsSync(path.join(res.out, x.evidenceImage)));
    check(withImage.length >= positioned.length * 0.9 && withImage.length > 10, `${withImage.length} of ${positioned.length} positioned findings have a screenshot on disk`);
    check(fs.existsSync(path.join(res.out, 'checklist.json')), 'checklist.json written');
    check(res.tokens && res.tokens.colors.length > 3 && res.tokens.fonts.length >= 1 && res.tokens.icons, `tokens.json written: ${res.tokens.colors.length} colors, ${res.tokens.fonts.length} typefaces, icons: ${res.tokens.icons.system}`);
    check(fs.existsSync(path.join(res.out, 'shots', 'home-390', '000-full-page.png')) || fs.existsSync(path.join(res.out, 'shots', 'demo-390', '000-full-page.png')), 'full-page screenshot written');

    const rules = new Set(f.map(x => x.rule));
    const expect = ['IMG-NO-ALT', 'ALT-FILENAME', 'CONTRAST-NORMAL-TEXT', 'LINK-GENERIC', 'DUPLICATE-ID', 'TABINDEX-POSITIVE', 'AUTOFOCUS', 'TITLE-ONLY-NAME',
      'FIELD-NO-LABEL', 'FIELD-PLACEHOLDER-ONLY', 'GROUP-NO-FIELDSET', 'TABLE-NO-TH', 'LINKS-NOT-IN-LIST', 'FAKE-BULLETS', 'HEADING-LEVEL-SKIPPED', 'FOCUS-NOT-VISIBLE',
      'NEW-WINDOW-UNANNOUNCED', 'BACKGROUND-VIDEO-NO-PAUSE', 'VIDEO-NO-CAPTIONS', 'SELECTION-LOW-CONTRAST', 'CLICKABLE-SPAN', 'LINK-USED-AS-BUTTON', 'TEXT-ALIGN-JUSTIFY',
      'HORIZONTAL-SCROLL', 'SENSORY-INSTRUCTION', 'INPUT-BORDER-LOW-CONTRAST', 'ICON-LOW-CONTRAST', 'VIEWPORT-ZOOM-DISABLED', 'LANG-MISSING', 'TEXT-STYLED-AS-HEADING',
      'IFRAME-NO-TITLE', 'TITLE-DUPLICATE', 'NO-SKIP-LINK', 'BUTTON-NO-NAME', 'HIDDEN-TAB-STOP', 'ROLE-BUTTON-ON-DIV', 'INVALID-NO-DESCRIPTION', 'TITLE-GENERIC',
      'TABLE-NO-CAPTION', 'TARGET-TOO-SMALL', 'FAST-FLASHING-ANIMATION', 'ANIMATION-IGNORES-REDUCED-MOTION', 'CONTRAST-OVER-IMAGE', 'TEXT-CLIPPED-AT-200', 'AUTOCOMPLETE-MISSING', 'LINK-COLOR-ONLY'];
    const missing = expect.filter(r => !rules.has(r));
    check(!missing.length, 'expected rules fired' + (missing.length ? ' — missing: ' + missing.join(', ') : ''));
    console.log('\n  rules seen: ' + [...rules].sort().join(', ') + '\n');

    const about = f.filter(x => x.page === 'demo-about-html');
    check(about.length < f.length / 3, 'the tidy about page produces far fewer findings than the practice page (' + about.length + ')');

    const rep = await require('../src/report/build').build(res.out, { formats: ['html', 'xlsx', 'docx', 'csv', 'json'], images: true });
    check(rep.written.length === 5 && rep.written.every(w => w.bytes > 1000), 'html, xlsx, docx, csv and json reports written');
    const zipOk = f => { const b = fs.readFileSync(f); return b[0] === 0x50 && b[1] === 0x4b && b.subarray(b.length - 22).readUInt32LE(0) === 0x06054b50; };
    check(zipOk(path.join(res.out, 'report', 'report.xlsx')) && zipOk(path.join(res.out, 'report', 'report.docx')), 'the Excel and Word files are well-formed packages');
    const htmlText = fs.readFileSync(path.join(res.out, 'report', 'report.html'), 'utf8');
    check(/data:image\/png;base64,/.test(htmlText), 'the HTML report embeds screenshots');
    check(/w3\.org\/WAI\/WCAG22\/Understanding/.test(htmlText) && /a11yproject\.com\/checklist/.test(htmlText), 'the HTML report links to the criteria and the checklist');
    check(htmlText.includes(url), 'the HTML report carries the page address');

    const { compare } = require('../src/report/compare');
    const { readRun } = require('../src/report/build');
    const cmp = compare({ dir: res.out, ...readRun(res.out) }, { dir: res.out, ...readRun(res.out) });
    check(cmp.counts.fixed === 0 && cmp.counts.new === 0 && cmp.counts.unchanged === rep.groups.length, 'a run compared with itself has no movement');

    console.log(failures ? `\n  ${failures} check(s) failed. Run folder kept at ${res.out}\n` : `\n  all checks passed. Run folder at ${res.out}\n`);
  } catch (e) {
    console.error(e); failures++;
  } finally {
    info.server.close();
    process.exit(failures ? 1 : 0);
  }
})();
