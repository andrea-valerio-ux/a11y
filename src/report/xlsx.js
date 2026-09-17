'use strict';
// The Excel deliverable, written as OOXML by hand so the tool keeps its one
// dependency. Seven sheets:
//
//   Read me       what the workbook is
//   Checklist     one row per checklist item: status, criterion, counts, links
//   Summary       counts by severity, by status, by width
//   Issues        one row per grouped issue, worst first, picture in the cell
//   Findings      one row per finding and page, for tickets
//   Pages         every page and width that was opened
//   Measurements  the numbers behind each issue
const fs = require('fs');
const path = require('path');
const { zip, xml } = require('../util/zip');
const { issueId } = require('./group');
const checklist = require('../checklist');

const EMU = 9525;
const PX_TO_PT = 0.75;
const MAX_IMG_W = 320;

function colName(i) {
  let s = '';
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

// Style indexes, in the order written into styles.xml below.
const S = { plain: 0, header: 1, title: 2, sub: 3, wrap: 4, mono: 5, bold: 6, critical: 7, serious: 8, moderate: 9, minor: 10, link: 11,
            fail: 12, pass: 13, review: 14, na: 15 };
const SEV_STYLE = { critical: S.critical, serious: S.serious, moderate: S.moderate, minor: S.minor };
const STATUS_STYLE = { fail: S.fail, pass: S.pass, review: S.review, na: S.na };
const STATUS_LABEL = { fail: 'Fails', pass: 'Passes', review: 'Needs a person', na: 'Not applicable' };

function cell(ref, value, style) {
  if (value === '' || value == null) return `<c r="${ref}"${style ? ` s="${style}"` : ''}/>`;
  if (typeof value === 'number') return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xml(String(value).slice(0, 32000))}</t></is></c>`;
}

function sheetXml(rows, opts = {}) {
  const merges = [];
  const body = rows.map((row, r) => {
    const span = row.merge;
    const cells = (row.cells || row).map((c, i) => {
      const v = (c && typeof c === 'object' && 'value' in c) ? c.value : c;
      const st = (c && typeof c === 'object') ? c.style : undefined;
      return cell(colName(i) + (r + 1), v, st);
    });
    if (span > 1) {
      for (let i = cells.length; i < span; i++) cells.push(cell(colName(i) + (r + 1), '', row.mergeStyle));
      merges.push(`A${r + 1}:${colName(span - 1)}${r + 1}`);
    }
    const h = row.height ? ` ht="${row.height}" customHeight="1"` : '';
    return `<row r="${r + 1}"${h}>${cells.join('')}</row>`;
  }).join('');
  const cols = (opts.widths || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const freeze = opts.freeze
    ? `<sheetView workbookViewId="0"><pane ySplit="${opts.freeze}" topLeftCell="A${opts.freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView>`
    : `<sheetView workbookViewId="0"/>`;
  // Schema order inside <worksheet> is strict: sheetData, autoFilter, mergeCells, hyperlinks, drawing.
  const filter = opts.autoFilter ? `<autoFilter ref="${opts.autoFilter}"/>` : '';
  const merged = merges.length ? `<mergeCells count="${merges.length}">` + merges.map(ref => `<mergeCell ref="${ref}"/>`).join('') + `</mergeCells>` : '';
  const hlinks = (opts.hyperlinks || []).length
    ? `<hyperlinks>` + opts.hyperlinks.map(h => `<hyperlink ref="${h.ref}" r:id="${h.rid}"${h.tooltip ? ` tooltip="${xml(h.tooltip)}"` : ''}/>`).join('') + `</hyperlinks>` : '';
  const drawing = opts.drawingId ? `<drawing r:id="rId${opts.drawingId}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetViews>${freeze}</sheetViews>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${body}</sheetData>${filter}${merged}${hlinks}${drawing}</worksheet>`;
}

