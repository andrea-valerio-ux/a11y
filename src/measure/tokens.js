'use strict';
// Design tokens as the page actually uses them: the CSS custom properties
// declared in the stylesheets with their raw and resolved values, the colors
// and typefaces painted on visible elements, and the icon system in use.
module.exports = {
  id: 'tokens',
  label: 'colors, typography and iconography',
  async collect(page) {
    return page.evaluate(() => {
      const H = window.__a11y;
      const hexOf = c => { const v = H.rgb(c); return v ? H.hex(v) : null; };

      // --- custom properties declared in reachable stylesheets ---------------
      const vars = {};
      const fontFaces = [];
      const walk = rules => {
        for (const r of rules) {
          try {
            if (r.type === 5) {   // @font-face
              fontFaces.push({ family: (r.style.getPropertyValue('font-family') || '').replace(/["']/g, '').trim(), weight: r.style.getPropertyValue('font-weight') || '400', src: (r.style.getPropertyValue('src') || '').slice(0, 120) });
              continue;
            }
            // Style rules carry declarations; with CSS nesting they can also hold child rules, so both are read.
            if (r.style) {
              for (let i = 0; i < r.style.length; i++) {
                const prop = r.style[i];
                if (!prop.startsWith('--')) continue;
                const raw = r.style.getPropertyValue(prop).trim();
                if (!vars[prop]) vars[prop] = { name: prop, raw, selector: (r.selectorText || '').slice(0, 60), uses: 0 };
              }
            }
            if (r.cssRules && r.cssRules.length) walk(r.cssRules);
          } catch (e) { /* cross-origin or odd rule */ }
        }
      };
      for (const ss of document.styleSheets) { try { walk(ss.cssRules); } catch (e) { /* cross-origin */ } }

      // Resolve each variable on a probe so var(--a) chains and color keywords become concrete values.
      // The probe sits in a wrapper with a sentinel color: a variable that is
      // not a valid color makes color: var(--x) fall back to the inherited
      // sentinel, which tells the two cases apart.
      const wrap = document.createElement('div');
      wrap.setAttribute('data-a11y-evidence', '1');
      wrap.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;color:rgb(1, 2, 3)';
      const probe = document.createElement('div');
      wrap.appendChild(probe); document.body.appendChild(wrap);
      const FONTISH = /^(["']?[A-Za-z][\w\s-]*["']?\s*,\s*)*(serif|sans-serif|monospace|system-ui|cursive|fantasy|ui-[a-z-]+|-apple-system|BlinkMacSystemFont|["'][^"']+["']|[A-Z][\w-]*(\s[A-Z][\w-]*)*)$/;
      for (const v of Object.values(vars)) {
        const rawResolved = getComputedStyle(document.documentElement).getPropertyValue(v.name).trim() || v.raw;
        v.resolved = rawResolved;
        probe.style.color = '';
        probe.style.setProperty('color', `var(${v.name})`);
        const asColor = getComputedStyle(probe).color;
        const validColor = asColor !== 'rgb(1, 2, 3)' && asColor !== 'rgba(1, 2, 3, 0)';
        const hex = validColor ? hexOf(asColor) : null;
        if (/shadow/i.test(v.name) || /^\S+\s+\S+\s+\S+.*(rgb|#|hsl)/.test(rawResolved) && !validColor) { v.kind = 'shadow'; v.value = rawResolved.slice(0, 80); }
        else if (hex && validColor) { v.kind = 'color'; v.value = hex; }
        else if (/^-?[\d.]+(px|rem|em|%|vw|vh|ch)$/.test(rawResolved) || /clamp\(|calc\(/.test(rawResolved)) {
          v.kind = /font|text|type|size|leading|line/i.test(v.name) ? 'font-size' : /radius|round/i.test(v.name) ? 'radius' : /space|gap|pad|margin|inset|gutter/i.test(v.name) ? 'spacing' : 'size';
          v.value = rawResolved;
        }
        else if (FONTISH.test(rawResolved) && (/font|family|type|face/i.test(v.name) || /serif|sans|mono|system-ui|["']/.test(rawResolved))) { v.kind = 'font-family'; v.value = rawResolved.replace(/["']/g, ''); }
        else if (/^\d{3}$|^(bold|normal|lighter|bolder)$/.test(rawResolved) && /weight|bold/i.test(v.name)) { v.kind = 'font-weight'; v.value = rawResolved; }
        else if (/^[\d.]+m?s(\s|,|$)|ease|cubic-bezier/.test(rawResolved) || /duration|transition|motion|easing/i.test(v.name)) { v.kind = 'motion'; v.value = rawResolved.slice(0, 60); }
        else { v.kind = 'other'; v.value = rawResolved.slice(0, 80); }
      }
      wrap.remove();
      const varsByColor = {};
      for (const v of Object.values(vars)) if (v.kind === 'color') (varsByColor[v.value] = varsByColor[v.value] || []).push(v.name);
      const varsByFamily = {};
      for (const v of Object.values(vars)) if (v.kind === 'font-family') { const fam = v.value.split(',')[0].trim(); (varsByFamily[fam] = varsByFamily[fam] || []).push(v.name); }

      // --- colors and type as painted -------------------------------------
      const colors = {};
      const families = {};
      let elements = 0;
      const addColor = (hex, prop, el) => {
        if (!hex) return;
        const c = colors[hex] = colors[hex] || { value: hex, hits: 0, props: {}, where: [] };
        c.hits++; c.props[prop] = (c.props[prop] || 0) + 1;
        const s = H.selOf(el); if (c.where.length < 5 && !c.where.includes(s)) c.where.push(s);
      };
      const els = [...document.querySelectorAll('body *')].filter(e => !H.isSkipped(e) && H.visible(e)).slice(0, 4000);
      for (const e of els) {
        elements++;
        const s = getComputedStyle(e);
        const own = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 0);
        if (own) {
          addColor(hexOf(s.color), 'text', e);
          const fam = s.fontFamily.split(',')[0].replace(/["']/g, '').trim();
          const f = families[fam] = families[fam] || { family: fam, hits: 0, sizes: {}, weights: {}, stack: s.fontFamily.slice(0, 120), roles: {} };
          f.hits++;
          const size = Math.round(parseFloat(s.fontSize) * 10) / 10;
          f.sizes[size] = (f.sizes[size] || 0) + 1;
          f.weights[s.fontWeight] = (f.weights[s.fontWeight] || 0) + 1;
          const role = /^H[1-6]$/.test(e.tagName) ? e.tagName.toLowerCase() : e.closest('button,a[href]') ? 'control' : e.tagName === 'CODE' || e.tagName === 'PRE' ? 'code' : 'body';
          f.roles[role] = (f.roles[role] || 0) + 1;
        }
        addColor(hexOf(s.backgroundColor), 'background', e);
        if (parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none') addColor(hexOf(s.borderTopColor), 'border', e);
        if (e.tagName.toLowerCase() === 'svg' || e.closest('svg')) { const fill = s.fill && s.fill !== 'none' ? hexOf(s.fill) : null; if (fill) addColor(fill, 'icon', e); }
      }
      addColor(hexOf(getComputedStyle(document.body).backgroundColor) || '#FFFFFF', 'page background', document.body);

      // --- iconography -----------------------------------------------------
      const q = s => document.querySelectorAll(s).length;
      const libs = [
        { name: 'Font Awesome', count: q('i[class*="fa-"],span[class*="fa-"],svg[data-prefix],.fa,.fas,.far,.fab,.fal') + fontFaces.filter(f => /awesome/i.test(f.family)).length * 0, hint: 'fa- classes or svg[data-prefix]' },
        { name: 'Material Icons / Symbols', count: q('.material-icons,.material-symbols-outlined,.material-symbols-rounded,.material-symbols-sharp,.material-icons-outlined,.material-icons-round,mat-icon'), hint: 'material-icons classes' },
        { name: 'Bootstrap Icons', count: q('i[class*="bi-"],.bi'), hint: 'bi- classes' },
        { name: 'Feather', count: q('[data-feather],svg.feather'), hint: 'data-feather or svg.feather' },
        { name: 'Lucide', count: q('svg.lucide,[class*="lucide-"],[data-lucide]'), hint: 'lucide classes' },
        { name: 'Heroicons', count: q('svg[class*="heroicon"],[data-slot="icon"]'), hint: 'heroicon classes or data-slot="icon"' },
        { name: 'Ionicons', count: q('ion-icon,[class*="ion-"]'), hint: 'ion-icon elements' },
        { name: 'Phosphor', count: q('[class*="ph-"],i.ph'), hint: 'ph- classes' },
        { name: 'Remix Icon', count: q('i[class*="ri-"]'), hint: 'ri- classes' },
        { name: 'Tabler Icons', count: q('svg[class*="tabler-icon"],[class*="icon-tabler"]'), hint: 'tabler-icon classes' },
        { name: 'Iconify', count: q('.iconify,iconify-icon,[data-icon]'), hint: 'iconify elements' },
        { name: 'Boxicons', count: q('i[class*="bx-"],.bx'), hint: 'bx- classes' },
        { name: 'Simple Line / Themify / Line Awesome', count: q('[class*="icon-"],[class*="ti-"],[class*="la-"]'), hint: 'generic icon- classes', weak: true }
      ].filter(l => l.count > 0);
      const iconFonts = fontFaces.filter(f => /icon|awesome|glyph|symbol|material/i.test(f.family)).map(f => f.family);
      const inlineSvg = [...document.querySelectorAll('svg')].filter(s => { const r = s.getBoundingClientRect(); return r.width > 0 && r.width <= 64 && r.height <= 64 && !s.closest('svg svg'); });
      const sprite = document.querySelectorAll('svg use').length;
      const spriteFiles = [...new Set([...document.querySelectorAll('svg use')].map(u => (u.getAttribute('href') || u.getAttribute('xlink:href') || '').split('#')[0]).filter(Boolean))].slice(0, 5);
      const imgIcons = [...document.querySelectorAll('img')].filter(i => { const r = i.getBoundingClientRect(); return r.width > 0 && r.width <= 48 && r.height <= 48; });
      const svgImg = imgIcons.filter(i => /\.svg(\?|$)/i.test(i.currentSrc || i.src || '')).length;
      const iconColors = {};
      for (const s of inlineSvg) {
        const cs = getComputedStyle(s);
        const c = (cs.fill && cs.fill !== 'none' ? hexOf(cs.fill) : null) || hexOf(cs.color) || (cs.stroke && cs.stroke !== 'none' ? hexOf(cs.stroke) : null);
        if (c) iconColors[c] = (iconColors[c] || 0) + 1;
      }
      const iconSizes = {};
      for (const s of inlineSvg) { const r = s.getBoundingClientRect(); const k = Math.round(r.width) + 'x' + Math.round(r.height); iconSizes[k] = (iconSizes[k] || 0) + 1; }

      return {
        elements,
        variables: Object.values(vars).map(v => ({ ...v, raw: v.raw.slice(0, 120), resolved: (v.resolved || '').slice(0, 120) })).slice(0, 400),
        variableCount: Object.keys(vars).length,
        colors: Object.values(colors).sort((a, b) => b.hits - a.hits).slice(0, 60).map(c => ({ ...c, variables: varsByColor[c.value] || [] })),
        fonts: Object.values(families).sort((a, b) => b.hits - a.hits).slice(0, 12).map(f => ({ ...f, variables: varsByFamily[f.family] || [], webfont: fontFaces.some(ff => ff.family.toLowerCase() === f.family.toLowerCase()) })),
        fontFaces: fontFaces.slice(0, 40),
        icons: {
          libraries: libs, iconFonts, inlineSvg: inlineSvg.length, sprite, spriteFiles, imgIcons: imgIcons.length, svgImg,
          colors: Object.entries(iconColors).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([value, hits]) => ({ value, hits, variables: varsByColor[value] || [] })),
          sizes: Object.entries(iconSizes).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([size, hits]) => ({ size, hits }))
        }
      };
    });
  }
};
