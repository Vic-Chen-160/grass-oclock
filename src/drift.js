/* grass-oclock · drift.js
   One or two loose grass blades and now and then a single petal, blown from the top-left to the bottom-right
   with gusts, sway and flips. Drawn on its own full-screen canvas (.drift) that never blocks the mouse.
   Same shapes and colours as field.js: round-tipped blades in the olive family, sometimes straw or rust, no outline;
   petals use the field's flower colours.

   Usage: Drift.mount();   (does nothing when the visitor prefers reduced motion)

   All numbers are in TUNE and get multiplied by two "rulers":
   - S (size, falling speed)        = window height, but at least 700, so a short landscape phone still shows them
   - R (wind to the right, sway)    = S, but at most width × 0.5625 (16:9), so a narrow portrait phone gets the same
                                      diagonal drift as a desktop instead of blowing straight out the right side */
(function () {
  'use strict';

  const TUNE = {
    grass: {
      max: 2,                  // at most this many blades on screen
      gap: [2.2, 5],           // seconds between new blades (random); refills quickly when there are none
      length: [0.035, 0.06],   // × S
      width: [0.0045, 0.0065], // × S
      fall: [0.06, 0.095],     // falling speed (× S per second)
      wind: [0.17, 0.25],      // speed to the right (× R per second); its ratio to `fall` sets the angle
      spin: [1.8, 3.4],        // flipping speed (radians per second)
      rock: [0.3, 0.7],        // pendulum swing (radians)
    },
    petal: {
      max: 1,
      gap: [4, 9],
      length: [0.011, 0.015],
      width: [0.0075, 0.01],
      fall: [0.045, 0.07],     // lighter than grass: falls slower, flips faster
      wind: [0.16, 0.23],
      spin: [3, 5],
      rock: [0.6, 1.1],
    },
    gust: 0.7,                 // gust strength (0 = steady wind)
    sway: 0.03,                // side-to-side drift (× R)
  };

  // grass: field.js BASE / PALE / DEEP / COOL / DRY / WARM / RED; petals: pink, yellow, lavender (white is invisible on cream)
  // the number after each colour is its weight
  const COLORS = {
    grass: [['#8b9c65', 30], ['#aab877', 24], ['#687954', 14], ['#94a283', 10], ['#bdb894', 12], ['#db7040', 5], ['#d2543a', 5]],
    petal: [['#f2c4cf', 50], ['#f6e3a1', 28], ['#b9c3ef', 22]],
  };

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => {
    let n = Math.random() * list.reduce((s, c) => s + c[1], 0);
    for (const c of list) if ((n -= c[1]) < 0) return c[0];
    return list[0][0];
  };
  const shade = (hex, k) => {
    const v = [1, 3, 5].map((i) => Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k)));
    return `rgb(${v[0]},${v[1]},${v[2]})`;
  };

  function mount() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = document.createElement('canvas');
    canvas.className = 'drift';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, S = 0, R = 0, dpr = 1;
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      S = Math.max(H, 700); R = Math.min(S, W * 0.5625);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    resize();
    addEventListener('resize', resize);

    function spawn(kind, first) {
      const T = TUNE[kind];
      const len = rand(...T.length) * S;
      // enter from off-screen, left or top (the top-left area)
      let x, y;
      if (Math.random() < 0.6) { x = -len; y = rand(-0.1, 0.55) * H; }
      else { x = rand(-0.05, 0.4) * W; y = -len; }
      // the very first one starts on screen, so nobody waits for it
      if (first) { x = rand(0.05, 0.3) * W; y = rand(0.02, 0.18) * H; }
      return {
        kind, x, y, len,
        w: rand(...T.width) * S,
        fall: rand(...T.fall), wind: rand(...T.wind),
        angle: rand(0, Math.PI * 2),
        turn: rand(-0.5, 0.5),
        rock: rand(...T.rock), rockSpeed: rand(0.9, 1.6), rockPhase: rand(0, 6.28),
        twist: rand(0, 6.28), spin: rand(...T.spin) * (Math.random() < 0.5 ? -1 : 1),
        bend: rand(0.12, 0.32) * (Math.random() < 0.5 ? -1 : 1),
        bendPhase: rand(0, 6.28),
        swayPhase: rand(0, 6.28), swaySpeed: rand(0.7, 1.3),
        shape: rand(2.2, 3.6),                    // how the tip narrows (same as field.js)
        color: pick(COLORS[kind]),
      };
    }

    // blade: outline both sides of a bent centre line with the leaf-shape width; round tip
    function grassPath(b, t, wk) {
      const L = b.len;
      const bend = b.bend * (0.75 + 0.25 * Math.sin(t * 2.1 + b.bendPhase)) * L;
      const N = 18, left = [], right = [];
      const outer = 0.5 - 0.14 * Math.min(1, Math.max(0, (b.shape - 2) / 2.6));
      for (let i = 0; i <= N; i++) {
        const s = i / N;
        const px = (s - 0.5) * L, py = bend * (s * s - 0.33);
        const dx = L, dy = bend * 2 * s;
        const dl = Math.hypot(dx, dy);
        const nx = -dy / dl, ny = dx / dl;
        const half = 0.5 * b.w * wk * Math.pow(Math.max(0, 1 - Math.pow(s, b.shape)), outer) * (i === 0 ? 0.85 : 1);
        left.push([px + nx * half, py + ny * half]);
        right.push([px - nx * half, py - ny * half]);
      }
      ctx.beginPath();
      ctx.moveTo(left[0][0], left[0][1]);
      for (let i = 1; i <= N; i++) ctx.lineTo(left[i][0], left[i][1]);
      for (let i = N; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
      ctx.closePath();
    }

    // petal: a teardrop, narrow at the base, round at the front
    function petalPath(b, wk) {
      const L = b.len, w = 0.5 * b.w * wk;
      ctx.beginPath();
      ctx.moveTo(-L / 2, 0);
      ctx.bezierCurveTo(-L * 0.2, -w * 1.15, L / 2, -w * 1.1, L / 2, 0);
      ctx.bezierCurveTo(L / 2, w * 1.1, -L * 0.2, w * 1.15, -L / 2, 0);
      ctx.closePath();
    }

    function draw(b, t) {
      const L = b.len;
      const flip = Math.cos(b.twist);                  // flipping: width goes between face-on and edge-on
      const wk = 0.12 + 0.88 * Math.abs(flip);
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle + b.rock * Math.sin(t * b.rockSpeed + b.rockPhase));
      if (b.kind === 'grass') grassPath(b, t, wk); else petalPath(b, wk);
      // darker at the root, lighter at the tip (like the field's root shadow); a bit darker when showing its back
      const back = flip < 0 ? 0.9 : 1;
      const g = ctx.createLinearGradient(-L / 2, 0, L / 2, 0);
      if (b.kind === 'grass') {
        g.addColorStop(0, shade(b.color, 0.78 * back));
        g.addColorStop(0.55, shade(b.color, 1.0 * back));
        g.addColorStop(1, shade(b.color, 1.06 * back));
      } else {
        g.addColorStop(0, shade(b.color, 0.8 * back));
        g.addColorStop(0.6, shade(b.color, 0.97 * back));
        g.addColorStop(1, shade(b.color, 1.02 * back));
      }
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
    }

    const items = [spawn('grass', true)];
    const next = { grass: rand(...TUNE.grass.gap), petal: rand(2, 5) };
    let last = performance.now(), time = 0;

    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000);  // coming back from another tab doesn't jump far
      last = now; time += dt;

      // gusts: everything is blown together, stronger and weaker
      const gust = 1 + TUNE.gust * (0.6 * Math.sin(time * 0.5) + 0.4 * Math.sin(time * 1.2 + 1.3));

      for (const kind of ['grass', 'petal']) {
        const count = items.filter((b) => b.kind === kind).length;
        next[kind] -= dt;
        if (kind === 'grass' && count === 0) next.grass = Math.min(next.grass, 0.6);
        if (next[kind] <= 0) {
          if (count < TUNE[kind].max) items.push(spawn(kind, false));
          next[kind] = rand(...TUNE[kind].gap);
        }
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      for (let i = items.length - 1; i >= 0; i--) {
        const b = items[i];
        const sway = Math.cos(time * b.swaySpeed + b.swayPhase) * TUNE.sway * R * b.swaySpeed;
        b.x += (b.wind * R * gust + sway * 0.6) * dt;
        b.y += (b.fall * S + sway * 0.35 + Math.sin(b.twist) * 0.012 * S) * dt;
        b.angle += b.turn * gust * dt;
        b.twist += b.spin * (0.7 + 0.3 * gust) * dt;
        if (b.x - b.len > W || b.y - b.len > H) { items.splice(i, 1); continue; }
        draw(b, time);
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  window.Drift = { mount };
})();
