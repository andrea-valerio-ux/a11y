'use strict';
// The written report as a Word file: a summary, the checklist filled in, how
// the numbers were produced, then one block per issue with the criterion,
// what the rule is about, the measurement, the fix, the picture and every
// affected address.
const fs = require('fs');
const path = require('path');
const { zip, xml } = require('../util/zip');
const { issueId } = require('./group');
const checklist = require('../checklist');

const EMU = 9525;
const CELL_W = 440;
const TEXT_W = 9026;
const NS = ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
  ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const FONT = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>';
const SEV = { critical: { label: 'Critical', fill: 'F8D7D5' }, serious: { label: 'Serious', fill: 'FADBC8' }, moderate: { label: 'Moderate', fill: 'E4EDFF' }, minor: { label: 'Minor', fill: 'EEF1F6' } };
const STATUS = { fail: { label: 'Fails', fill: 'F8E3E2', ink: 'B93A37' }, pass: { label: 'Passes', fill: 'DDF1E4', ink: '1E7A4B' }, review: { label: 'Needs a person', fill: 'F7E8CC', ink: '9A5B00' }, na: { label: 'Not applicable', fill: 'EEEFF3', ink: '8A8DA0' } };

function pngSize(buf) { return buf.length < 24 ? null : { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }; }
function rPr(o = {}) { return `<w:rPr>${FONT}${o.bold ? '<w:b/>' : ''}${o.italic ? '<w:i/>' : ''}${o.color ? `<w:color w:val="${o.color}"/>` : ''}${o.size ? `<w:sz w:val="${o.size}"/>` : ''}</w:rPr>`; }
function para(text, o = {}) {
  const pPr = `<w:pPr>${o.style ? `<w:pStyle w:val="${o.style}"/>` : ''}<w:spacing w:before="${o.before == null ? 60 : o.before}" w:after="${o.after == null ? 60 : o.after}"/></w:pPr>`;
  return `<w:p>${pPr}<w:r>${rPr(o)}<w:t xml:space="preserve">${xml(String(text))}</w:t></w:r></w:p>`;
}
function linkPara(text, rid, o = {}) {
  const pPr = `<w:pPr><w:spacing w:before="${o.before == null ? 10 : o.before}" w:after="${o.after == null ? 10 : o.after}"/></w:pPr>`;
  const runPr = `<w:rPr>${FONT}<w:color w:val="2B5FD9"/><w:u w:val="single"/><w:sz w:val="${o.size || 18}"/></w:rPr>`;
  return `<w:p>${pPr}${o.lead ? `<w:r>${rPr({ size: o.size || 18 })}<w:t xml:space="preserve">${xml(o.lead)}</w:t></w:r>` : ''}<w:hyperlink r:id="${rid}"><w:r>${runPr}<w:t xml:space="preserve">${xml(String(text))}</w:t></w:r></w:hyperlink></w:p>`;
}
function cellOf(content, o = {}) {
  return `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${o.w || 2000}"/>${o.span ? `<w:gridSpan w:val="${o.span}"/>` : ''}${o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : ''}<w:vAlign w:val="top"/></w:tcPr>${content}</w:tc>`;
}
function cell(text, o = {}) { return cellOf(para(text == null || text === '' ? ' ' : text, { bold: o.bold, color: o.color, size: o.size || 17, before: 30, after: 30 }), o); }
function table(rows, grid) {
  const side = s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="D5DBE8"/>`;
  const pr = `<w:tblPr><w:tblW w:type="dxa" w:w="${TEXT_W}"/><w:tblLayout w:type="fixed"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(side).join('')}</w:tblBorders>` +
    `<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr>`;
  const cols = (grid || []).length ? `<w:tblGrid>${grid.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` : '';
  return `<w:tbl>${pr}${cols}${rows.map(r => `<w:tr>${r.join('')}</w:tr>`).join('')}</w:tbl>` + para(' ', { before: 0, after: 0, size: 8 });
}
function picture(rid, index, w, h, alt) {
  const ext = `cx="${Math.round(w * EMU)}" cy="${Math.round(h * EMU)}"`;
  return `<w:p><w:pPr><w:spacing w:before="120" w:after="60"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent ${ext}/>` +
    `<wp:docPr id="${index}" name="Evidence ${index}" descr="${xml(alt || 'Evidence screenshot')}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="${index}" name="Evidence ${index}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext ${ext}/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}
function measured(g) {
  const bits = [];
  if (g.detail) bits.push(g.detail);
  const e = g.evidence || {}, facts = [];
  if (e.ratio != null && e.required != null) facts.push(`measured ${e.ratio}:1 against a required ${e.required}:1`);
  if (e.method) facts.push(`method: ${e.method}`);
  if (e.size && e.required) facts.push(`${e.size[0]}x${e.size[1]}px against ${e.required}px`);
  if (facts.length) bits.push(facts.join('; ') + '.');
  bits.push(`Recorded ${g.occurrences} time${g.occurrences === 1 ? '' : 's'} on ${g.pageCount} page${g.pageCount === 1 ? '' : 's'}${g.width ? ` at ${g.width}px` : ''}.`);
  return bits.join(' ');
}
function addressOf(g, page, meta) {
  if (g.urls && g.urls[page]) return g.urls[page];
  const hit = (meta.pageList || []).find(p => p.page === page);
  return hit && hit.url ? hit.url : (meta.startUrl || '');
}