function pngSize(buf) {
  if (buf.length < 24) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function drawingXml(pics) {
  // One anchor per picture; rId(i+1) in the drawing's own rels points at the media file.
  const anchors = pics.map((p, i) =>
    `<xdr:oneCellAnchor><xdr:from><xdr:col>${p.col}</xdr:col><xdr:colOff>19050</xdr:colOff><xdr:row>${p.row}</xdr:row><xdr:rowOff>19050</xdr:rowOff></xdr:from>` +
    `<xdr:ext cx="${Math.round(p.w * EMU)}" cy="${Math.round(p.h * EMU)}"/>` +
    `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="Evidence ${i + 1}" descr="${xml(p.alt || 'Evidence screenshot')}"/><xdr:cNvPicPr/></xdr:nvPicPr>` +
    `<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId${i + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
    `<xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>`;
}

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="12">` +
    `<font><sz val="11"/><name val="Calibri"/><color rgb="FF1C1F33"/></font>` +          // 0 plain
    `<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>` +      // 1 header
    `<font><b/><sz val="16"/><name val="Calibri"/><color rgb="FF1C1F33"/></font>` +      // 2 title
    `<font><sz val="10"/><name val="Calibri"/><color rgb="FF6B6F86"/></font>` +          // 3 sub
    `<font><name val="Consolas"/><sz val="10"/><color rgb="FF474B63"/></font>` +         // 4 mono
    `<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FF1C1F33"/></font>` +      // 5 bold
    `<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>` +      // 6 bold white
    `<font><u/><sz val="10"/><name val="Consolas"/><color rgb="FF2B5FD9"/></font>` +     // 7 link
    `<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFB93A37"/></font>` +      // 8 fail
    `<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FF1E7A4B"/></font>` +      // 9 pass
    `<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FF9A5B00"/></font>` +      // 10 review
    `<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FF8A8DA0"/></font>` +      // 11 na
  `</fonts>` +
  `<fills count="11">` +
    `<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FF1C1F33"/></patternFill></fill>` +   // 2 header
    `<fill><patternFill patternType="solid"><fgColor rgb="FFB93A37"/></patternFill></fill>` +   // 3 critical
    `<fill><patternFill patternType="solid"><fgColor rgb="FF9A5B00"/></patternFill></fill>` +   // 4 serious
    `<fill><patternFill patternType="solid"><fgColor rgb="FF2B5FD9"/></patternFill></fill>` +   // 5 moderate
    `<fill><patternFill patternType="solid"><fgColor rgb="FFEEF1F6"/></patternFill></fill>` +   // 6 minor
    `<fill><patternFill patternType="solid"><fgColor rgb="FFF8E3E2"/></patternFill></fill>` +   // 7 fail
    `<fill><patternFill patternType="solid"><fgColor rgb="FFDDF1E4"/></patternFill></fill>` +   // 8 pass
    `<fill><patternFill patternType="solid"><fgColor rgb="FFF7E8CC"/></patternFill></fill>` +   // 9 review
    `<fill><patternFill patternType="solid"><fgColor rgb="FFEEEFF3"/></patternFill></fill>` +   // 10 na
  `</fills>` +
  `<borders count="2"><border/><border><bottom style="thin"><color rgb="FFDED9D0"/></bottom></border></borders>` +
  `<cellStyleXfs count="1"><xf/></cellStyleXfs>` +
  `<cellXfs count="16">` +
    `<xf fontId="0" applyFont="1" borderId="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
    `<xf fontId="1" fillId="2" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>` +
    `<xf fontId="2" applyFont="1"/>` +
    `<xf fontId="3" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
    `<xf fontId="0" applyFont="1" borderId="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
    `<xf fontId="4" applyFont="1" borderId="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
    `<xf fontId="5" applyFont="1" borderId="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
    `<xf fontId="6" fillId="3" applyFont="1" applyFill="1" borderId="1" applyAlignment="1"><alignment vertical="top" horizontal="center" wrapText="1"/></xf>` +
    `<xf fontId="6" fillId="4" applyFont="1" applyFill="1" borderId="1" applyAlignment="1"><alignment vertical="top" horizontal="center" wrapText="1"/></xf>` +
    `<xf fontId="6" fillId="5" applyFont="1" applyFill="1" borderId="1" applyAlignment="1"><alignment vertical="top" horizontal="center" wrapText="1"/></xf>` +
    `<xf fontId="5" fillId="6" applyFont="1" applyFill="1" borderId="1" applyAlignment="1"><alignment vertical="top" horizontal="center" wrapText="1"/></xf>` +
    `<xf fontId="7" applyFont="1" borderId="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
    `<xf fontId="8" fillId="7" applyFont="1" applyFill="1" borderId="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
    `<xf fontId="9" fillId="8" applyFont="1" applyFill="1" borderId="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
    `<xf fontId="10" fillId="9" applyFont="1" applyFill="1" borderId="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
    `<xf fontId="11" fillId="10" applyFont="1" applyFill="1" borderId="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
  `</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function addressOf(g, page, meta) {
  if (g.urls && g.urls[page]) return g.urls[page];
  const hit = (meta.pageList || []).find(p => p.page === page);
  if (hit && hit.url) return hit.url;
  return meta.startUrl || '';
}

// Every URL written into a sheet is registered once as a relationship, so the
// cell is clickable rather than merely blue.
function linker(startId) {
  const rels = [];
  const seen = new Map();
  return {
    rels, links: [],
    add(url, row, col, tooltip) {
      if (!url) return;
      let rid = seen.get(url);
      if (!rid) { rid = `rId${startId + rels.length}`; seen.set(url, rid); rels.push({ id: rid, url }); }
      this.links.push({ ref: colName(col) + (row + 1), rid, tooltip });
    }
  };
}

const title = (text, span) => ({ merge: span, cells: [{ value: text, style: S.title }] });
const note = (text, span, height) => ({ merge: span, height: height || 30, cells: [{ value: text, style: S.sub }] });
const head = cols => cols.map(h => ({ value: h, style: S.header }));

function build(groups, findings, meta, opts = {}) {
  const withImages = opts.images !== false;
  const id = g => issueId(groups, g);
  const cl = meta.checklist || { items: {}, totals: {} };
  const itemOf = i => checklist.itemFor(i) || {};

  // ---- Read me
  const readme = [
    title(`Accessibility report – ${meta.client}`, 2), note(meta.startUrl, 2, 18), [],
    { merge: 2, cells: [{ value: 'What this is', style: S.bold }] },
    note(`${meta.summary.findings} findings from ${meta.pages} page-width checks, grouped into ${meta.summary.issues} issues by what causes them, ` +
         `and organized under the ${checklist.ITEMS.length} items of The A11Y Project checklist. Scanned ${meta.date}, WCAG 2.2 level ${meta.level}, widths ${(meta.widths || []).join(', ')}px.`, 2, 44),
    [],
    { merge: 2, cells: [{ value: 'How to read it', style: S.bold }] },
    note('Every issue carries a screenshot with the affected element outlined in red, the explanation of what was measured, the checklist item and WCAG criterion it fails, a link to the criterion, and the address of every page it was seen on. ' +
         'Checklist items marked "needs a person" are the parts of the checklist a scanner cannot decide; the relevant elements are listed so the check is quick.', 2, 58),
    [],
    { merge: 2, cells: [{ value: 'The sheets', style: S.bold }] },
    [{ value: 'Checklist', style: S.mono }, { value: 'One row per checklist item: status, criterion, counts, what the rule is about, how to fix it, links', style: S.sub }],
    [{ value: 'Summary', style: S.mono }, { value: 'Counts by severity, by checklist status and by screen width', style: S.sub }],
    [{ value: 'Issues', style: S.mono }, { value: 'One row per issue and width, worst first, with the evidence picture in the last column', style: S.sub }],
    [{ value: 'Findings', style: S.mono }, { value: 'One row per finding and page, each with its address and its screenshot, for raising tickets', style: S.sub }],
    [{ value: 'Pages', style: S.mono }, { value: 'Every page and width the scanner opened', style: S.sub }],
    [{ value: 'Measurements', style: S.mono }, { value: 'The numbers behind each issue', style: S.sub }],
    [{ value: 'Tokens', style: S.mono }, { value: 'Design tokens as used: colors, typefaces, icon system and CSS variables with raw and resolved values', style: S.sub }]
  ];

  // ---- Checklist
  const clHead = ['Section', 'Checklist item', 'WCAG', 'Criterion', 'Level', 'Status', 'Issues', 'Findings', 'Pages affected', 'Notes', 'What the rule is about', 'How to fix it', 'Criterion link', 'Checklist link'];
  const clLinks = linker(1);
  const clRows = [title('Checklist', clHead.length), note('The A11Y Project checklist, filled in for this site. Fails beats needs-a-person beats passes beats not-applicable across the pages scanned.', clHead.length, 18), [], head(clHead)];
  for (const it of checklist.ITEMS) {
    const item = itemOf(it.id), st = (cl.items && cl.items[it.id]) || { status: 'na', findings: 0, pages: [], notes: [] };
    const issues = groups.filter(g => g.item === it.id).length;
    const r = clRows.length;
    clLinks.add(item.criterion.url, r, 12, 'Understanding ' + item.criterion.code);
    clLinks.add(item.checklistUrl, r, 13, 'This item on the checklist');
    clRows.push([
      { value: item.sectionTitle, style: S.plain }, { value: item.title, style: S.wrap },
      { value: item.criterion.code, style: S.mono }, { value: item.criterion.name, style: S.plain }, { value: item.criterion.level, style: S.plain },
      { value: STATUS_LABEL[st.status], style: STATUS_STYLE[st.status] }, { value: issues, style: S.plain }, { value: st.findings || 0, style: S.plain },
      { value: (st.pages || []).join(', '), style: S.wrap }, { value: (st.notes || []).join(' '), style: S.wrap },
      { value: item.about, style: S.wrap }, { value: item.fix, style: S.wrap },
      { value: item.criterion.url, style: S.link }, { value: item.checklistUrl, style: S.link }
    ]);
  }

  // ---- Summary
  const summaryRows = [title('Summary', 3), note(`${meta.summary.findings} findings grouped into ${meta.summary.issues} issues`, 3, 18), [],
    head(['Severity', 'Issues', 'Findings'])];
  for (const sev of ['critical', 'serious', 'moderate', 'minor']) {
    summaryRows.push([{ value: sev, style: SEV_STYLE[sev] }, { value: meta.summary.bySeverity[sev] || 0, style: S.plain }, { value: findings.filter(f => f.severity === sev).length, style: S.plain }]);
  }
  summaryRows.push([], head(['Checklist status', 'Items', '']));
  for (const st of ['fail', 'review', 'pass', 'na']) summaryRows.push([{ value: STATUS_LABEL[st], style: STATUS_STYLE[st] }, { value: (cl.totals && cl.totals[st]) || 0, style: S.plain }, { value: '', style: S.plain }]);
  if ((meta.summary.widths || []).length > 1) {
    summaryRows.push([], head(['Screen width', 'Issues', '']));
    for (const w of meta.summary.widths) summaryRows.push([{ value: `${w}px`, style: S.plain }, { value: meta.summary.byWidth[w], style: S.plain }, { value: '', style: S.plain }]);
    summaryRows.push([], note(`Widths are counted separately: a page can fail at one and pass at another. Behind these are ${meta.summary.causes} distinct underlying problems.`, 3));
  }

  // ---- pictures: stored once, anchored wherever they are shown
  const media = [], mediaByFile = new Map();
  const pictureFor = (rel, alt) => {
    if (!withImages || !rel) return null;
    const file = path.join(meta.dir, rel);
    let m = mediaByFile.get(file);
    if (!m) {
      if (!fs.existsSync(file)) return null;
      const data = fs.readFileSync(file), size = pngSize(data);
      if (!size) return null;
      m = { index: media.length + 1, data, size };
      media.push(m); mediaByFile.set(file, m);
    }
    const scale = Math.min(1, MAX_IMG_W / m.size.width);
    return { mediaIndex: m.index, w: Math.round(m.size.width * scale), h: Math.round(m.size.height * scale), alt };
  };

  // ---- Issues, with a picture per row
  const pics = [];
  const isHead = ['ID', 'Severity', 'Section', 'Checklist item', 'WCAG', 'Width', 'Issue', 'Explanation', 'Element', 'Pages', 'Address', 'Occurrences', 'Rule', 'Criterion link', 'Evidence'];
  const isLinks = linker(2);   // rId1 is the drawing
  const isRows = [title('Issues', isHead.length), note('One row per issue and screen width, worst first. The picture in the last column shows the element outlined in red on the page.', isHead.length, 18), [], head(isHead)];
  for (const g of groups) {
    const item = itemOf(g.item), r = isRows.length;
    let height = 22;
    const pic = pictureFor(g.evidenceImage, g.title);
    if (pic) { pics.push({ ...pic, col: isHead.length - 1, row: r }); height = Math.max(height, Math.round(pic.h * PX_TO_PT) + 6); }
    const address = addressOf(g, g.pages[0], meta);
    isLinks.add(address, r, 10, 'Open the page');
    isLinks.add(item.criterion && item.criterion.url, r, 13, 'Understanding ' + (item.criterion || {}).code);
    isRows.push({ height, cells: [
      { value: id(g), style: S.mono }, { value: g.severity, style: SEV_STYLE[g.severity] }, { value: item.sectionTitle || '', style: S.plain }, { value: item.title || g.item, style: S.wrap },
      { value: (item.criterion || {}).code || '', style: S.mono }, { value: g.width || 'all', style: S.plain }, { value: g.title, style: S.wrap }, { value: g.detail || '', style: S.wrap },
      { value: [g.path, g.snippet].filter(Boolean).join('\n'), style: S.mono }, { value: g.pageCount, style: S.plain }, { value: address, style: S.link },
      { value: g.occurrences, style: S.plain }, { value: g.rule, style: S.mono }, { value: (item.criterion || {}).url || '', style: S.link }, { value: '', style: S.plain }
    ] });
  }

  // ---- Findings: one row per finding and page
  const fHead = ['Issue ID', 'Severity', 'Section', 'Checklist item', 'WCAG', 'Rule', 'Finding', 'Explanation', 'Page', 'Address', 'Width', 'Element', 'Criterion link', 'Checklist link', 'Screenshot'];
  const fLinks = linker(2);   // rId1 is the drawing
  const fPics = [];
  const MAX_FINDING_PICS = 2000;
  const fRows = [title('Findings', fHead.length), note('One row per finding: each element on each page at each width. The picture in the last column shows the element outlined in red on the page. Raise a ticket from a row.', fHead.length, 18), [], head(fHead)];
  const keyOfGroup = new Map(groups.map(g => [g.key, id(g)]));
  const { keyOf } = require('./group');
  for (const f of findings) {
    const item = itemOf(f.item), r = fRows.length;
    fLinks.add(f.url, r, 9, 'Open the page');
    fLinks.add(item.criterion && item.criterion.url, r, 12, 'Understanding ' + (item.criterion || {}).code);
    fLinks.add(item.checklistUrl, r, 13, 'This item on the checklist');
    let height = 22;
    const pic = fPics.length < MAX_FINDING_PICS ? pictureFor(f.evidenceImage, f.title) : null;
    if (pic) { fPics.push({ ...pic, col: fHead.length - 1, row: r }); height = Math.max(height, Math.round(pic.h * PX_TO_PT) + 6); }
    fRows.push({ height, cells: [
      { value: keyOfGroup.get(keyOf(f)) || '', style: S.mono }, { value: f.severity, style: SEV_STYLE[f.severity] }, { value: item.sectionTitle || '', style: S.plain }, { value: item.title || f.item, style: S.wrap },
      { value: (item.criterion || {}).code || '', style: S.mono }, { value: f.rule, style: S.mono }, { value: f.title, style: S.wrap }, { value: f.detail || '', style: S.wrap },
      { value: f.page, style: S.plain }, { value: f.url, style: S.link }, { value: f.width || 'all', style: S.plain }, { value: [f.path, f.snippet].filter(Boolean).join('\n'), style: S.mono },
      { value: (item.criterion || {}).url || '', style: S.link }, { value: item.checklistUrl || '', style: S.link },
      { value: pic ? '' : (f.evidenceSkipped ? 'no picture: over the budget of 15 pictures per rule per page; the Issues sheet shows this problem' : f.shot === false ? 'no picture: this finding comes from a measurement (focus state, zoom, page settings), not from a spot on the page' : f.rect ? 'no picture: the screenshot could not be taken' : 'no picture: this finding is about the page as a whole, not one element'), style: pic ? S.plain : S.sub }
    ] });
  }

  // ---- Pages
  const pRows = [title('Pages', 6), note('Every page and width the scanner opened, and what it found there.', 6, 18), [], head(['Page', 'Width', 'Title', 'Findings', 'Address', 'Full-page screenshot'])];
  const pLinks = linker(1);
  for (const pg of (meta.pageList || [])) {
    pLinks.add(pg.url, pRows.length, 4, 'Open the page');
    pRows.push([{ value: pg.page || '', style: S.plain }, { value: pg.width || '', style: S.plain }, { value: pg.title || '', style: S.wrap }, { value: pg.error ? 'could not load: ' + pg.error : (pg.findings != null ? pg.findings : ''), style: S.plain },
      { value: pg.url || '', style: S.link }, { value: pg.fullPage ? path.join(meta.dir, pg.fullPage) : '', style: S.mono }]);
  }

  // ---- Measurements
  const mRows = [title('Measurements', 7), note('What was measured for each issue, so a finding can be checked rather than taken on trust.', 7, 18), [], head(['ID', 'Width', 'Issue', 'Measured', 'Required', 'Method', 'Full evidence'])];
  for (const g of groups) {
    const e = g.evidence || {};
    mRows.push([{ value: id(g), style: S.mono }, { value: g.width || 'all', style: S.plain }, { value: g.title, style: S.wrap },
      { value: e.ratio != null ? String(e.ratio) : (e.size ? String(e.size) : (e.grade != null ? String(e.grade) : '')), style: S.plain },
      { value: e.required != null ? String(e.required) : '', style: S.plain }, { value: e.method || '', style: S.plain }, { value: JSON.stringify(e).slice(0, 900), style: S.mono }]);
  }

  // ---- Tokens: colors, typography, iconography and variables
  const tk = meta.tokens;
  const tRows = [title('Design tokens', 7), note('What the site is built from, as painted: colors and typefaces in use with the CSS variables that produce them, the icon system, and every custom property declared in the stylesheets.', 7, 30), []];
  if (tk) {
    tRows.push(head(['Color', 'Value', 'Variables', 'Used for', 'Uses', 'Pages', 'Where']));
    for (const c of tk.colors) tRows.push([{ value: '', style: S.plain }, { value: c.value, style: S.mono }, { value: c.variables.join('\n'), style: S.mono }, { value: Object.keys(c.props).join(', '), style: S.wrap }, { value: c.hits, style: S.plain }, { value: c.pages, style: S.plain }, { value: c.where.join(', '), style: S.mono }]);
    tRows.push([], head(['Typeface', 'Source', 'Variables', 'Weights', 'Sizes (px)', 'Uses', 'Roles']));
    for (const f of tk.fonts) tRows.push([{ value: f.family, style: S.bold }, { value: f.webfont ? 'webfont' : 'system font', style: S.plain }, { value: f.variables.join('\n'), style: S.mono }, { value: Object.keys(f.weights).sort().join(', '), style: S.plain }, { value: Object.entries(f.sizes).sort((a, b) => b[1] - a[1]).map(([k]) => k).join(', '), style: S.wrap }, { value: f.hits, style: S.plain }, { value: Object.entries(f.roles || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(', '), style: S.wrap }]);
    tRows.push([], head(['Iconography', 'Detail', '', '', 'Count', '', '']));
    tRows.push([{ value: 'Icon system', style: S.bold }, { value: tk.icons.system, style: S.plain }, '', '', { value: '', style: S.plain }, '', '']);
    for (const l of tk.icons.libraries) tRows.push([{ value: l.name, style: S.plain }, { value: l.hint + (l.weak ? ' (guessed from generic classes)' : ''), style: S.wrap }, '', '', { value: l.count, style: S.plain }, '', '']);
    tRows.push([{ value: 'Inline SVG icons', style: S.plain }, { value: 'svg elements up to 64px', style: S.plain }, '', '', { value: tk.icons.inlineSvg, style: S.plain }, '', '']);
    tRows.push([{ value: 'Sprite uses', style: S.plain }, { value: tk.icons.spriteFiles.join(', '), style: S.wrap }, '', '', { value: tk.icons.sprite, style: S.plain }, '', '']);
    tRows.push([{ value: 'SVG image icons', style: S.plain }, { value: 'img elements up to 48px with an .svg source', style: S.plain }, '', '', { value: tk.icons.svgImg, style: S.plain }, '', '']);
    if (tk.icons.iconFonts.length) tRows.push([{ value: 'Icon fonts', style: S.plain }, { value: tk.icons.iconFonts.join(', '), style: S.wrap }, '', '', '', '', '']);
    for (const c of tk.icons.colors) tRows.push([{ value: 'Icon color', style: S.plain }, { value: c.value, style: S.mono }, { value: c.variables.join('\n'), style: S.mono }, '', { value: c.hits, style: S.plain }, '', '']);
    tRows.push([], head(['Variable', 'Kind', 'Raw value', 'Resolved value', 'Declared on', 'Pages', '']));
    for (const v of tk.variables) tRows.push([{ value: v.name, style: S.mono }, { value: v.kind, style: S.plain }, { value: v.raw, style: S.mono }, { value: v.resolved || '', style: S.mono }, { value: v.selector, style: S.mono }, { value: v.pages, style: S.plain }, '']);
  } else tRows.push(note('This run was made before the token inventory existed. Scan the site again to fill this sheet.', 7));

  // ---- assemble
  const sheets = [
    { name: 'Read me', xml: sheetXml(readme, { widths: [22, 110] }) },
    { name: 'Checklist', links: clLinks, xml: sheetXml(clRows, { widths: [16, 60, 8, 26, 7, 16, 8, 9, 30, 40, 70, 70, 60, 60], freeze: 4, autoFilter: `A4:${colName(clHead.length - 1)}${clRows.length}`, hyperlinks: clLinks.links }) },
    { name: 'Summary', xml: sheetXml(summaryRows, { widths: [26, 12, 12] }) },
    { name: 'Issues', links: isLinks, pics, xml: sheetXml(isRows, { widths: [10, 11, 15, 44, 8, 7, 48, 64, 44, 7, 50, 12, 28, 52, Math.round(MAX_IMG_W / 7) + 4], freeze: 4, autoFilter: `A4:${colName(isHead.length - 1)}${isRows.length}`, hyperlinks: isLinks.links, drawingId: pics.length ? 1 : 0 }) },
    { name: 'Findings', links: fLinks, pics: fPics, xml: sheetXml(fRows, { widths: [10, 11, 15, 44, 8, 26, 48, 64, 22, 50, 7, 44, 52, 60, Math.round(MAX_IMG_W / 7) + 4], freeze: 4, autoFilter: `A4:${colName(fHead.length - 1)}${fRows.length}`, hyperlinks: fLinks.links, drawingId: fPics.length ? 1 : 0 }) },
    { name: 'Pages', links: pLinks, xml: sheetXml(pRows, { widths: [30, 8, 40, 12, 60, 70], freeze: 4, hyperlinks: pLinks.links }) },
    { name: 'Measurements', xml: sheetXml(mRows, { widths: [10, 8, 48, 12, 11, 18, 90], freeze: 4 }) },
    { name: 'Tokens', xml: sheetXml(tRows, { widths: [30, 22, 34, 40, 34, 8, 50] }) }
  ];

  const files = [];
  const contentTypes = [
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`,
    `<Default Extension="xml" ContentType="application/xml"/>`, `<Default Extension="png" ContentType="image/png"/>`,
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`,
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
  ];
  sheets.forEach((s, i) => {
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: s.xml });
    contentTypes.push(`<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
  });
  // Each sheet with pictures gets its own drawing part; the PNG data is stored once in xl/media.
  let drawingNo = 0;
  const drawingOf = {};
  sheets.forEach(sh => {
    if (!sh.pics || !sh.pics.length) return;
    const n = ++drawingNo;
    drawingOf[sh.name] = n;
    files.push({ name: `xl/drawings/drawing${n}.xml`, data: drawingXml(sh.pics) });
    contentTypes.push(`<Override PartName="/xl/drawings/drawing${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
    files.push({ name: `xl/drawings/_rels/drawing${n}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sh.pics.map((p, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/evidence${p.mediaIndex}.png"/>`).join('') + `</Relationships>` });
  });
  media.forEach(m => files.push({ name: `xl/media/evidence${m.index}.png`, data: m.data }));
  sheets.forEach((sh, i) => {
    const rels = [];
    if (drawingOf[sh.name]) rels.push(`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingOf[sh.name]}.xml"/>`);
    for (const r of (sh.links ? sh.links.rels : [])) rels.push(`<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(r.url)}" TargetMode="External"/>`);
    if (rels.length) files.push({ name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>` });
  });
  files.push(
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${contentTypes.join('')}</Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
      sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + `</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: STYLES }
  );
  return zip(files);
}

module.exports = { build, colName, pngSize };
