'use strict';
// A scan reports per element, per page, per width, which is accurate and
// long. One pale link color on forty pages is forty findings and one fix.
// Grouping collapses findings that share a cause (same rule, same selector,
// same width) and keeps every page address and up to a dozen pictures.
const ORDER = { critical: 0, serious: 1, moderate: 2, minor: 3 };

function causeOf(f) { return [f.rule, f.sel || ''].join('|'); }
function keyOf(f) { return causeOf(f) + '|' + (f.width || ''); }

function group(findings) {
  const byKey = new Map();
  for (const f of findings) {
    const k = keyOf(f);
    let g = byKey.get(k);
    if (!g) {
      g = { key: k, item: f.item, rule: f.rule, severity: f.severity, width: f.width || null, cause: causeOf(f),
        title: f.title, detail: f.detail, sel: f.sel || null, path: f.path || null, snippet: f.snippet || null,
        pages: new Set(), urls: {}, occurrences: 0, evidenceImage: f.evidenceImage || null, evidence: f.evidence || null,
        examples: [], sample: f };
      byKey.set(k, g);
    }
    g.occurrences++;
    if (f.page) g.pages.add(f.page);
    if (f.page && f.url && !g.urls[f.page]) g.urls[f.page] = f.url;
    if (ORDER[f.severity] < ORDER[g.severity]) { g.severity = f.severity; g.title = f.title; g.detail = f.detail; g.sample = f; }
    if (!g.evidenceImage && f.evidenceImage) { g.evidenceImage = f.evidenceImage; g.evidence = f.evidence; }
    if (g.examples.length < 12) {
      g.examples.push({ page: f.page, url: f.url, width: f.width, title: f.title, detail: f.detail, path: f.path, snippet: f.snippet,
        rect: f.rect, evidenceImage: f.evidenceImage || null, evidence: f.evidence || null, severity: f.severity });
    }
  }
  return [...byKey.values()]
    .map(g => ({ ...g, pages: [...g.pages].sort(), pageCount: g.pages.size }))
    .sort((a, b) => (ORDER[a.severity] - ORDER[b.severity]) || (b.occurrences - a.occurrences) || a.rule.localeCompare(b.rule) || (a.width || 0) - (b.width || 0));
}

function summarize(findings, groups) {
  const bySeverity = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const byWidth = {}, byItem = {};
  const causes = new Set();
  for (const g of groups) {
    bySeverity[g.severity]++;
    if (g.width) byWidth[g.width] = (byWidth[g.width] || 0) + 1;
    byItem[g.item] = (byItem[g.item] || 0) + 1;
    causes.add(g.cause);
  }
  return { findings: findings.length, issues: groups.length, causes: causes.size, collapsed: findings.length - groups.length,
    bySeverity, byWidth, byItem, widths: Object.keys(byWidth).map(Number).sort((a, b) => a - b) };
}

// The short handle a person types into a ticket: initials of the rule plus a
// stable position in the report. Excel and Word must agree on it.
function issueId(groups, g) {
  return g.rule.split('-').map(w => w[0]).join('').slice(0, 5) + '-' + String(groups.indexOf(g) + 1).padStart(2, '0');
}

module.exports = { group, summarize, keyOf, causeOf, issueId, ORDER };
