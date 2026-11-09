/* grass-oclock demo: wires the four pieces together, plus a time slider, "Now" and "Play a day". */
(function () {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s) => document.querySelector(s);

  // 1. sky, 2. field, 3. light (needs the field's container to put its overlay right after it), 4. drifting grass
  Sky.paint($('.sky canvas'));
  const field = Field.mount($('.stage canvas'), { seed: 7 });
  const sun = Sunlight.mount({ sky: $('.sky'), after: $('.stage') });
  Drift.mount();
  if (field) setTimeout(() => field.grow(), reduce ? 0 : 150);
  window.grassDemo = { field, sun };   // handy for poking at it from the console

  /* ---------- clock text ---------- */
  const NAMES = { day: 'Daylight', dusk: 'Golden hour', twilight: 'Twilight', night: 'Night' };
  const clockEl = $('.hero__clock'), lineEl = $('.hero__line');
  const range = $('.dial__range'), nowBtn = $('.dial__now'), playBtn = $('.dial__play');
  const fmt = (h) => { const m = Math.floor(h * 60 + 1e-6) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  let lastText = '';
  function render() {
    const h = sun.hours, name = NAMES[sun.state.name] || '';
    const text = fmt(h) + '|' + name + '|' + sun.live;
    if (text !== lastText) {
      lastText = text;
      clockEl.textContent = fmt(h);
      lineEl.innerHTML = sun.live
        ? `<em>${name}</em> where you are. The grass keeps your local time.`
        : `<em>${name}</em>, somewhere in the world.`;
      nowBtn.classList.toggle('is-live', sun.live);
      if (document.activeElement !== range) range.value = Math.floor(h * 60 + 1e-6) % 1440;
    }
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  /* ---------- slider, Now, Play a day ---------- */
  let playing = 0;
  function stopPlay() { if (!playing) return; cancelAnimationFrame(playing); playing = 0; playBtn.setAttribute('aria-pressed', 'false'); playBtn.textContent = 'Play a day'; }
  range.addEventListener('input', () => { stopPlay(); sun.setHours(+range.value / 60); });
  nowBtn.addEventListener('click', () => { stopPlay(); sun.setHours(null); });
  playBtn.addEventListener('click', () => {
    if (playing) { stopPlay(); return; }
    // one full day in 24 seconds, starting from whatever is shown, then back to the real clock
    const start = sun.hours, t0 = performance.now(), DUR = 24000;
    playBtn.setAttribute('aria-pressed', 'true'); playBtn.textContent = 'Pause';
    (function step(now) {
      const t = (now - t0) / DUR;
      if (t >= 1) { stopPlay(); sun.setHours(null); return; }
      sun.setHours((start + t * 24) % 24);
      playing = requestAnimationFrame(step);
    })(t0);
  });

  /* ---------- drag anywhere to turn the field; cursor brushes the grass ---------- */
  if (!field) return;
  const STEPS_PER_WIDTH = 10;   // dragging across the whole window turns the field this many steps (24 = full turn)
  let drag = null;
  const isUI = (el) => el.closest('a, button, input, .dial');
  addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || isUI(e.target)) return;
    drag = { x: e.clientX, angle: field.angle, id: e.pointerId };
    document.body.classList.add('is-dragging');
  });
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') field.setPointer(e.clientX, e.clientY);
    if (drag && e.pointerId === drag.id) field.setAngle(drag.angle - (e.clientX - drag.x) / innerWidth * STEPS_PER_WIDTH);
  });
  const end = (e) => { if (drag && e.pointerId === drag.id) { drag = null; document.body.classList.remove('is-dragging'); } };
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);
  document.documentElement.addEventListener('pointerleave', () => field.setPointer(null));
  addEventListener('keydown', (e) => {
    if (e.target === range) return;
    if (e.key === 'ArrowLeft') field.setAngle(field.angle + 1);
    if (e.key === 'ArrowRight') field.setAngle(field.angle - 1);
  });
})();
