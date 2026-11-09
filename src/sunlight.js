/* grass-oclock · sunlight.js
   Day → dusk → twilight → night, driven by the visitor's own clock (their local time: no location, no login),
   changing minute by minute while the page stays open (each step fades over about an hour).

   - day:      plain, nothing added
   - dusk:     backlight. The sun is just off the top-right corner; the grass darkens a little, sun-facing edges get a
               thin gold rim that blooms outwards, warm glow, haze, floating motes of light
   - twilight: lavender sky, the last pink-orange light, first stars and fireflies
               (added because mixing cream straight into navy passes through a rainy grey)
   - night:    navy page, moonlight with silver-blue rims, a starry sky, fireflies over the field, light text

   What this file does every frame:
   1. works out how much of each look applies right now and blends every number → window.SUNLIGHT
      (field.js reads it every frame for shade / rim / glow)
   2. sets page colours as CSS variables on <html>: --paper --line --line-soft --ink --ink-2 --ink-3 --red
      --primary --primary-hover --on-primary --sky-op (text flips to light in one quick step once the background is
      dark enough, never a grey-on-grey midpoint)
   3. draws the glow / vignette / motes / fireflies on an overlay (.sun) and the night sky inside your .sky element

   Usage:
     const sun = Sunlight.mount({ sky: document.querySelector('.sky'), after: document.querySelector('.stage') });
     sun.setHours(18.5);   // pin the clock to 18:30 (e.g. from a slider)
     sun.setHours(null);   // back to the visitor's real clock
   URL helpers: ?time=19:30 pins the time, ?nosun = always day.
*/
(function () {
  'use strict';

  /* ---------- schedule: which look at what hour (blended in between) ---------- */
  // Fixed times (a Taiwanese autumn sunset), not seasonal. Change them here.
  const SCHEDULE = [
    [0, 'night'],
    [4.75, 'night'],     // 04:45 dawn begins
    [5.3, 'twilight'],
    [5.9, 'dusk'],       // morning backlight (same look as dusk)
    [7, 'day'],          // 07:00 full day
    [16, 'day'],         // 16:00 dusk begins
    [17.25, 'dusk'],
    [18, 'dusk'],        // 18:00 sunset
    [18.6, 'twilight'],
    [19.4, 'night'],     // 19:24 full night
    [24, 'night'],
  ];

  /* ---------- the four looks ----------
     strengths: 0 = off, 1 = standard (grass-related standards live in field.js)
     colours: page colours as #hex; grass colours as 0–1 RGB; glow / vignette as 0–255 */
  const PRESETS = {
    day: {
      shade: 0, grassRim: 0, bloom: 0, mist: 0, glow: 0, rays: 0, vignette: 0, haze: 0, dust: 0, fire: 0, stars: 0,
      rimCol: [1.0, 0.86, 0.6], shadeCol: [0.58, 0.53, 0.45], farCol: [0.76, 0.77, 0.64],
      light: [255, 238, 200], shadow: [62, 46, 30],
      paper: '#faf8f2', line: '#ddd9cb', lineSoft: '#eae7dc',
    },
    dusk: {
      shade: 0.5,      // darken the grass
      grassRim: 0.1,   // gold rim on blades (too strong and the painted grass turns into lines)
      bloom: 1,        // glow on bright parts
      mist: 0,         // soft-focus mist (off)
      glow: 1.15,      // sun glow in the top-right
      rays: 0,         // light shafts (off)
      vignette: 0.3,   // darker bottom-left corner
      haze: 2,         // thin haze over everything
      dust: 2,         // floating motes
      fire: 0, stars: 0,
      rimCol: [1.0, 0.86, 0.6], shadeCol: [0.58, 0.53, 0.45], farCol: [0.76, 0.77, 0.64],
      light: [255, 238, 200], shadow: [62, 46, 30],
      paper: '#faf8f2', line: '#ddd9cb', lineSoft: '#eae7dc',
    },
    twilight: {
      shade: 0.8, grassRim: 0.15, bloom: 0.9, mist: 0, glow: 0.9, rays: 0, vignette: 0.4, haze: 0.8,
      dust: 0.8, fire: 0.3, stars: 0.35,
      rimCol: [1.0, 0.72, 0.58],   // last pink-orange sunlight
      shadeCol: [0.5, 0.43, 0.5],  // purplish shade
      farCol: [0.42, 0.38, 0.47],
      light: [255, 176, 148], shadow: [30, 20, 45],
      paper: '#4d4762', line: '#665f7a', lineSoft: '#5a5370',
    },
    night: {
      shade: 1, grassRim: 0.3, bloom: 0.9, mist: 0, glow: 0.5, rays: 0, vignette: 0.55, haze: 0.35,
      dust: 0.5,       // specks in the moonlight
      fire: 1,         // fireflies
      stars: 1,        // starry sky
      rimCol: [0.74, 0.85, 1.0],   // moonlit rims (silver-blue)
      shadeCol: [0.3, 0.37, 0.52], // grass darkens towards blue
      farCol: [0.12, 0.15, 0.23],  // far side melts into the night
      light: [196, 214, 255], shadow: [4, 8, 20],
      paper: '#111726', line: '#2b3446', lineSoft: '#212939',
    },
  };
  // text and buttons: switch to light all at once when the background is dark enough
  const INK = {
    light: { ink: '#22251e', ink2: '#4c5243', ink3: '#6a7060', primary: '#141410', primaryHover: '#31322d', onPrimary: '#f9f8f3', red: '#b8431f' },
    dark: { ink: '#ece8dd', ink2: '#c4c6bd', ink3: '#959ba0', primary: '#ece8dd', primaryHover: '#ffffff', onPrimary: '#141a26', red: '#e0693f' },
  };

  /* ---------- shapes of the glow, vignette, motes and fireflies (positions are × window width / height) ---------- */
  const TUNE = {
    sun: { x: 0.86, y: -0.12 },   // where the sun (moon) is; negative = above the top edge
    // glow radius × the screen's SHORTER side: desktop = × height; portrait phones use width so the screen isn't washed out
    glow: { radius: 1.15, strength: 0.72, haze: 0.1 },
    shadow: { strength: 0.32 },   // vignette: the corner furthest from the sun darkens
    rays: {
      count: 4, from: 1.95, to: 2.55, width: [0.025, 0.09], strength: [0.05, 0.12],
      length: 1.5, breathe: [0.12, 0.35], swing: 0.025, res: 0.25,
    },
    dust: { count: 46, size: [0.6, 2.2], speed: [4, 14], alpha: 0.75 },
    fire: {
      count: 16,                      // how many fireflies
      area: [0.18, 0.82, 0.58, 0.9],  // where they fly (left, right, top, bottom): over the field
      size: [1.6, 3],                 // px at 1080 high
      color: [214, 255, 150],
    },
  };

  /* ---------- blending ---------- */
  const mixN = (a, b, t) => a + (b - a) * t;
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const toHex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const mixHex = (a, b, t) => toHex(hex(a).map((v, i) => mixN(v, hex(b)[i], t)));
  const lum = (h) => { const [r, g, b] = hex(h).map((v) => { v /= 255; return v <= 0.04 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  function blend(a, b, t) {
    const out = {};
    for (const k in a) {
      const x = a[k], y = b[k];
      out[k] = typeof x === 'number' ? mixN(x, y, t) : typeof x === 'string' ? mixHex(x, y, t) : x.map((v, i) => mixN(v, y[i], t));
    }
    return out;
  }
  function stateAt(hours) {
    const h = ((hours % 24) + 24) % 24;
    for (let i = 0; i < SCHEDULE.length - 1; i++) {
      const [h0, a] = SCHEDULE[i], [h1, b] = SCHEDULE[i + 1];
      if (h >= h0 && h <= h1) {
        let t = h1 > h0 ? (h - h0) / (h1 - h0) : 0;
        t = t * t * (3 - 2 * t);   // ease in and out
        return { ...blend(PRESETS[a], PRESETS[b], t), name: t < 0.5 ? a : b };
      }
    }
    return { ...PRESETS.day, name: 'day' };
  }
  const parseTime = (s) => { const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(s || ''); return m ? +m[1] + (+(m[2] || 0)) / 60 : null; };
  const clock = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; };

  function mount(opts) {
    opts = opts || {};
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const qs = new URLSearchParams(location.search);
    let forced = qs.has('nosun') ? 12 : parseTime(qs.get('time'));
    const hoursNow = () => (forced !== null ? forced : clock());
    const K = window.SUNLIGHT = stateAt(hoursNow());

    /* ---------- page colours ---------- */
    const root = document.documentElement.style;
    let lastCss = '';
    function applyCss() {
      // in daytime remove everything we set, so the page falls back to its own stylesheet
      const vars = {};
      if (K.paper !== PRESETS.day.paper || K.stars > 0.001) {
        const dark = Math.max(0, Math.min(1, (0.2 - lum(K.paper)) / 0.06));
        const inks = blend(INK.light, INK.dark, dark * dark * (3 - 2 * dark));
        Object.assign(vars, {
          '--paper': K.paper, '--line': K.line, '--line-soft': K.lineSoft,
          '--ink': inks.ink, '--ink-2': inks.ink2, '--ink-3': inks.ink3, '--red': inks.red,
          '--primary': inks.primary, '--primary-hover': inks.primaryHover, '--on-primary': inks.onPrimary,
          '--sky-op': (0.32 + 0.58 * K.stars).toFixed(3),
        });
      }
      const css = JSON.stringify(vars);
      if (css === lastCss) return;
      lastCss = css;
      for (const name of ['--paper', '--line', '--line-soft', '--ink', '--ink-2', '--ink-3', '--red', '--primary', '--primary-hover', '--on-primary', '--sky-op']) {
        if (vars[name]) root.setProperty(name, vars[name]); else root.removeProperty(name);
      }
    }

    /* ---------- night sky (stars), faded in over whatever your .sky shows by day ---------- */
    const sky = opts.sky || null;
    let night = null, nx = null;
    if (sky) {
      night = document.createElement('canvas');
      night.className = 'sky__night';
      sky.appendChild(night);
      nx = night.getContext('2d');
    }
    function paintNight() {
      if (!night) return;
      const w = night.clientWidth, h = night.clientHeight, d = Math.min(devicePixelRatio || 1, 2);
      if (!w || !h) return;
      night.width = Math.round(w * d); night.height = Math.round(h * d);
      nx.setTransform(d, 0, 0, d, 0, 0);
      const g = nx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#060a16'); g.addColorStop(0.5, '#141c30'); g.addColorStop(1, '#26304a');
      nx.fillStyle = g; nx.fillRect(0, 0, w, h);
      let seed = 7;
      const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const n = Math.round(w * h / 3800);
      for (let i = 0; i < n; i++) {
        const x = r() * w, y = Math.pow(r(), 1.4) * h * 0.75, big = r() < 0.08;
        const s = big ? 1.1 + r() * 0.9 : 0.4 + r() * 0.6;
        nx.fillStyle = `rgba(${230 + r() * 25},${235 + r() * 20},255,${(big ? 0.75 : 0.35) + r() * 0.25})`;
        nx.beginPath(); nx.arc(x, y, s, 0, Math.PI * 2); nx.fill();
        if (big) {   // brighter stars get a small halo
          const hg = nx.createRadialGradient(x, y, 0, x, y, s * 5);
          hg.addColorStop(0, 'rgba(210,225,255,0.25)'); hg.addColorStop(1, 'rgba(210,225,255,0)');
          nx.fillStyle = hg; nx.fillRect(x - s * 5, y - s * 5, s * 10, s * 10);
        }
      }
    }

    /* ---------- light overlay (above the field, never blocks the mouse) ---------- */
    const wrap = document.createElement('div');
    wrap.className = 'sun';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML = '<canvas class="sun__rays"></canvas><canvas class="sun__dust"></canvas>';
    opts.after ? opts.after.after(wrap) : document.body.appendChild(wrap);
    const raysC = wrap.children[0], dustC = wrap.children[1];
    const rx = raysC.getContext('2d'), dx = dustC.getContext('2d');

    const rand = (a, b) => a + Math.random() * (b - a);
    const rgba = (a, c) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

    let W = 0, H = 0, dpr = 1, k = 1;
    function resize() {
      W = innerWidth; H = innerHeight; dpr = Math.min(devicePixelRatio || 1, 2); k = H / 1080;
      raysC.width = Math.max(1, Math.round(W * TUNE.rays.res)); raysC.height = Math.max(1, Math.round(H * TUNE.rays.res));
      dustC.width = Math.round(W * dpr); dustC.height = Math.round(H * dpr);
      paintNight();
    }
    resize();
    addEventListener('resize', resize);

    const R = TUNE.rays;
    const rays = Array.from({ length: R.count }, (_, i) => ({
      angle: R.from + (R.to - R.from) * (i + rand(0.15, 0.85)) / R.count,
      width: rand(...R.width), strength: rand(...R.strength), speed: rand(...R.breathe), phase: rand(0, Math.PI * 2),
    }));

    const D = TUNE.dust;
    function mote(anywhere) {
      const t = Math.random();
      return {
        x: anywhere ? rand(0, 1) : rand(0.2, 1.05), y: anywhere ? rand(0, 1) : rand(-0.05, 0.6) * t + 0.02,
        size: rand(...D.size), speed: rand(...D.speed),
        dir: rand(2.1, 2.7), wob: rand(0, 6.28), twinkle: rand(0.5, 1.6), life: 0,
      };
    }
    const motes = Array.from({ length: D.count }, () => mote(true));

    const F = TUNE.fire;
    const flies = Array.from({ length: F.count }, () => ({
      x: rand(F.area[0], F.area[1]), y: rand(F.area[2], F.area[3]),
      vx: 0, vy: 0, size: rand(...F.size), blink: rand(0.25, 0.6), phase: rand(0, 6.28), seed: rand(0, 100),
    }));

    function drawLight(time) {
      const w = raysC.width, h = raysC.height;
      const sx = TUNE.sun.x * w, sy = TUNE.sun.y * h;
      rx.setTransform(1, 0, 0, 1, 0, 0);
      rx.globalCompositeOperation = 'source-over';
      rx.clearRect(0, 0, w, h);

      // haze
      rx.fillStyle = rgba(TUNE.glow.haze * K.haze, K.light);
      rx.fillRect(0, 0, w, h);

      // vignette (darkest bottom-left, fading out towards the sun)
      const far = Math.hypot(w, h);
      const dg = rx.createRadialGradient(sx, sy, far * 0.35, sx, sy, far * 1.05);
      dg.addColorStop(0, rgba(0, K.shadow));
      dg.addColorStop(1, rgba(TUNE.shadow.strength * K.vignette, K.shadow));
      rx.fillStyle = dg;
      rx.fillRect(0, 0, w, h);

      // glow
      const r = TUNE.glow.radius * Math.min(w, h), s = TUNE.glow.strength * K.glow;
      const g = rx.createRadialGradient(sx, sy, 0, sx, sy, r);
      g.addColorStop(0, rgba(s, K.light));
      g.addColorStop(0.25, rgba(s * 0.6, K.light));
      g.addColorStop(0.55, rgba(s * 0.22, K.light));
      g.addColorStop(1, rgba(0, K.light));
      rx.fillStyle = g;
      rx.fillRect(0, 0, w, h);

      // light shafts (off in every look by default; set `rays` in a preset to turn them on)
      if (K.rays > 0.001) {
        rx.globalCompositeOperation = 'lighter';
        const len = R.length * far;
        for (const ray of rays) {
          const pulse = (0.55 + 0.45 * Math.sin(time * ray.speed + ray.phase)) * K.rays;
          const a = ray.angle + R.swing * Math.sin(time * ray.speed * 0.6 + ray.phase * 1.7);
          const half = ray.width / 2;
          const lg = rx.createLinearGradient(sx, sy, sx + Math.cos(a) * len, sy + Math.sin(a) * len);
          lg.addColorStop(0, rgba(ray.strength * pulse, K.light));
          lg.addColorStop(0.4, rgba(ray.strength * pulse * 0.7, K.light));
          lg.addColorStop(1, rgba(0, K.light));
          rx.fillStyle = lg;
          rx.beginPath();
          rx.moveTo(sx, sy);
          rx.lineTo(sx + Math.cos(a - half) * len, sy + Math.sin(a - half) * len);
          rx.lineTo(sx + Math.cos(a + half) * len, sy + Math.sin(a + half) * len);
          rx.closePath();
          rx.fill();
        }
      }
    }

    function dot(px, py, rr, a, core, edge) {
      const g = dx.createRadialGradient(px, py, 0, px, py, rr);
      g.addColorStop(0, rgba(a, core));
      g.addColorStop(0.35, rgba(a * 0.5, edge));
      g.addColorStop(1, rgba(0, edge));
      dx.fillStyle = g;
      dx.fillRect(px - rr, py - rr, rr * 2, rr * 2);
    }

    function drawDust(dt, time) {
      dx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dx.clearRect(0, 0, W, H);
      const sx = TUNE.sun.x * W, sy = TUNE.sun.y * H, reach = TUNE.glow.radius * Math.min(W, H) * 1.3;
      const core = K.light.map((v) => Math.min(255, v + 30));
      if (K.dust > 0.001) {
        for (let i = 0; i < motes.length; i++) {
          const m = motes[i];
          m.life += dt;
          m.wob += dt * 0.7;
          const v = m.speed * k;
          m.x += (Math.cos(m.dir) * v + Math.sin(m.wob) * 3 * k) * dt / W;
          m.y += (Math.sin(m.dir) * v * 0.6 + Math.cos(m.wob * 1.3) * 2 * k) * dt / H;
          if (m.x < -0.02 || m.y > 1.02 || m.x > 1.08) { motes[i] = mote(false); continue; }
          const px = m.x * W, py = m.y * H;
          // brighter near the sun, almost invisible outside its light
          const light = Math.max(0, 1 - Math.hypot(px - sx, py - sy) / reach);
          const tw = 0.55 + 0.45 * Math.sin(time * m.twinkle + m.wob * 2);
          const a = D.alpha * light * tw * Math.min(1, m.life / 1.5) * K.dust;
          if (a >= 0.01) dot(px, py, m.size * k * 2.6, Math.min(1, a), core, K.light);
        }
      }
      // fireflies: drifting lazily over the field, blinking
      if (K.fire > 0.001) {
        const S = Math.max(H, 700) / 1080;
        for (const f of flies) {
          const t = time * 0.35 + f.seed;
          f.vx += (Math.sin(t * 1.3) + Math.sin(t * 0.7 + 2)) * 0.004 * dt;
          f.vy += (Math.cos(t * 1.1) + Math.sin(t * 0.5 + 1)) * 0.003 * dt;
          f.vx *= 0.985; f.vy *= 0.985;
          f.x += f.vx * dt * 6; f.y += f.vy * dt * 6;
          // gently pulled back when they wander out of the area
          if (f.x < F.area[0]) f.vx += 0.02 * dt; if (f.x > F.area[1]) f.vx -= 0.02 * dt;
          if (f.y < F.area[2]) f.vy += 0.02 * dt; if (f.y > F.area[3]) f.vy -= 0.02 * dt;
          const on = Math.max(0, Math.sin(time * f.blink * 2 + f.phase));
          const a = Math.pow(on, 3) * K.fire;
          if (a < 0.02) continue;
          const px = f.x * W, py = f.y * H, rr = f.size * S * 5;
          dot(px, py, rr, a, [255, 255, 220], F.color);
        }
      }
    }

    /* ---------- every frame ---------- */
    function update() {
      Object.assign(K, stateAt(hoursNow()));
      applyCss();
      if (night) night.style.opacity = K.stars.toFixed(3);
    }
    let last = performance.now(), time = 0;
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now; time += dt;
      update();
      drawLight(time);
      drawDust(dt, time);
      requestAnimationFrame(frame);
    }
    const still = () => { update(); drawLight(0); dx.clearRect(0, 0, dustC.width, dustC.height); };
    if (reduce) {
      // reduced motion: light and colours still follow the clock, but nothing drifts or blinks; refresh every 30 s
      still(); setInterval(still, 30000);
    } else requestAnimationFrame(frame);

    return {
      /** Pin the clock to `h` hours (0–24, fractions allowed), or pass null to follow the real clock again. */
      setHours(h) { forced = h === null || h === undefined ? null : h; if (reduce) still(); },
      /** The hour currently shown (0–24). */
      get hours() { return ((hoursNow() % 24) + 24) % 24; },
      /** true while following the visitor's real clock. */
      get live() { return forced === null; },
      /** The blended values for this frame (same object as window.SUNLIGHT); `.name` = 'day' | 'dusk' | 'twilight' | 'night'. */
      state: K,
    };
  }

  window.Sunlight = { mount, stateAt, SCHEDULE, PRESETS };
})();
