'use strict';
// Forms and tables: labels, groups, autocomplete, error association, and
// table structure.
module.exports = {
  id: 'forms',
  label: 'forms and tables',
  async collect(page) {
    return page.evaluate(() => {
      const H = window.__a11y;
      const cap = (arr, n = 25) => arr.slice(0, n);
      const entry = (e, extra) => ({ sel: H.selOf(e), path: H.pathOf(e), rect: H.box(e), snippet: H.snippet(e), ...extra });

      // --- fields --------------------------------------------------------
      const fields = [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]),select,textarea,[role=textbox],[role=combobox],[role=listbox],[role=slider],[role=spinbutton]')]
        .filter(f => !H.isSkipped(f) && (H.visible(f) || f.type === 'checkbox' || f.type === 'radio'));
      const hasLabel = f => (f.labels && f.labels.length && [...f.labels].some(l => H.textOf(l) || l.querySelector('img[alt]:not([alt=""])')))
        || (f.getAttribute('aria-label') || '').trim() || f.getAttribute('aria-labelledby') || (f.getAttribute('title') || '').trim() && false;
      const unlabeled = [], placeholderOnly = [], titleOnly = [];
      fields.forEach(f => {
        if (hasLabel(f)) return;
        const ph = (f.getAttribute('placeholder') || '').trim();
        const t = (f.getAttribute('title') || '').trim();
        const item = entry(f, { type: f.type || f.tagName.toLowerCase(), name: (f.name || f.id || '').slice(0, 40), placeholder: ph.slice(0, 50) });
        if (ph) placeholderOnly.push(item); else if (t) titleOnly.push({ ...item, title: t }); else unlabeled.push(item);
      });

      // --- groups without fieldset ---------------------------------------
      const groups = new Map();
      document.querySelectorAll('input[type=radio],input[type=checkbox]').forEach(i => {
        if (!i.name || H.isSkipped(i)) return;
        const k = i.type + ':' + i.name + ':' + (i.form ? H.pathOf(i.form) : '');
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(i);
      });
      const groupsNoFieldset = [];
      for (const [k, els] of groups) {
        if (els.length < 2) continue;
        const first = els[0];
        const fs = first.closest('fieldset');
        const grp = first.closest('[role=group],[role=radiogroup]');
        const ok = (fs && fs.querySelector('legend') && H.textOf(fs.querySelector('legend'))) || (grp && H.accName(grp));
        if (!ok) {
          const container = els.reduce((c, e) => c && c.contains(e) ? c : (c ? commonAncestor(c, e) : e.parentElement), first.parentElement);
          groupsNoFieldset.push({ sel: H.selOf(container || first.parentElement), path: H.pathOf(container || first.parentElement), rect: H.box(container || first.parentElement), type: first.type, name: first.name.slice(0, 40), count: els.length,
            options: els.slice(0, 4).map(e => (e.labels && e.labels[0] ? H.textOf(e.labels[0]) : e.value).slice(0, 25)) });
        }
      }
      function commonAncestor(a, b) { let n = a; while (n && !n.contains(b)) n = n.parentElement; return n; }

      // --- autocomplete --------------------------------------------------
      const HINTS = [
        [/e-?mail/i, 'email'], [/^tel$|phone|mobile|telephone/i, 'tel'], [/first[-_ ]?name|given[-_ ]?name|fname/i, 'given-name'],
        [/last[-_ ]?name|surname|family[-_ ]?name|lname/i, 'family-name'], [/^name$|full[-_ ]?name|your[-_ ]?name/i, 'name'],
        [/post(al)?[-_ ]?code|zip/i, 'postal-code'], [/address[-_ ]?(line)?[-_ ]?1|street|address1|^address$/i, 'street-address'],
        [/city|town|locality/i, 'address-level2'], [/country/i, 'country-name'], [/company|organi[sz]ation/i, 'organization'],
        [/birth|dob/i, 'bday'], [/^url$|website|homepage/i, 'url'], [/user[-_ ]?name|login/i, 'username']
      ];
      const autocompleteMissing = [];
      fields.forEach(f => {
        if (autocompleteMissing.length >= 20) return;
        if (f.tagName !== 'INPUT' || !/^(text|email|tel|url|search|)$/.test(f.type || '')) return;
        if (f.hasAttribute('autocomplete')) return;
        if (f.type === 'search' || /search|query|^q$/i.test(f.name + ' ' + f.id)) return;
        const hay = [f.name, f.id, f.getAttribute('placeholder'), f.labels && f.labels[0] ? H.textOf(f.labels[0]) : '', f.type].join(' ');
        const hit = HINTS.find(([re]) => re.test(hay));
        if (hit) autocompleteMissing.push(entry(f, { type: f.type, name: (f.name || f.id || '').slice(0, 40), suggest: hit[1], label: (f.labels && f.labels[0] ? H.textOf(f.labels[0]) : f.getAttribute('placeholder') || '').slice(0, 40) }));
      });

      // --- error association and color-only state ------------------------
      const invalidNoDescription = [], colorOnly = [], requiredNoCue = [];
      fields.forEach(f => {
        const invalid = f.getAttribute('aria-invalid') === 'true' || f.matches('.error,.is-invalid,.invalid,[class*=error],[class*=invalid]');
        if (invalid && !f.getAttribute('aria-describedby') && !f.getAttribute('aria-errormessage')) {
          invalidNoDescription.push(entry(f, { type: f.type, name: (f.name || f.id || '').slice(0, 40) }));
        }
        if (invalid) {
          // Is there any text or icon near the field that says so?
          const wrap = f.closest('div,p,li,fieldset,td') || f.parentElement;
          const txt = wrap ? H.textOf(wrap).replace(H.accName(f), '') : '';
          const hasCue = /error|invalid|required|must|please|enter|missing|\*|!|⚠|✖|✕/i.test(txt) || (wrap && wrap.querySelector('svg,img,[class*=icon]'));
          if (!hasCue) colorOnly.push(entry(f, { type: f.type, name: (f.name || f.id || '').slice(0, 40), state: 'invalid' }));
        }
        if (f.required && f.labels && f.labels[0]) {
          const lt = H.textOf(f.labels[0]);
          const cue = /\*|required|\(req/i.test(lt) || /\*/.test(getComputedStyle(f.labels[0], '::after').content || '') || f.getAttribute('aria-required') === 'true';
          const form = f.form;
          const formSays = form && /required/i.test(H.textOf(form).slice(0, 400));
          if (!cue && !formSays && requiredNoCue.length < 10) requiredNoCue.push(entry(f, { type: f.type, name: (f.name || f.id || '').slice(0, 40), label: lt.slice(0, 40) }));
        }
      });

      // --- tables --------------------------------------------------------
      const tables = [...document.querySelectorAll('table')].filter(t => !H.isSkipped(t) && H.visible(t)).map(t => {
        const rows = t.rows.length;
        const cols = rows ? Math.max(...[...t.rows].map(r => r.cells.length)) : 0;
        const ths = [...t.querySelectorAll('th')];
        const presentation = t.getAttribute('role') === 'presentation' || t.getAttribute('role') === 'none';
        const caption = t.querySelector(':scope > caption');
        const named = (caption && H.textOf(caption)) || t.getAttribute('aria-label') || t.getAttribute('aria-labelledby') || t.getAttribute('summary');
        const nestedBlocks = t.querySelectorAll('td > div, td > table, td > form, td > ul, td > h1, td > h2, td > h3, td > img').length;
        const firstRowAllTh = rows && [...t.rows[0].cells].length && [...t.rows[0].cells].every(c => c.tagName === 'TH');
        const firstColTh = rows > 1 && [...t.rows].slice(1).every(r => r.cells[0] && r.cells[0].tagName === 'TH');
        const both = firstRowAllTh && firstColTh;
        const thNoScope = ths.filter(th => !th.hasAttribute('scope') && !th.id).length;
        const layout = presentation || (!ths.length && !caption && (nestedBlocks > 0 || cols <= 1 || rows <= 1));
        // Bold td in the first row: a header dressed as data.
        const boldFirstRow = !ths.length && rows > 1 && [...t.rows[0].cells].every(c => c.tagName === 'TD' && parseInt(getComputedStyle(c).fontWeight, 10) >= 600);
        return { sel: H.selOf(t), path: H.pathOf(t), rect: H.box(t), rows, cols, hasTh: ths.length > 0, thCount: ths.length, thNoScope, both, hasCaption: !!(caption && H.textOf(caption)), named: !!named, layout, presentation, boldFirstRow, nestedBlocks };
      });

      // Grids built from divs: 3+ sibling rows with the same number (3+) of children with short numeric-ish text.
      const divGrids = [];
      document.querySelectorAll('div,ul,section').forEach(c => {
        if (divGrids.length >= 5 || !H.visible(c) || H.isSkipped(c) || c.closest('table,[role=table],[role=grid],[role=treegrid]')) return;
        const rows = [...c.children].filter(r => r.tagName !== 'SCRIPT');
        if (rows.length < 3 || rows.length > 60) return;
        const n = rows[0].children.length;
        if (n < 3) return;
        if (!rows.every(r => r.children.length === n && r.tagName === rows[0].tagName)) return;
        const cells = [...rows[1].children];
        const shortish = cells.filter(x => { const t = H.textOf(x); return t && t.length < 30 && !x.querySelector('a,button,img,input'); }).length;
        if (shortish < n - 1) return;
        const numeric = rows.slice(1).filter(r => [...r.children].some(x => /^\s*[$€£]?\s*[\d.,%]+\s*$/.test(H.textOf(x)))).length;
        if (numeric < rows.length - 1) return;
        divGrids.push({ sel: H.selOf(c), path: H.pathOf(c), rect: H.box(c), rows: rows.length, cols: n });
      });

      const forms = document.querySelectorAll('form').length;
      return {
        fields: fields.length, forms,
        unlabeled: cap(unlabeled, 40), placeholderOnly: cap(placeholderOnly), titleOnly: cap(titleOnly),
        groupsNoFieldset: cap(groupsNoFieldset), autocompleteMissing, invalidNoDescription: cap(invalidNoDescription), colorOnly: cap(colorOnly), requiredNoCue,
        tables: { total: tables.length, list: cap(tables, 30), divGrids }
      };
    });
  }
};
