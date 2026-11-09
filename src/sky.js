/* grass-oclock · sky.js
   A soft daytime sky with painted clouds, drawn once into a small canvas and stretched behind the field.
   sunlight.js fades a starry night canvas in on top of it after dark.

   Usage: Sky.paint(document.querySelector('.sky canvas'));
*/
(function () {
  'use strict';

  function paint(c) {
    const W = 640, H = 360;
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#aebdc8'); g.addColorStop(0.45, '#e4e3dc'); g.addColorStop(1, '#f4e6d2');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    let seed = 11;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // [centre x, centre y, size] — each cloud is a pile of soft radial puffs
    const clouds = [[150, 140, 1.2], [470, 90, 0.9], [560, 210, 0.7], [70, 250, 0.8], [330, 230, 0.6], [250, 60, 0.5]];
    for (const [cx, cy, s] of clouds) {
      for (let i = 0; i < 26; i++) {
        const px = cx + (r() - 0.5) * 150 * s, py = cy + (r() - 0.6) * 40 * s;
        const rad = (18 + r() * 34) * s;
        const rg = x.createRadialGradient(px, py - rad * 0.3, 0, px, py, rad);
        rg.addColorStop(0, 'rgba(255,255,255,0.75)');
        rg.addColorStop(0.6, 'rgba(250,246,238,0.35)');
        rg.addColorStop(1, 'rgba(240,232,220,0)');
        x.fillStyle = rg; x.beginPath(); x.arc(px, py, rad, 0, Math.PI * 2); x.fill();
      }
    }
  }

  window.Sky = { paint };
})();
