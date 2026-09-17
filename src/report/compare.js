'use strict';
// What moved between two runs. Issues are joined on their cause (rule,
// selector, width), never on a positional id. When the two runs visited
// different pages or widths, the answer says so rather than quietly
// counting untested pages as fixed.
const { group } = require('./group');
const RANK = { critical: 0, serious: 1, moderate: 2, minor: 3 };

function comparability(baseRun, headRun) {
  const notes = [];
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u || ''; } };
  const sameSite = host(baseRun.startUrl) === host(headRun.startUrl);
  if (!sameSite) notes.push(`Different sites: ${host(baseRun.startUrl) || 'unknown'} and ${host(headRun.startUrl) || 'unknown'}.`);
  const wBase = [...(baseRun.widths || [])].sort((a, b) => a - b).join(','), wHead = [...(headRun.widths || [])].sort((a, b) => a - b).join(',');
  if (wBase !== wHead) notes.push(`Different widths: ${wBase || 'none'} then ${wHead || 'none'}. An issue only seen at a width the other run never opened will look fixed or new.`);
  const pagesOf = r => new Set((r.pages || []).map(p => p.page));
  const a = pagesOf(baseRun), b = pagesOf(headRun);
  const missing = [...a].filter(p => !b.has(p)), added = [...b].filter(p => !a.has(p));
  if (missing.length || added.length) notes.push(`Different pages: ${missing.length} in the baseline were not visited again${added.length ? `, ${added.length} are new to this run` : ''}. Anything only on those counts as fixed or new here.`);
  return { sameSite, sameWidths: wBase === wHead, samePages: !missing.length && !added.length, trustworthy: sameSite && wBase === wHead && !missing.length && !added.length, pagesOnlyInBaseline: missing, pagesOnlyInRun: added, notes };
}

function worse(before, after) {
  if (RANK[after.severity] < RANK[before.severity]) return 'severity';
  if (after.pageCount > before.pageCount) return 'spread';
  return null;
}

function compare(baseline, head) {
  const baseGroups = group(baseline.findings), headGroups = group(head.findings);
  const a = new Map(baseGroups.map(g => [g.key, g])), b = new Map(headGroups.map(g => [g.key, g]));
  const fixed = [], appeared = [], regressed = [], unchanged = [], improved = [];
  for (const [k, g] of a) if (!b.has(k)) fixed.push(g);
  for (const [k, g] of b) {
    const before = a.get(k);
    if (!before) { appeared.push(g); continue; }
    const why = worse(before, g);
    if (why) regressed.push({ ...g, was: { severity: before.severity, pageCount: before.pageCount }, why });
    else if (g.pageCount < before.pageCount) improved.push({ ...g, was: { pageCount: before.pageCount } });
    else unchanged.push(g);
  }
  const bySev = list => list.reduce((acc, g) => (acc[g.severity] = (acc[g.severity] || 0) + 1, acc), {});
  const strip = g => ({ key: g.key, item: g.item, rule: g.rule, severity: g.severity, width: g.width, title: g.title, detail: g.detail, sel: g.sel, pages: g.pages, pageCount: g.pageCount, occurrences: g.occurrences, urls: g.urls, evidenceImage: g.evidenceImage, was: g.was || null, why: g.why || null });
  return {
    baseline: { dir: baseline.dir, client: baseline.run.client, date: baseline.run.finishedAt || null, issues: baseGroups.length, findings: baseline.findings.length, checklist: baseline.run.checklist || null },
    run: { dir: head.dir, client: head.run.client, date: head.run.finishedAt || null, issues: headGroups.length, findings: head.findings.length, checklist: head.run.checklist || null },
    comparability: comparability(baseline.run, head.run),
    counts: { fixed: fixed.length, new: appeared.length, regressed: regressed.length, unchanged: unchanged.length, improved: improved.length },
    bySeverity: { fixed: bySev(fixed), new: bySev(appeared), regressed: bySev(regressed) },
    fixed: fixed.map(strip), new: appeared.map(strip), regressed: regressed.map(strip), improved: improved.map(strip), unchanged: unchanged.map(strip)
  };
}

module.exports = { compare, comparability };