function build(groups, meta, opts = {}) {
  const withImages = opts.images !== false;
  const media = [], links = [], body = [];
  const linkTo = url => { links.push(url); return `rIdLink${links.length}`; };
  const s = meta.summary, cl = meta.checklist || { items: {}, totals: {} };
  const head = (t, w) => cell(t, { w, bold: true, color: 'FFFFFF', fill: '1C1F33', size: 16 });

  // ---- cover and summary
  body.push(para(`Accessibility report – ${meta.client}`, { style: 'Title', after: 40 }));
  if (meta.startUrl) body.push(linkPara(meta.startUrl, linkTo(meta.startUrl), { size: 20, before: 0, after: 0 }));
  body.push(para(`${meta.pages} page-width checks · widths ${(meta.widths || []).join(', ')}px · WCAG 2.2 level ${meta.level} · ${meta.date}`, { color: '6B6F86', size: 20, before: 0 }));
  body.push(para('Summary', { style: 'Heading1' }));
  body.push(para(`${s.findings} findings were recorded and grouped into ${s.issues} issues by what causes them. They are organized under the ${checklist.ITEMS.length} items of The A11Y Project checklist: ` +
    `${cl.totals.fail || 0} items fail, ${cl.totals.review || 0} need a person to finish the check, ${cl.totals.pass || 0} pass and ${cl.totals.na || 0} do not apply to this site.`));
  const sevRows = [[head('Severity', 1600), head('Issues', 1000), head('Occurrences', 1400), head('Pages', 1000), head('What this means', 4026)]];
  const MEANS = { critical: 'Blocks people from completing the task. Fix first.', serious: 'Makes the task hard or unreliable for some people. Fix next.', moderate: 'Degrades the experience or the structure. Schedule.', minor: 'Advisory: consistency and polish rather than conformance.' };
  for (const sev of ['critical', 'serious', 'moderate', 'minor']) {
    const inSev = groups.filter(g => g.severity === sev);
    if (!inSev.length) continue;
    const pages = new Set(); let occ = 0;
    inSev.forEach(g => { occ += g.occurrences; g.pages.forEach(p => pages.add(p)); });
    sevRows.push([cell(SEV[sev].label, { w: 1600, bold: true, fill: SEV[sev].fill }), cell(String(inSev.length), { w: 1000 }), cell(String(occ), { w: 1400 }), cell(String(pages.size), { w: 1000 }), cell(MEANS[sev], { w: 4026 })]);
  }
  body.push(table(sevRows, [1600, 1000, 1400, 1000, 4026]));

  body.push(para('What to fix first', { style: 'Heading2' }));
  groups.slice(0, 6).forEach((g, i) => body.push(para(`${i + 1}.  ${issueId(groups, g)} – ${g.title} (${SEV[g.severity].label}; ${g.occurrences} occurrence${g.occurrences === 1 ? '' : 's'} on ${g.pageCount} page${g.pageCount === 1 ? '' : 's'}${g.width ? ` at ${g.width}px` : ''})`, { before: 20, after: 20 })));

  // ---- the checklist
  body.push(para('The checklist', { style: 'Heading1' }));
  body.push(para('Every item of The A11Y Project checklist, with its status for this site. "Needs a person" marks the checks a scanner cannot decide; the relevant elements are listed under the item in the app and the web report.'));
  for (const sec of checklist.SECTIONS) {
    body.push(para(sec.title, { style: 'Heading2' }));
    const rows = [[head('Checklist item', 5226), head('WCAG', 1200), head('Status', 1500), head('Issues', 1100)]];
    for (const it of checklist.ITEMS.filter(i => i.section === sec.id)) {
      const item = checklist.itemFor(it.id), st = (cl.items && cl.items[it.id]) || { status: 'na' };
      const n = groups.filter(g => g.item === it.id).length;
      rows.push([cell(item.title, { w: 5226 }), cell(item.criterion.code, { w: 1200 }), cell(STATUS[st.status].label, { w: 1500, bold: true, color: STATUS[st.status].ink, fill: STATUS[st.status].fill }), cell(n ? String(n) : '', { w: 1100 })]);
    }
    body.push(table(rows, [5226, 1200, 1500, 1100]));
  }

  // ---- method
  body.push(para('How this was measured', { style: 'Heading1' }));
  body.push(para(`Each page was opened in headless Chrome at ${(meta.widths || []).map(w => w + 'px').join(', ')}, left to settle, and measured: contrast from the resolved colors and, over images, from the rendered pixels; focus indicators from a real Tab-key sweep; target sizes from the painted box; reflow at 320px; text at 200% zoom; animation with reduced motion switched on.`));
  body.push(para('Every number in this document came from that pass and can be reproduced by running the scan again. Screenshots are cropped from the page as it rendered when the finding was recorded, with the element outlined in red.'));

  // ---- findings
  body.push(para('Findings', { style: 'Heading1' }));
  body.push(para('One block per issue, worst first, in the same layout every time: the checklist item and criterion, what the rule is about, the measurement, how to fix it, the picture, and every affected address.'));
  const WIDE = 3145, LAB = 1368, SPAN3 = WIDE + LAB + WIDE;
  for (const g of groups) {
    const id = issueId(groups, g), sev = SEV[g.severity] || SEV.minor, item = checklist.itemFor(g.item) || { title: g.item, criterion: {}, sectionTitle: '', about: '', fix: '', checklistUrl: '' };
    body.push(para(`${id} – ${g.title}`, { style: 'Heading2' }));
    const lab = t => cell(t, { w: LAB, bold: true, size: 17 });
    const val = (t, o = {}) => cell(t, { w: WIDE, size: 17, ...o });
    const wide = (label, content) => [cell(label, { w: LAB, bold: true, size: 17 }), cellOf(content, { w: SPAN3, span: 3 })];
    const rows = [
      [lab('Section'), val(item.sectionTitle, { fill: 'EEEFFA' }), lab('Severity'), val(sev.label, { bold: true, fill: sev.fill })],
      [lab('Width'), val(g.width ? `${g.width}px` : 'all widths'), lab('Occurrences'), val(`${g.occurrences} on ${g.pageCount} page${g.pageCount === 1 ? '' : 's'}`)],
      wide('Checklist item', para(item.title, { size: 17, before: 30, after: 30 }) + (item.checklistUrl ? linkPara(item.checklistUrl, linkTo(item.checklistUrl), { size: 15, before: 0, after: 30 }) : '')),
      wide('WCAG criterion', item.criterion.url
        ? linkPara(`${item.criterion.code} ${item.criterion.name} (Level ${item.criterion.level})`, linkTo(item.criterion.url), { size: 17, before: 30, after: 30 })
        : para('—', { size: 17, before: 30, after: 30 })),
      wide('What the rule is about', para(item.about || '', { size: 17, before: 30, after: 30 })),
      wide('Element', para([g.path, g.snippet].filter(Boolean).join('  ') || '—', { size: 15, color: '474B63', before: 30, after: 30 })),
      wide('Measured evidence', para(measured(g), { size: 17, before: 30, after: 30 })),
      wide('How to fix it', para(item.fix || '', { size: 17, before: 30, after: 30 }))
    ];
    if (withImages && g.evidenceImage) {
      const file = path.join(meta.dir, g.evidenceImage);
      if (fs.existsSync(file)) {
        const data = fs.readFileSync(file), size = pngSize(data);
        if (size) {
          const scale = Math.min(1, CELL_W / size.width), idx = media.length + 1;
          media.push({ data, name: `evidence${idx}.png` });
          rows.push(wide('Evidence', picture(`rIdImg${idx}`, idx, Math.round(size.width * scale), Math.round(size.height * scale), g.title) +
            para(`${(g.examples[0] || {}).url || ''} at ${(g.examples[0] || {}).width || g.width}px. The element is outlined in red.`, { color: '6B6F86', size: 15, before: 0, after: 30 })));
        }
      }
    }
    const addresses = g.pages.length
      ? g.pages.map(p => { const url = addressOf(g, p, meta); return url ? linkPara(url, linkTo(url), { size: 17, before: 20, after: 20 }) : para(p, { size: 17, before: 20, after: 20 }); }).join('')
      : para('Site-wide: no single page carries this.', { size: 17, before: 30, after: 30 });
    rows.push(wide('Affected pages', addresses));
    body.push(table(rows, [LAB, WIDE, LAB, WIDE]));
  }

  // ---- package
  const sect = `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:docDefaults><w:rPrDefault><w:rPr>${FONT}<w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>` +
    `<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:before="60" w:after="60" w:line="276" w:lineRule="auto"/></w:pPr><w:rPr>${FONT}<w:sz w:val="20"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr>${FONT}<w:b/><w:sz w:val="52"/><w:color w:val="1C1F33"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:spacing w:before="360" w:after="120"/></w:pPr><w:rPr>${FONT}<w:b/><w:sz w:val="32"/><w:color w:val="1C1F33"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:spacing w:before="280" w:after="80"/><w:keepNext/></w:pPr><w:rPr>${FONT}<w:b/><w:sz w:val="24"/><w:color w:val="1C1F33"/></w:rPr></w:style></w:styles>`;
  const rels = [
    `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
    ...media.map((m, i) => `<Relationship Id="rIdImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`),
    ...links.map((u, i) => `<Relationship Id="rIdLink${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(u)}" TargetMode="External"/>`)
  ];
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>` },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document${NS}><w:body>${body.join('')}${sect}</w:body></w:document>` }
  ];
  media.forEach(m => files.push({ name: `word/media/${m.name}`, data: m.data }));
  return zip(files);
}

module.exports = { build };
