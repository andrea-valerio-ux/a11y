'use strict';
// Audio, video, embedded players and animation. Reduced-motion compliance is
// measured by switching the preference on and counting what still moves.
const { sleep } = require('../browser');

module.exports = {
  id: 'media',
  label: 'media and animation',
  async collect(page) {
    const base = await page.evaluate(() => {
      const H = window.__a11y;
      const cap = (arr, n = 20) => arr.slice(0, n);
      const entry = (e, extra) => ({ sel: H.selOf(e), path: H.pathOf(e), rect: H.box(e), snippet: H.snippet(e), ...extra });

      const nearText = (e, re) => {
        // Look at the element's container and the next couple of siblings.
        const c = e.closest('figure,div,section,article') || e.parentElement;
        const spots = [c, c && c.nextElementSibling, c && c.previousElementSibling, e.nextElementSibling, e.previousElementSibling].filter(Boolean);
        return spots.some(s => re.test(H.textOf(s)) || [...s.querySelectorAll('a,button,summary')].some(x => re.test(H.accName(x))));
      };
      const controlNear = (e, re) => {
        const c = e.closest('figure,div,section,article') || e.parentElement;
        const spots = [c, c && c.parentElement].filter(Boolean);
        return spots.some(s => [...s.querySelectorAll('button,[role=button],a[href]')].some(x => re.test(H.accName(x) + ' ' + (x.className || ''))));
      };

      const video = [...document.querySelectorAll('video')].map(v => {
        const r = H.box(v) || [0, 0, 0, 0];
        const big = r[2] * r[3] > innerWidth * innerHeight * 0.3;
        return entry(v, {
          autoplay: v.autoplay || v.hasAttribute('autoplay'), muted: v.muted || v.hasAttribute('muted'), loop: v.loop,
          controls: v.controls, playing: !v.paused && !v.ended, duration: isFinite(v.duration) ? +v.duration.toFixed(1) : null,
          hasCaptions: !!v.querySelector('track[kind=captions],track[kind=subtitles]'),
          tracks: v.querySelectorAll('track').length,
          pauseNearby: controlNear(v, /pause|play|stop/i),
          background: big && !v.controls && (v.muted || v.hasAttribute('muted')) && (v.loop || v.autoplay),
          src: (v.currentSrc || v.src || (v.querySelector('source') || {}).src || '').split('/').pop().slice(0, 60)
        });
      });
      const audio = [...document.querySelectorAll('audio')].map(a => entry(a, {
        autoplay: a.autoplay || a.hasAttribute('autoplay'), muted: a.muted, controls: a.controls, playing: !a.paused && !a.ended,
        transcriptNearby: nearText(a, /transcript/i), pauseNearby: controlNear(a, /pause|play|stop/i),
        src: (a.currentSrc || a.src || (a.querySelector('source') || {}).src || '').split('/').pop().slice(0, 60)
      }));
      const embeds = [...document.querySelectorAll('iframe[src*="youtube"],iframe[src*="youtu.be"],iframe[src*="vimeo"],iframe[src*="wistia"],iframe[src*="dailymotion"],iframe[src*="soundcloud"],iframe[src*="spotify"],iframe[src*="brightcove"],iframe[src*="loom.com"]')]
        .filter(H.visible).map(f => entry(f, { src: (f.src || '').slice(0, 100), provider: (/youtube|youtu\.be/.test(f.src) ? 'YouTube' : /vimeo/.test(f.src) ? 'Vimeo' : /soundcloud|spotify/.test(f.src) ? 'audio' : 'video'),
          autoplay: /autoplay=1|autoplay=true/i.test(f.src), transcriptNearby: nearText(f, /transcript/i) }));

      // Custom players: a media element without native controls plus divs
      // acting as controls.
      const customControls = [];
      [...document.querySelectorAll('video:not([controls]),audio:not([controls])')].forEach(m => {
        const c = m.closest('div,section,figure') || m.parentElement;
        if (!c) return;
        c.querySelectorAll('[class*=play],[class*=pause],[class*=mute],[class*=volume],[class*=control]').forEach(x => {
          if (customControls.length >= 10 || x === m || !H.visible(x)) return;
          if (x.matches('button,input,a[href],[role=button],[role=slider]')) {
            if (x.matches('button,[role=button]') && !H.accName(x)) customControls.push(entry(x, { issue: 'control has no name' }));
            else if (/mute|volume/i.test(x.className) && x.matches('button') && !x.hasAttribute('aria-pressed')) customControls.push(entry(x, { issue: 'toggle without aria-pressed' }));
          } else if (/^(DIV|SPAN|I)$/.test(x.tagName) && !x.querySelector('button,input,a') && getComputedStyle(x).cursor === 'pointer') {
            customControls.push(entry(x, { issue: 'control is a ' + x.tagName.toLowerCase() + ', not a button' }));
          }
        });
      });

      // Animations currently running
      const anims = document.getAnimations ? document.getAnimations() : [];
      const infinite = [], fast = [];
      let running = 0;
      anims.forEach(a => {
        if (a.playState !== 'running') return;
        running++;
        const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
        const target = a.effect && a.effect.target;
        if (!target || !target.getBoundingClientRect) return;
        const dur = typeof t.duration === 'number' ? t.duration : 0;
        const r = H.box(target) || [0, 0, 0, 0];
        const item = { sel: H.selOf(target), path: H.pathOf(target), rect: r, name: (a.animationName || a.transitionProperty || a.id || 'animation').slice(0, 40), duration: dur, iterations: t.iterations, area: r[2] * r[3], kind: a.constructor.name };
        if (t.iterations === Infinity && dur > 0 && !/spin|rotate|loader|loading|progress/i.test(item.name + ' ' + item.sel)) {
          if (infinite.length < 15) infinite.push(item);
        }
        if (t.iterations === Infinity && dur > 0 && dur < 334 && (r[2] * r[3] > 2500)) { if (fast.length < 10) fast.push(item); }
      });

      return { video, audio, embeds, customControls, animations: { running, total: anims.length, infinite, fast } };
    });

    // Reduced motion: switch the preference on and count what still moves.
    let reduced = { stillRunning: 0, list: [], measured: false };
    try {
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await sleep(400);
      reduced = await page.evaluate(() => {
        const H = window.__a11y;
        const anims = (document.getAnimations ? document.getAnimations() : []).filter(a => a.playState === 'running');
        const list = [];
        anims.forEach(a => {
          const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
          const dur = typeof t.duration === 'number' ? t.duration : 0;
          const target = a.effect && a.effect.target;
          if (!target || !target.getBoundingClientRect || dur < 100) return;
          if (list.length < 15) list.push({ sel: H.selOf(target), path: H.pathOf(target), rect: H.box(target), name: (a.animationName || a.transitionProperty || 'animation').slice(0, 40), duration: dur, iterations: t.iterations, kind: a.constructor.name });
        });
        return { stillRunning: list.length, list, measured: true, matches: matchMedia('(prefers-reduced-motion: reduce)').matches };
      });
    } catch (e) { reduced.error = String(e.message || e).slice(0, 100); }
    finally {
      try { await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]); } catch (e) { /* ignore */ }
    }
    base.animations.reducedMotion = reduced;
    return base;
  }
};
