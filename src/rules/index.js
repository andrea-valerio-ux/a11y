'use strict';
// Measurements in, findings out.
//
// Every rule belongs to one item of The A11Y Project checklist. A finding
// names the element, carries the number or fact that proves it, and asks for
// a screenshot when the element has a position. After the rules run, every
// checklist item gets a status for this page and width: fail, pass, review
// (a person must finish the check) or n/a (nothing of that kind on the page).
const { ITEMS } = require('../checklist');

const S = { critical: 'critical', serious: 'serious', moderate: 'moderate', minor: 'minor' };
const ORDER = { critical: 0, serious: 1, moderate: 2, minor: 3 };

function evaluate(m, ctx = {}) {
  const findings = [];
  const notes = {};   // item id -> extra note for the status line
  const add = (item, rule, severity, title, detail, el, evidence, extra) => {
    const e = el || {};
    findings.push({
      item, rule, severity, title, detail,
      sel: e.sel || null, path: e.path || null, snippet: e.snippet || null,
      rect: e.rect || null, shot: !!(e.rect && e.rect[2] > 0 && e.rect[3] > 0),
      evidence: evidence || null, ...(extra || {})
    });
  };
  const note = (item, text) => { notes[item] = text; };
  const q = s => JSON.stringify(String(s || '').slice(0, 60));
  const level = ctx.level || 'AA';

  const d = m.document || {}, c = m.content || {}, im = m.images || {}, co = m.controls || {}, fo = m.forms || {},
        me = m.media || {}, ct = m.contrast || {}, kb = m.keyboard || {}, tg = m.targets || {}, rs = m.responsive || {};
  const isPhone = (ctx.width || 1440) < 700;

  // ================================================================ Content
  if (c.readability && c.readability.grade !== null && c.readability.grade !== undefined) {
    const g = c.readability.grade;
    if (g > 12) add('plain-language', 'READING-LEVEL', S.minor,
      `The body text reads at roughly grade ${g}; the checklist asks for grade 8`,
      `Flesch-Kincaid estimate over ${c.readability.words} words: ${c.readability.wordsPerSentence} words per sentence on average, ${c.readability.longSentences} sentences longer than 180 characters. Sample: ${q(c.readability.sample)}`,
      { sel: c.readability.sel, rect: c.readability.rect }, { grade: g, words: c.readability.words, wordsPerSentence: c.readability.wordsPerSentence });
    else note('plain-language', `Body text estimated at grade ${g} (${c.readability.words} words). Idioms and metaphors still need a person.`);
  } else note('plain-language', 'Too little body text to estimate a reading level.');

  for (const l of (co.links && co.links.generic) || []) add('unique-descriptive-controls', 'LINK-GENERIC', S.moderate,
    `Link text ${q(l.name)} does not say where the link goes`, `Out of context, in a screen reader's list of links, this reads as ${q(l.name)}. Destination: ${l.href}`, l, { name: l.name, href: l.href });
  for (const dup of (co.links && co.links.duplicateText) || []) add('unique-descriptive-controls', 'LINK-SAME-TEXT-DIFFERENT-TARGET', S.moderate,
    `${dup.count} links read ${q(dup.name)} but go to different places`, `The same link text points at: ${dup.hrefs.join(' · ')}`, dup, { name: dup.name, hrefs: dup.hrefs });
  for (const l of (c.alignment) || []) add('text-alignment', 'TEXT-ALIGN-' + l.align.toUpperCase(), S.minor,
    `${l.chars} characters of running text are ${l.align === 'justify' ? 'justified' : l.align + '-aligned'}`, `${q(l.text)}…`, l, { align: l.align, chars: l.chars });

  // ============================================================ Global code
  for (const x of d.dupIds || []) add('validate-html', 'DUPLICATE-ID', x.referenced ? S.serious : S.moderate,
    `id="${x.id}" is used ${x.count} times${x.referenced ? ' and something refers to it' : ''}`,
    x.referenced ? 'A label, aria attribute or link points at this id; only the first element with it will be found.' : 'Ids must be unique; scripts and assistive technology resolve only the first match.', x, { id: x.id, count: x.count, referenced: x.referenced });
  for (const x of d.nestedInteractive || []) add('validate-html', 'NESTED-INTERACTIVE', S.serious,
    `A ${x.inner} sits inside a ${x.sel}`, 'Interactive content inside interactive content is invalid HTML; browsers and screen readers disagree on which one receives focus and clicks.', x, { outer: x.sel, inner: x.inner });

  if (!d.lang) add('lang-attribute', 'LANG-MISSING', S.serious, 'The html element has no lang attribute', 'A screen reader will guess the language from the user\'s settings and may mispronounce every word.', null, { lang: null }, { shot: false });
  else if (!d.langValid) add('lang-attribute', 'LANG-INVALID', S.serious, `lang="${d.lang}" is not a valid language tag`, 'Use a BCP 47 tag such as "en", "en-GB" or "es".', null, { lang: d.lang }, { shot: false });

  if (!d.title) add('unique-title', 'TITLE-MISSING', S.serious, 'The page has no title', 'The title is the first thing announced when the page loads and the label of the browser tab.', null, { title: null }, { shot: false });
  else if (d.title.length < 4 || /^(home|untitled|index|page|document|new page)$/i.test(d.title)) add('unique-title', 'TITLE-GENERIC', S.moderate, `The page title is ${q(d.title)}`, 'A title should name the page and the site.', null, { title: d.title }, { shot: false });

  if (d.viewport && (d.viewport.userScalableNo || (d.viewport.maxScale !== null && d.viewport.maxScale < 2))) add('viewport-zoom', 'VIEWPORT-ZOOM-DISABLED', S.serious,
    d.viewport.userScalableNo ? 'The viewport meta tag disables pinch zoom' : `The viewport meta tag caps zoom at ${d.viewport.maxScale}x`,
    `content="${d.viewport.content}"`, null, { content: d.viewport.content }, { shot: false });

  const lm = d.landmarks || {};
  if (lm.main === 0) add('landmarks', 'NO-MAIN-LANDMARK', S.moderate, 'The page has no main landmark', 'Without <main>, assistive technology has no region to jump to past the header and navigation.', null, lm, { shot: false });
  if (lm.main > 1) add('landmarks', 'MULTIPLE-MAIN', S.minor, `${lm.main} main landmarks on one page`, 'Use one main per page so "skip to main" has one destination.', null, lm, { shot: false });
  for (const x of lm.menuOutsideNav || []) add('landmarks', 'MENU-NOT-IN-NAV', S.moderate, `A menu of ${x.links} links is not inside a nav landmark`, 'Wrap site navigation in <nav> so it can be reached and skipped as a region.', x, { links: x.links });
  for (const x of lm.outside || []) add('landmarks', 'CONTENT-OUTSIDE-LANDMARKS', S.minor, 'Content sits outside every landmark', `${q(x.text)}… is in no main, nav, header, footer or region.`, x, null);

  for (const x of d.tabindexPositive || []) add('linear-content-flow', 'TABINDEX-POSITIVE', S.serious, `tabindex="${x.tabindex}" pulls ${x.sel} out of the natural tab order`, 'Positive tabindex values make focus jump around the page in an order that does not match the layout.', x, { tabindex: x.tabindex });
  for (const x of d.tabindexZero || []) add('linear-content-flow', 'TABINDEX-ON-STATIC', S.minor, `${x.sel} is focusable but not interactive`, `tabindex="0" on ${q(x.text)} adds a tab stop that does nothing.`, x, null);
  for (const x of d.autofocus || []) add('no-autofocus', 'AUTOFOCUS', S.moderate, `${x.sel} takes focus as soon as the page loads`, 'Focus moves before the person has heard what page they are on.', x, null);
  if (d.metaRefresh) {
    const secs = parseInt(d.metaRefresh.content, 10);
    if (!isNaN(secs) && secs > 0) add('session-timeouts', 'META-REFRESH', S.serious, `The page reloads or redirects itself after ${secs} seconds`, `meta http-equiv="refresh" content="${d.metaRefresh.content}". The person cannot stop or extend this.`, null, { content: d.metaRefresh.content }, { shot: false });
  } else note('session-timeouts', 'No timed refresh found. Session limits behind a login still need a person to check.');
  for (const x of d.titleOnly || []) add('title-tooltips', 'TITLE-ONLY-NAME', S.serious, `${x.sel} is named only by its title attribute`, `The tooltip ${q(x.title)} is the only name; touch and keyboard users never see it and screen readers may not read it.`, x, { title: x.title });
  for (const x of d.titleInfo || []) add('title-tooltips', 'TITLE-TOOLTIP', S.minor, `A title tooltip carries information: ${q(x.title)}`, 'Content in a title attribute appears only on mouse hover.', x, { title: x.title });
  for (const x of (d.iframes && d.iframes.untitled) || []) add('title-tooltips', 'IFRAME-NO-TITLE', S.moderate, 'An iframe has no title', `Embedded frame ${x.src || ''} is announced only as "frame". This is the one place a title attribute is the right tool.`, x, { src: x.src });

  // =============================================================== Keyboard
  if (kb.stops) {
    for (const r of kb.noIndicator || []) add('visible-focus', 'FOCUS-NOT-VISIBLE', S.critical, `Nothing shows when focus reaches ${r.name ? q(r.name) : r.sel}`, `Tab stop ${r.index + 1} of ${kb.stops}: no outline, box-shadow, border or pseudo-element changed, on the control or its ancestors, on a ${r.background} background.`, r, { stop: r.index + 1, of: kb.stops, background: r.background });
    for (const j of kb.jumps || []) add('focus-order-visual', 'FOCUS-JUMPS-BACK', S.moderate, `Focus jumps ${Math.abs(j.dy)}px back up the page to ${j.to.name ? q(j.to.name) : j.to.sel}`, `After ${j.from.name ? q(j.from.name) : j.from.sel} at y=${j.from.rect[1]}, the next Tab lands at y=${j.to.rect[1]}. The source order does not match the visual order.`, j.to, { from: j.from, to: { sel: j.to.sel, rect: j.to.rect }, dy: j.dy });
    for (const r of kb.hidden || []) add('invisible-focusable', 'HIDDEN-TAB-STOP', S.serious, `Focus lands on ${r.name ? q(r.name) : r.sel} while it is ${r.hiddenReason}`, `Tab stop ${r.index + 1} of ${kb.stops} cannot be seen: ${r.hiddenReason}. A keyboard user watches focus disappear${r.inAriaHidden ? ', and a screen reader user is offered content the page marks as hidden' : ''}.`, r, { reason: r.hiddenReason, stop: r.index + 1 }, { shot: !r.hiddenReason.match(/no size|off screen/) });
    if (!kb.complete) note('visible-focus', `Only the first ${kb.stops} tab stops were checked.`);
  } else {
    note('visible-focus', 'No tab stops were reached on this page.');
  }

  // ================================================================= Images
  for (const x of im.missingAlt || []) add('img-alt', 'IMG-NO-ALT', S.critical, x.kind === 'image button' ? 'An image button has no alt text' : `Image ${x.src || x.sel} has no alt attribute`, `A screen reader will read the file name or skip the image. ${x.snippet || ''}`, x, { src: x.src });
  for (const x of im.svgNoName || []) add('img-alt', 'GRAPHIC-NO-NAME', S.serious, `${x.kind}`, `${x.snippet || x.sel} conveys nothing to a screen reader.`, x, { kind: x.kind });
  for (const x of im.areaMissing || []) add('img-alt', 'AREA-NO-ALT', S.serious, 'An image map area has no alt text', `Area linking to ${x.href} is announced without a name.`, x, null);
  for (const x of im.bgIcons || []) add('img-alt', 'BACKGROUND-IMAGE-CONTROL', S.critical, `${x.sel} shows only a background image and has no name`, 'The control is drawn with CSS background or mask images and contains no text, image or label, so it has no accessible name.', x, null);
  const ALT_RULE = { 'filename': 'ALT-FILENAME', 'placeholder word': 'ALT-PLACEHOLDER-WORD', 'repeats link text': 'ALT-REPEATS-LINK-TEXT', 'empty alt on a link\'s only content': 'LINK-IMAGE-EMPTY-ALT', 'starts with "image of"': 'ALT-IMAGE-OF' };
  for (const x of im.badAlt || []) add('decorative-null-alt', ALT_RULE[x.reason] || 'ALT-UNHELPFUL', x.reason === 'empty alt on a link\'s only content' ? S.critical : S.serious,
    x.reason === 'filename' ? `alt="${x.alt}" is a file name` : x.reason === 'placeholder word' ? `alt="${x.alt}" says nothing about the image` : x.reason === 'repeats link text' ? `alt="${x.alt}" repeats the link text beside it` : x.reason === 'empty alt on a link\'s only content' ? 'A link containing only an image with alt="" has no name' : `alt="${x.alt}" starts with "image of"`,
    x.reason === 'repeats link text' ? 'The screen reader announces the same words twice. If the image is decorative here, use alt="".' : x.reason === 'empty alt on a link\'s only content' ? 'The image is the whole link; its alt is the link\'s name.' : 'Describe the meaning of the image in this context, or use alt="" if it is decoration.', x, { alt: x.alt, reason: x.reason, src: x.src });
  for (const x of im.complex || []) add('complex-images', 'COMPLEX-IMAGE-NO-DESCRIPTION', S.moderate, `A ${x.size} ${x.kind} has no long description`, `${x.alt ? 'alt="' + x.alt + '". ' : ''}No aria-describedby, figcaption, desc or details element accompanies it. If it is a chart, map or diagram, its content needs text.`, x, { kind: x.kind, size: x.size, alt: x.alt });
  if (im.logoLike && im.logoLike.length) note('images-of-text', `${im.logoLike.length} image(s) look like logos or banners: ` + im.logoLike.slice(0, 4).map(x => `${x.src || x.sel} (alt "${x.alt}")`).join('; ') + '. Check their alt carries the words in the picture.');

  // =============================================================== Headings
  const h = c.headings || { total: 0, list: [], skips: [], sequence: [], empty: [], fake: [] };
  if (h.total === 0) add('headings-introduce-content', 'NO-HEADINGS', S.serious, 'The page has no headings at all', 'Screen reader users navigate by heading; this page offers them nothing to navigate by.', null, { headings: 0 }, { shot: false });
  for (const x of h.empty || []) add('headings-introduce-content', 'EMPTY-HEADING', S.serious, `An empty h${x.level}`, 'The heading appears in the outline with nothing to announce.', x, { level: x.level });
  for (const x of h.fake || []) add('headings-introduce-content', 'TEXT-STYLED-AS-HEADING', S.moderate, `${q(x.text)} looks like a heading but is a ${x.sel.split(/[.#]/)[0]}`, `${x.size}px, weight ${x.weight}, followed by a block of content. It is missing from the heading outline.`, x, { size: x.size, weight: x.weight });
  if (h.total > 0 && h.h1Count === 0) add('one-h1', 'H1-MISSING', S.serious, 'The page has no h1', `${h.total} headings are present; the first is an h${h.list[0] ? h.list[0].level : '?'} reading ${q(h.list[0] && h.list[0].text)}.`, h.list[0], { h1Count: 0, headings: h.total });
  if (h.h1Count > 1) add('one-h1', 'H1-MULTIPLE', S.moderate, `${h.h1Count} h1 headings on one page`, 'Headings: ' + h.list.filter(x => x.level === 1).map(x => q(x.text)).slice(0, 4).join(', '), h.list.filter(x => x.level === 1)[1], { h1Count: h.h1Count });
  for (const x of h.sequence || []) add('heading-sequence', 'HEADING-OUT-OF-SEQUENCE', S.moderate, x.reason, `Heading ${q(x.text)}.`, x, { level: x.level });
  for (const x of h.skips || []) add('no-skipped-levels', 'HEADING-LEVEL-SKIPPED', S.moderate, `h${x.from} jumps to h${x.to} at ${q(x.at)}`, `Level ${x.from + 1} is skipped, so the outline suggests a missing section.`, x, { from: x.from, to: x.to });

  // ================================================================== Lists
  const li = c.lists || {};
  for (const x of li.siblingAnchors || []) add('list-elements', 'LINKS-NOT-IN-LIST', S.moderate, `${x.count} sibling links are not marked up as a list`, `Links such as ${x.sample.map(q).join(', ')} sit directly in a ${x.sel.split(/[.#]/)[0]}. A list would announce "list, ${x.count} items".`, x, { count: x.count });
  for (const x of (d.landmarks && d.landmarks.navWithoutList) || []) add('list-elements', 'NAV-WITHOUT-LIST', S.minor, `A navigation of ${x.links} links uses no list`, 'Screen readers announce the number of items in a list, which tells the person how big the menu is.', x, { links: x.links });
  for (const x of li.fakeBullets || []) add('list-elements', 'FAKE-BULLETS', S.moderate, `Bullets are typed as text: ${q(x.text)}`, 'Lines starting with typed bullets or numbers are not a list to assistive technology.', x, null);
  for (const x of li.orphanLi || []) add('list-elements', 'LI-OUTSIDE-LIST', S.moderate, `An li sits directly inside a ${x.parent}`, 'List items must be children of ul, ol or menu.', x, { parent: x.parent });

  // =============================================================== Controls
  const L = co.links || {}, B = co.buttons || {};
  for (const x of L.noHref || []) add('a-for-links', 'ANCHOR-WITHOUT-HREF', S.serious, `${q(x.name) || x.sel} is an a element with no href`, 'Without href it is not a link: not focusable, no role, absent from the links list.', x, null);
  for (const x of L.roleLinkNonA || []) add('a-for-links', 'ROLE-LINK-ON-NON-ANCHOR', S.serious, `role="link" on a ${x.sel.split(/[.#]/)[0]}`, 'A real a element with href gives keyboard support, context menus and history for free.', x, null);
  for (const x of L.unnamed || []) add('a-for-links', 'LINK-NO-NAME', S.critical, `A link to ${x.href || '…'} has no accessible name`, `Announced only as "link". ${x.snippet || ''}`, x, { href: x.href });
  for (const x of ct.linksColorOnly || []) add('links-recognizable', 'LINK-COLOR-ONLY', S.serious, `The link ${q(x.text)} is told apart from its sentence by color alone (${x.ratio}:1)`, `Link ${x.link} on text ${x.text_color}: no underline, border or background, and the colors differ by ${x.ratio}:1 where 3:1 is required if color is the only cue.`, x, { link: x.link, text: x.text_color, ratio: x.ratio, required: 3 });
  for (const r of kb.lowContrast || []) add('controls-focus-states', 'FOCUS-LOW-CONTRAST', S.serious, `The focus ring on ${r.name ? q(r.name) : r.sel} reaches only ${r.indicator.ratio}:1`, `${r.indicator.color} ${r.indicator.source} against ${r.background}${r.outer && r.outer !== r.background ? ' / ' + r.outer : ''}. 3:1 is required for a focus indicator.`, r, { color: r.indicator.color, background: r.background, ratio: r.indicator.ratio, required: 3, source: r.indicator.source });
  for (const r of kb.defaultOnly || []) add('controls-focus-states', 'FOCUS-BROWSER-DEFAULT', S.minor, `${r.name ? q(r.name) : r.sel} relies on the browser's default focus ring`, 'Not a failure, but the ring is unstyled and differs between browsers; on some backgrounds it is faint.', r, null, { shot: false });
  for (const x of L.hashHref || []) add('button-for-buttons', 'LINK-USED-AS-BUTTON', S.moderate, `${q(x.name) || 'A link'} has href="${x.href}" and acts as a button`, 'It is announced as a link, scrolls to the top when activated by keyboard, and appears in the links list. Use <button type="button">.', x, { href: x.href });
  for (const x of B.roleButtonNonButton || []) add('button-for-buttons', 'ROLE-BUTTON-ON-' + x.tag.toUpperCase(), x.focusable ? S.minor : S.serious, `role="button" on a ${x.tag}${x.focusable ? '' : ' that cannot receive keyboard focus'}`, x.focusable ? 'A native button gives Enter and Space handling for free.' : 'It has no tabindex, so a keyboard user can never reach it.', x, { tag: x.tag, focusable: x.focusable });
  for (const x of B.clickable || []) add('button-for-buttons', 'CLICKABLE-' + x.tag.toUpperCase(), S.serious, `A ${x.tag} reacts to clicks but is not a button`, `${x.hint || 'It has an onclick handler'}: no role, no name announced as a control, no keyboard access. ${x.snippet || ''}`, x, { tag: x.tag });
  for (const x of B.unnamed || []) add('button-for-buttons', 'BUTTON-NO-NAME', S.critical, 'A button has no accessible name', `Announced only as "button". Usually an icon-only control with no aria-label. ${x.snippet || ''}`, x, null);

  const sk = d.skipLink, ks = kb.skipLink;
  if (!sk || !sk.looksLikeSkip) add('skip-link', 'NO-SKIP-LINK', S.moderate, 'No skip link was found', sk ? `The first in-page link reads ${q(sk.text)} and does not look like a skip link.` : 'No in-page link precedes the main content.', sk, { first: sk ? sk.text : null }, { shot: !!sk });
  else {
    if (!sk.targetExists) add('skip-link', 'SKIP-LINK-BROKEN', S.serious, `The skip link ${q(sk.text)} points at ${sk.href}, which does not exist`, 'Activating it does nothing.', sk, { href: sk.href });
    if (ks && ks.visibleOnFocus === false) add('skip-link', 'SKIP-LINK-HIDDEN-ON-FOCUS', S.serious, `The skip link ${q(sk.text)} stays hidden when it receives focus`, `It is ${ks.hiddenReason || 'not visible'} while focused, so sighted keyboard users cannot see it.`, sk, { reason: ks.hiddenReason }, { shot: false });
  }
  for (const x of L.newWindow || []) add('new-window-links', 'NEW-WINDOW-UNANNOUNCED', S.moderate, `${q(x.name)} opens a new tab without saying so`, `target="_blank" to ${x.href}; nothing in the name, title or description warns the person.`, x, { href: x.href });

  // ================================================================= Tables
  const T = (fo.tables && fo.tables.list) || [];
  for (const t of T) {
    if (t.presentation) continue;
    if (t.layout) { add('table-for-data', 'LAYOUT-TABLE', S.minor, `A ${t.rows}x${t.cols} table is used for layout`, `No header cells, no caption${t.nestedBlocks ? ', block content inside cells' : ''}. Screen readers announce it as a data table.`, t, { rows: t.rows, cols: t.cols }); continue; }
    if (!t.hasTh) add('th-scope', 'TABLE-NO-TH', S.serious, `A ${t.rows}x${t.cols} data table has no header cells`, t.boldFirstRow ? 'The first row is bold td cells: headers dressed as data.' : 'Without th, cells are read without their column or row heading.', t, { rows: t.rows, cols: t.cols });
    else if (t.both && t.thNoScope) add('th-scope', 'TH-NO-SCOPE', S.moderate, `${t.thNoScope} header cells in a two-way table have no scope`, 'With both row and column headers, scope="col" and scope="row" tell the reader which is which.', t, { thNoScope: t.thNoScope });
    if (!t.hasCaption && !t.named) add('table-caption', 'TABLE-NO-CAPTION', S.minor, `A ${t.rows}x${t.cols} data table has no caption`, 'Nothing is announced before the first cell to say what the table contains.', t, { rows: t.rows, cols: t.cols });
  }
  for (const g of (fo.tables && fo.tables.divGrids) || []) add('table-for-data', 'GRID-OF-DIVS', S.moderate, `A ${g.rows}x${g.cols} grid of numbers is built from divs`, 'It reads as a flat list; a table would give each value its heading.', g, { rows: g.rows, cols: g.cols });

  // ================================================================== Forms
  for (const x of fo.unlabeled || []) add('input-labels', 'FIELD-NO-LABEL', S.critical, `A ${x.type} field${x.name ? ' (' + x.name + ')' : ''} has no label`, `Announced as "edit text" with no name. ${x.snippet || ''}`, x, { type: x.type, name: x.name });
  for (const x of fo.placeholderOnly || []) add('input-labels', 'FIELD-PLACEHOLDER-ONLY', S.serious, `A ${x.type} field is labeled only by its placeholder ${q(x.placeholder)}`, 'The placeholder disappears when typing starts and is not a label.', x, { type: x.type, placeholder: x.placeholder });
  for (const x of fo.titleOnly || []) add('input-labels', 'FIELD-TITLE-ONLY', S.serious, `A ${x.type} field is labeled only by a title tooltip`, `title="${x.title}" is not shown to keyboard or touch users.`, x, { title: x.title });
  for (const x of fo.groupsNoFieldset || []) add('fieldset-legend', 'GROUP-NO-FIELDSET', S.moderate, `${x.count} ${x.type} buttons named "${x.name}" have no fieldset and legend`, `Options ${x.options.map(q).join(', ')} are announced without the question they answer.`, x, { name: x.name, count: x.count });
  for (const x of fo.autocompleteMissing || []) add('autocomplete', 'AUTOCOMPLETE-MISSING', S.moderate, `The ${x.label ? q(x.label) : x.name} field has no autocomplete`, `It looks like a ${x.suggest} field. autocomplete="${x.suggest}" lets browsers and assistive technology fill and identify it.`, x, { suggest: x.suggest, name: x.name });
  for (const x of fo.invalidNoDescription || []) add('error-messaging-associated', 'INVALID-NO-DESCRIPTION', S.serious, `A field in an error state${x.name ? ' (' + x.name + ')' : ''} is not linked to its message`, 'aria-invalid or an error class is set, but no aria-describedby or aria-errormessage points at the message.', x, { name: x.name });
  for (const x of fo.colorOnly || []) add('states-not-color-only', 'STATE-COLOR-ONLY', S.serious, `A field's error state${x.name ? ' (' + x.name + ')' : ''} is shown by color alone`, 'No text, icon or symbol near the field says it is invalid.', x, { name: x.name });
  for (const x of fo.requiredNoCue || []) add('states-not-color-only', 'REQUIRED-NO-CUE', S.minor, `The required field ${q(x.label)} has no visible required marker`, 'Nothing in the label says the field is required; if color marks it, that is color alone.', x, { label: x.label });
  if (fo.forms && !((fo.unlabeled || []).length)) note('errors-listed-above-form', `${fo.forms} form(s) on the page. Submit each with errors and check a summary list appears above the form, with a link to each field.`);

  // ================================================================== Media
  for (const v of me.video || []) {
    if (v.autoplay && !v.muted) add('no-autoplay', 'VIDEO-AUTOPLAY-SOUND', S.serious, 'A video autoplays with sound', `${v.src || v.sel}${v.controls ? ', controls present' : ', no controls'}.`, v, { muted: false, controls: v.controls });
    else if (v.autoplay && v.muted && !v.controls && !v.pauseNearby) add('no-autoplay', 'VIDEO-AUTOPLAY-MUTED', S.moderate, 'A muted video autoplays and cannot be paused', `${v.src || v.sel} loops ${v.loop ? 'forever ' : ''}with no controls and no pause button nearby.`, v, { muted: true, loop: v.loop });
    if (!v.hasCaptions) add('captions', 'VIDEO-NO-CAPTIONS', v.muted && v.background ? S.minor : S.serious, v.muted && v.background ? 'A background video has no caption track (fine if it has no speech)' : 'A video has no captions track', `${v.src || v.sel}: no <track kind="captions"> or subtitles. ${v.tracks ? v.tracks + ' other track(s) present.' : ''}`, v, { tracks: v.tracks, muted: v.muted });
    if (v.autoplay && v.loop && !v.controls && !v.pauseNearby) add('pause-background-video', 'BACKGROUND-VIDEO-NO-PAUSE', S.serious, 'A looping background video has no pause control', `${v.src || v.sel} autoplays and loops; no controls attribute and no pause button beside it.`, v, { loop: true });
    if (!v.controls && !v.pauseNearby && v.playing) add('media-pausable', 'MEDIA-NOT-PAUSABLE', S.serious, 'A playing video offers no way to pause it', `${v.src || v.sel} has no controls attribute and no pause button nearby.`, v, null);
  }
  for (const a of me.audio || []) {
    if (a.autoplay && !a.muted) add('no-autoplay', 'AUDIO-AUTOPLAY', S.critical, 'Audio starts playing automatically', `${a.src || a.sel} autoplays; it will talk over a screen reader.`, a, { controls: a.controls });
    if (!a.controls && !a.pauseNearby) add('media-pausable', 'AUDIO-NOT-PAUSABLE', S.serious, 'An audio element has no controls', `${a.src || a.sel} has no controls attribute and no play/pause button nearby.`, a, null);
    if (!a.transcriptNearby) add('transcripts', 'AUDIO-NO-TRANSCRIPT', S.moderate, 'No transcript is offered near an audio player', `${a.src || a.sel}: nothing nearby mentions a transcript.`, a, null);
  }
  for (const e of me.embeds || []) {
    if (e.autoplay) add('no-autoplay', 'EMBED-AUTOPLAY', S.serious, `An embedded ${e.provider} player is set to autoplay`, e.src, e, { src: e.src });
    if (e.provider === 'audio' && !e.transcriptNearby) add('transcripts', 'EMBED-NO-TRANSCRIPT', S.moderate, 'No transcript is offered near an embedded audio player', e.src, e, null);
  }
  if ((me.embeds || []).some(e => e.provider !== 'audio')) note('captions', `${me.embeds.filter(e => e.provider !== 'audio').length} embedded video player(s) (${[...new Set(me.embeds.map(e => e.provider))].join(', ')}): check captions are enabled on the platform.`);
  for (const x of me.customControls || []) add('media-controls-markup', 'MEDIA-CONTROL-MARKUP', S.moderate, `Media control: ${x.issue}`, `${x.snippet || x.sel}`, x, { issue: x.issue });
  for (const x of (co.buttons && co.buttons.togglesNoState) || []) add('media-controls-markup', 'TOGGLE-NO-STATE', S.minor, `The ${q(x.name)} toggle has no aria-pressed or aria-expanded`, 'A screen reader cannot tell whether it is on or off.', x, null);

  const an = me.animations || {};
  for (const x of an.fast || []) add('subtle-animation', 'FAST-FLASHING-ANIMATION', S.critical, `"${x.name}" cycles every ${x.duration}ms on a ${Math.round(Math.sqrt(x.area))}px area`, 'More than three cycles per second on a visible area is in seizure-trigger territory.', x, { duration: x.duration, area: x.area });
  for (const x of an.infinite || []) if (!(an.fast || []).some(f => f.path === x.path)) add('subtle-animation', 'INFINITE-ANIMATION', S.minor, `"${x.name}" animates ${x.sel} indefinitely (${x.duration}ms per cycle)`, 'Continuous motion competes with reading. It needs to be subtle, or pausable.', x, { duration: x.duration });
  if (an.reducedMotion && an.reducedMotion.measured) {
    for (const x of an.reducedMotion.list || []) add('prefers-reduced-motion', 'ANIMATION-IGNORES-REDUCED-MOTION', S.moderate, `"${x.name}" keeps running with reduce motion switched on`, `${x.kind} on ${x.sel}, ${x.duration}ms${x.iterations === Infinity ? ', infinite' : ''}. The page has ${d.reducedMotionRules || 0} prefers-reduced-motion rule(s).`, x, { duration: x.duration, reducedMotionRules: d.reducedMotionRules || 0 });
  }

  // ========================================================= Color contrast
  for (const f of ct.solid || []) add(f.large ? 'contrast-large-text' : 'contrast-normal-text', f.large ? 'CONTRAST-LARGE-TEXT' : 'CONTRAST-NORMAL-TEXT', f.ratio < (f.large ? 2 : 3) ? S.critical : S.serious,
    `Text contrast ${f.ratio}:1, needs ${f.required}:1`, `${q(f.text)} renders ${f.foreground} on ${f.background} at ${f.size}px${f.large ? ' (large text)' : ''}, weight ${f.weight}.`, f, { ratio: f.ratio, required: f.required, foreground: f.foreground, background: f.background, size: f.size, weight: f.weight, method: 'computed' });
  for (const f of ct.overArt || []) add('contrast-over-media', 'CONTRAST-OVER-' + f.backdrop.kind.toUpperCase(), f.ratio < 3 ? S.critical : S.serious,
    `Text over ${f.backdrop.kind} reaches only ${f.ratio}:1 at its worst point, needs ${f.required}:1`, `${q(f.text)} in ${f.foreground} sits on ${f.backdrop.sel}. The backdrop measured from rendered pixels ranges ${f.backgroundRange.darkest} to ${f.backgroundRange.lightest}; the worst case is ${f.background}.`, f, { ratio: f.ratio, required: f.required, foreground: f.foreground, backgroundRange: f.backgroundRange, backdrop: f.backdrop, method: 'sampled pixels' });
  for (const f of ct.icons || []) add('contrast-icons', 'ICON-LOW-CONTRAST', S.serious, `The ${f.name ? q(f.name) + ' ' : ''}icon reaches only ${f.ratio}:1, needs 3:1`, `Icon ${f.foreground} on ${f.background}; it is the only visible cue for this control.`, f, { foreground: f.foreground, background: f.background, ratio: f.ratio, required: 3 });
  for (const f of ct.inputBorders || []) add('contrast-input-borders', f.border ? 'INPUT-BORDER-LOW-CONTRAST' : 'INPUT-NO-VISIBLE-EDGE', S.serious, f.border ? `A ${f.type} field's border reaches only ${f.ratio}:1, needs 3:1` : `A ${f.type} field has no visible edge`, f.border ? `Border ${f.border} (${f.width}px) on ${f.background}.` : `${f.note}; on ${f.background} the field cannot be found by sight.`, f, { border: f.border, background: f.background, ratio: f.ratio, required: 3 });
  for (const s of ct.selection || []) add('selection-colors', 'SELECTION-LOW-CONTRAST', S.moderate, `Selected text reaches only ${s.ratio}:1 with the custom ::selection colors`, `${s.selector}: color ${s.color} on ${s.backgroundColor}. 4.5:1 is needed for selected text to stay readable.`, null, { selector: s.selector, color: s.color, backgroundColor: s.backgroundColor, ratio: s.ratio }, { shot: false });

  // ======================================================== Mobile and touch
  const base = rs.base || {};
  if (base.horizontalScroll) add('no-horizontal-scroll', 'HORIZONTAL-SCROLL', S.serious, `The page scrolls sideways at ${base.viewport}px`, `The document is ${base.documentWidth}px wide in a ${base.viewport}px viewport. ${base.overflowingCount} element(s) extend past the right edge${base.overflowing[0] ? ', first: ' + base.overflowing[0].sel + ' reaching ' + base.overflowing[0].right + 'px' : ''}.`, base.overflowing[0], { viewport: base.viewport, documentWidth: base.documentWidth, overflowing: base.overflowing.slice(0, 8) });
  const nar = rs.narrow;
  if (nar && nar.horizontalScroll && !base.horizontalScroll) add('simple-layout', 'REFLOW-320', S.serious, 'Content does not reflow at 320px wide', `At 320 CSS pixels (400% zoom of a 1280px window) the document is ${nar.documentWidth}px wide; ${nar.overflowingCount} element(s) overflow${nar.overflowing[0] ? ', first: ' + nar.overflowing[0].sel : ''}.`, null, { documentWidth: nar.documentWidth, overflowing: nar.overflowing.slice(0, 8) }, { shot: false });
  const z = rs.zoomed;
  if (z) {
    // New clipping, or clipping that got markedly worse: more of the text is lost once it is enlarged.
    const worse = (z.clipped || []).filter(x => {
      const b = (base.clipped || []).find(y => y.path === x.path);
      return !b || (x.actual - x.visible) >= 2 * (b.actual - b.visible) + 8;
    });
    for (const x of worse.slice(0, 10)) add('text-size-200', 'TEXT-CLIPPED-AT-200', S.moderate, `${q(x.text)} is cut off at 200% zoom`, `Its box shows ${x.visible}px of ${x.actual}px of content once text is enlarged; the container has a fixed height with overflow hidden.`, x, { visible: x.visible, actual: x.actual }, { shot: true });
    const newOverlap = (z.overlaps || []).filter(x => !(base.overlaps || []).some(b => b.sel === x.sel));
    for (const x of newOverlap.slice(0, 10)) add('text-size-200', 'TEXT-OVERLAPS-AT-200', S.moderate, `${q(x.a.text)} overlaps ${q(x.b.text)} at 200% zoom`, 'Text boxes collide once text is enlarged.', x, null, { shot: false });
  }
  for (const x of (rs.forced && rs.forced.lost) || []) add('specialized-browsing-modes', 'LOST-IN-FORCED-COLORS', S.moderate, `${x.name ? q(x.name) : x.sel} disappears in high-contrast mode`, `${x.why}. Forced-colors mode removes background images and box shadows, so nothing of this control remains visible.`, x, null);
  for (const r of kb.shadowOnly || []) add('specialized-browsing-modes', 'FOCUS-RING-BOX-SHADOW-ONLY', S.minor, `The focus ring on ${r.name ? q(r.name) : r.sel} is drawn only with box-shadow`, 'Forced-colors mode removes box shadows, so this focus indicator disappears there. Use outline as well.', r, null, { shot: false });
  for (const x of c.sensory || []) add('instructions-not-sensory', 'SENSORY-INSTRUCTION', S.minor, `An instruction relies on sight or sound: ${q(x.phrase)}`, `${q(x.text)}`, x, { phrase: x.phrase });
  if (d.orientation && (d.orientation.lockCalls || d.orientation.portraitOnlyRules)) add('orientation', 'ORIENTATION-LOCK-HINT', S.moderate, d.orientation.lockCalls ? 'A script locks the screen orientation' : 'A stylesheet hides the page in one orientation', d.orientation.lockCalls ? `${d.orientation.lockCalls} call(s) to screen.orientation.lock found in inline scripts.` : `${d.orientation.portraitOnlyRules} rule(s) set display:none on the page in a portrait or landscape media query.`, null, d.orientation, { shot: false });

  const failingAA = (tg.undersized || []).filter(u => u.failsAA);
  for (const u of failingAA) add('target-size', 'TARGET-TOO-SMALL', S.moderate, `${u.name ? q(u.name) : u.sel} is ${u.size[0]}x${u.size[1]}px and crowded by neighbors`, 'Under 24x24 CSS pixels with another target within 24px: fails 2.5.8 (AA). The checklist also cites the 44x44 target of 2.5.5 (AAA).', u, { size: u.size, required: 24 });
  if (level === 'AAA' || isPhone) {
    const aaa = (tg.undersized || []).filter(u => u.failsAAA && !u.failsAA && !u.inlineException && (u.size[0] < 44 || u.size[1] < 44) && (u.size[0] < 32 || u.size[1] < 32));
    for (const u of aaa.slice(0, 15)) add('target-size', 'TARGET-UNDER-44', S.minor, `${u.name ? q(u.name) : u.sel} is ${u.size[0]}x${u.size[1]}px`, 'Meets 2.5.8 (24px with spacing) but not the 44x44 of 2.5.5 that comfortable touch use needs.', u, { size: u.size, required: 44 });
  }
  if (isPhone) for (const x of (tg.crowded || []).slice(0, 12)) add('scroll-space', 'TARGETS-TOUCHING', S.minor, `${x.name ? q(x.name) : x.sel} is ${x.gap}px from ${x.neighborName ? q(x.neighborName) : x.neighbor}`, 'Controls with no space between them leave nowhere safe to touch when scrolling.', x, { gap: x.gap });

  // ------------------------------------------------------------ statuses
  const failing = new Set(findings.map(f => f.item));
  const has = {
    images: (im.imgCount || 0) + (im.total || 0) > 0,
    forms: (fo.fields || 0) > 0,
    tables: T.filter(t => !t.presentation).length > 0 || ((fo.tables && fo.tables.divGrids) || []).length > 0,
    media: ((me.video || []).length + (me.audio || []).length + (me.embeds || []).length) > 0,
    video: ((me.video || []).length + (me.embeds || []).filter(e => e.provider !== 'audio').length) > 0,
    audio: ((me.audio || []).length + (me.embeds || []).filter(e => e.provider === 'audio').length) > 0,
    animation: ((an.running || 0) > 0) || ((me.video || []).some(v => v.autoplay)),
    backgroundVideo: (me.video || []).some(v => v.autoplay && v.loop),
    inlineLinks: true, controls: (co.links && co.links.total) + (co.buttons && co.buttons.total) > 0,
    tabStops: (kb.stops || 0) > 0,
    overArt: (ct.overArtChecked || 0) + (ct.overArtSkipped || 0) > 0,
    selection: ((d.selection || []).length) > 0,
    icons: true, largeText: true
  };
  const NA = {
    'img-alt': !has.images, 'decorative-null-alt': !has.images, 'complex-images': !has.images, 'images-of-text': !has.images,
    'table-for-data': !has.tables, 'th-scope': !has.tables, 'table-caption': !has.tables,
    'input-labels': !has.forms, 'fieldset-legend': !has.forms, 'autocomplete': !has.forms, 'errors-listed-above-form': !has.forms, 'error-messaging-associated': !has.forms, 'states-not-color-only': !has.forms,
    'no-autoplay': !has.media, 'media-controls-markup': !has.media, 'media-pausable': !has.media, 'captions': !has.video, 'seizure-triggers': !has.video && !has.animation, 'transcripts': !has.audio,
    'pause-background-video': !has.backgroundVideo, 'prefers-reduced-motion': !has.animation && !(an.total > 0), 'subtle-animation': !has.animation,
    'contrast-over-media': !has.overArt, 'selection-colors': !has.selection,
    'visible-focus': !has.tabStops, 'controls-focus-states': !has.tabStops, 'focus-order-visual': !has.tabStops, 'invisible-focusable': !has.tabStops,
    'scroll-space': !isPhone, 'contrast-input-borders': !has.forms
  };

  const items = {};
  for (const it of ITEMS) {
    const count = findings.filter(f => f.item === it.id).length;
    let status;
    if (count) status = 'fail';
    else if (NA[it.id]) status = 'na';
    else if (it.automated === 'yes') status = 'pass';
    else status = 'review';
    items[it.id] = { status, count, note: notes[it.id] || null };
  }

  findings.forEach(f => { f.page = ctx.page; f.url = ctx.url; f.width = ctx.width; });
  findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  return { findings, items };
}

module.exports = { evaluate, ORDER, SEVERITY: S };
