/* grass-oclock · field.js
   A painted-looking patch of grass in WebGL2. No libraries.

   How it looks the way it does:
   - Orthographic camera (no perspective), so it reads like a flat illustration.
   - Round-tipped blades that always face the camera.
   - Every blade takes its colour from a "ground colour map" at its root, so neighbours share a colour
     and the field breaks into painterly patches instead of noise.
   - A soft shadow at the root, and ~1% of blades get a dark outline.
   - Lighting comes from window.SUNLIGHT (written by sunlight.js every frame). Without sunlight.js the field is plain daylight.

   Usage:
     const field = Field.mount(canvas, { seed: 7 });
     field.grow();                     // grow from the centre outwards
     field.setAngle(3);                // turn the field (in steps; one full turn = options.steps)
     field.setPointer(x, y);           // brush the grass with the cursor (px from the canvas' top-left), null = left
*/
(function () {
  'use strict';

  /* ---------- helpers ---------- */
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (t) => t * t * (3 - 2 * t);
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const FLOWERS = ['#f4f1e6', '#f4f1e6', '#f4f1e6', '#b9c3ef', '#f2c4cf', '#f6e3a1'].map(hex);

  /* ---------- matrices ---------- */
  function ortho(l, r, b, t, n, f) {
    return [2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1];
  }
  function lookAt(e, c, u) {
    let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
    let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    let xx = u[1] * zz - u[2] * zy, xy = u[2] * zx - u[0] * zz, xz = u[0] * zy - u[1] * zx;
    l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1];
  }
  function mul(a, b) {
    const o = new Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s;
    }
    return o;
  }

  /* ---------- shaders ---------- */
  const HEAD = `#version 300 es
precision highp float;
`;
  // Light source sits top-right, behind the field (the sun at dusk, the moon at night).
  // Blades get darker (SHADE) and their sun-facing edges light up (SUN). Strengths and colours come from window.SUNLIGHT.
  const SUN = `
uniform float uShadeK, uGrassRimK;   // strengths: darken, rim light on blades
uniform vec3 uRimCol, uShadeCol;     // rim colour, shade colour
#define SUN uRimCol
#define SHADE uShadeCol
`;
  // Ground colour map: big soft patches of olive, pale green and deep green, plus cool grey-green and rust red.
  const FIELD = `
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ return 0.5*vnoise(p) + 0.3*vnoise(p*2.03+17.0) + 0.2*vnoise(p*4.01+31.0); }
float terrain(vec2 p){ float d = length(p); return 0.03*(fbm(p*1.6+5.0)-0.45) + 0.03*max(0., 1.-d*d); }
const vec3 BASE = vec3(0.546, 0.613, 0.396);   // yellowish olive
const vec3 PALE = vec3(0.666, 0.721, 0.466);
const vec3 DEEP = vec3(0.408, 0.475, 0.328);
const vec3 WARM = vec3(0.861, 0.441, 0.252);   // muted orange-rust
const vec3 COOL = vec3(0.582, 0.636, 0.515);
const vec3 DRY  = vec3(0.740, 0.720, 0.580);
const vec3 RED  = vec3(0.823, 0.330, 0.228);   // the odd vermilion clump
vec3 fieldColor(vec2 p, float d){
  // very wide gradients between patches: no hard borders
  float n = fbm(p*0.9 + 3.0);
  float m = fbm(p*1.6 - 7.0);
  float w = fbm(p*2.6 + 11.0);
  vec3 c = mix(DEEP, BASE, smoothstep(0.25, 0.55, n));
  c = mix(c, PALE, smoothstep(0.48, 0.78, n) * 0.85);
  c = mix(c, COOL, smoothstep(0.45, 0.8, m) * 0.35);
  c = mix(c, DRY, smoothstep(0.75, 1.05, d) * 0.3);
  float s = fbm(p*4.2 - 23.0);
  c = mix(c, DEEP*0.95, smoothstep(0.5, 0.78, s) * 0.45);
  // rust patches (painted on the map, so neighbouring blades share them like a brush stroke)
  vec3 rust = mix(WARM, RED, vnoise(p*3.0 + 9.0));
  c = mix(c, rust, smoothstep(0.62, 0.75, w) * 0.75);
  c = mix(c, RED, smoothstep(0.7, 0.8, fbm(p*5.5 + 40.0)) * 0.7);
  return c;
}
`;
  const COMMON_VS = FIELD + `
layout(location=0) in vec2 aSeg;
layout(location=1) in vec4 aPos;
layout(location=2) in vec4 aShape;
layout(location=3) in vec4 aCol;
uniform mat4 uVP; uniform float uTime, uGrow, uWind; uniform vec2 uShift;
uniform vec3 uRight, uUp;
uniform vec4 uBalls[9];
uniform vec3 uFarCol;   // colour the far side of the field fades into (beige by day, navy at night)
float growth(float d){ float g = clamp((uGrow - d*0.8)/0.4, 0., 1.); return g*g*(3.-2.*g); }
vec4 project(vec3 p){ vec4 c = uVP*vec4(p,1.); c.xy += uShift*c.w; return c; }
`;

  // Blades. aPos(x, z, distance from centre, phase) aShape(height, width, lean direction, lean amount)
  // aCol(colour jitter, outline 1 / redness as a negative value, tone, roundness)
  const BLADE_VS = HEAD + COMMON_VS + `
uniform float uRootShade;
out vec3 vCol; out float vSide, vT, vOutline, vWisp, vLayer; out vec2 vNdc;
void main(){
  float g = growth(aPos.z);
  float t = aSeg.y;
  vec3 base = vec3(aPos.x, terrain(aPos.xy), aPos.y);
  float h = aShape.x * g;

  // wind: the whole field moves as one, plus a fine flutter
  float wave = fbm(base.xz*0.9 - vec2(0.8, 0.6)*uTime*0.95)*2.0 - 1.0;
  float flutter = sin(uTime*5.2 + aPos.w*2.1) * 0.09;
  float force = uWind*(0.42 + 0.85*wave) + flutter*uWind;
  vec2 push = vec2(cos(aShape.z), sin(aShape.z))*aShape.w + vec2(0.8, 0.6)*force;
  // the cursor (and its fading trail) pushes blades outwards and presses them down
  float squash = 0.0;
  for (int i = 0; i < 9; i++) {
    vec4 b = uBalls[i];
    if (b.w <= 0.0) continue;
    vec2 d = base.xz - b.xy;
    float len = length(d);
    float k = (1.0 - smoothstep(b.z*0.5, b.z*2.1, len)) * b.w;
    push += d / max(len, 0.001) * k * 2.4;
    squash = max(squash, k);
  }
  float pl = length(push); if (pl > 1.4) push *= 1.4/pl;
  h *= 1.0 - 0.6*clamp(squash, 0., 1.);

  vec3 p = base;
  p.xz += push * (t*t) * h;
  p.y += h * t * (1.0 - 0.35*min(1.0, dot(push, push))*t);

  // round-tipped leaf: almost the same width all the way, narrowing only near the top
  float shape = aCol.w;
  float outer = mix(0.5, 0.36, clamp((shape - 2.0)/2.6, 0., 1.));
  float w = aShape.y * pow(max(0., 1.0 - pow(t, shape)), outer) * (0.4 + 0.6*g);
  p += uRight * aSeg.x * w * 0.5;
  gl_Position = project(p);
  vNdc = gl_Position.xy / gl_Position.w;

  vec3 col = fieldColor(base.xz, aPos.z) * (0.96 + 0.08*aCol.x);
  // per-clump tone (aCol.z: -1 deep, +1 pale, 2 straw) so dark clumps alternate with green ones
  float tone = aCol.z;
  if (tone > 1.5) col = mix(col, DRY*0.95, 0.6);
  else {
    col = mix(col, DEEP*0.9, max(0., -tone) * 0.45);
    col = mix(col, PALE, max(0., tone) * 0.2);
  }
  float red = max(0., -aCol.y);
  col = mix(col, mix(RED, WARM, aCol.x*0.6), red);
  // short blades (bottom layer) darker and cooler, tall ones brighter and warmer
  float layer = smoothstep(0.02, 0.16, aShape.x);
  col *= mix(vec3(0.9, 0.92, 0.92), vec3(1.05, 1.04, 0.99), layer);
  // long soft root shadow
  col *= mix(1.0 - uRootShade, 1.0, smoothstep(0.0, 0.9, t));
  col += vec3(0.04, 0.04, 0.02) * t * layer;
  // the further back, the paler (a bit of air)
  vec2 fwd = vec2(uRight.z, -uRight.x);
  float far = smoothstep(-0.8, 1.1, dot(base.xz, fwd));
  col = mix(col, uFarCol, far * 0.22);
  // thin wisps fade into the background towards the tip, so they don't look like drawn lines
  if (aCol.w < 1.17) col = mix(col, uFarCol * 1.05, t * 0.35);
  vCol = col; vSide = aSeg.x; vT = t; vOutline = step(0.5, aCol.y);
  vWisp = step(aCol.w, 1.17); vLayer = layer;
}`;
  const BLADE_FS = HEAD + SUN + `
in vec3 vCol; in float vSide, vT, vOutline, vWisp, vLayer; in vec2 vNdc; out vec4 o;
void main(){
  vec3 c = vCol;
  if (vOutline > 0.5 && (abs(vSide) > 0.7 || vT > 0.95)) c = vec3(0.16, 0.2, 0.15);
  // backlight: the blade darkens; the closer to the light (top-right of the screen), the brighter its edge
  float toward = clamp(0.55 + 0.45*vNdc.x + 0.35*vNdc.y, 0., 1.);
  c *= mix(vec3(1.), SHADE, uShadeK);
  float rim = smoothstep(0.3, 0.9, vSide) * 1.1     // right edge (facing the light)
            + smoothstep(0.7, 1.0, vT) * 0.9;        // light through the tip
  rim *= smoothstep(0.15, 0.6, vT) * mix(0.55, 1.0, vLayer) * (0.25 + 0.75*toward);
  // thin wisps glow along their whole length, like a cat's whiskers against the sun
  rim = max(rim, vWisp * smoothstep(0.1, 0.8, vT) * (0.5 + 0.5*toward));
  c = mix(c, SUN * 1.4, clamp(rim, 0., 1.) * 0.95 * uGrassRimK);
  o = vec4(c, 1.);
}`;

  // Ground under the grass, same colour map: brushing the grass aside reveals matching soil, not the page.
  const GROUND_VS = HEAD + COMMON_VS + `
out vec2 vXZ; out float vD, vFar;
void main(){
  vXZ = aSeg; vD = aPos.x;
  gl_Position = project(vec3(aSeg.x, terrain(aSeg) - 0.002, aSeg.y));
  vec2 fwd = vec2(uRight.z, -uRight.x);
  vFar = smoothstep(-0.8, 1.1, dot(aSeg, fwd));
}`;
  const GROUND_FS = HEAD + FIELD + SUN + `
uniform float uGrow, uRootShade; uniform vec3 uFarCol;
in vec2 vXZ; in float vD, vFar; out vec4 o;
void main(){
  // ragged edge tucked inside the outer dabs; grows out from the centre with the grass
  if (vD + (fbm(vXZ*7.0) - 0.5)*0.12 > 0.84) discard;
  if (clamp((uGrow - vD*0.8)/0.4, 0., 1.) < 0.35) discard;
  vec3 c = fieldColor(vXZ, vD) * (1.0 - uRootShade*0.7);
  c = mix(c, uFarCol, vFar * 0.22);
  c *= mix(vec3(1.), SHADE, uShadeK);
  o = vec4(c, 1.);
}`;

  // Ground dabs around the edge. aPos(x, z, distance, rotation) aShape(size, aspect, seed, -) aCol(jitter, red, -, -)
  const DAB_VS = HEAD + COMMON_VS + `
out vec2 vUv; out float vSeed; out vec3 vCol;
void main(){
  float g = growth(aPos.z);
  vec2 c = aSeg * vec2(aShape.x*aShape.y, aShape.x) * g;
  float cr = cos(aPos.w), sr = sin(aPos.w);
  vec2 r = vec2(c.x*cr - c.y*sr, c.x*sr + c.y*cr);
  vec2 xz = aPos.xy + r;
  gl_Position = project(vec3(xz.x, terrain(aPos.xy) + 0.001, xz.y));
  vUv = aSeg; vSeed = aShape.z;
  vCol = fieldColor(aPos.xy, aPos.z) * (0.8 + 0.12*aCol.x);
  vCol = mix(vCol, RED*0.92, aCol.y);
}`;
  const DAB_FS = HEAD + SUN + `
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
in vec2 vUv; in float vSeed; in vec3 vCol; out vec4 o;
void main(){
  float n = vnoise(vUv*2.6 + vSeed*17.0)*0.62 + vnoise(vUv*7.0 + vSeed*5.0)*0.38;
  if (length(vUv) + (n-0.5)*0.9 > 0.75) discard;
  o = vec4(vCol * mix(vec3(1.), SHADE, uShadeK), 1.);
}`;

  // Small flowers. aPos(x, z, distance, phase) aShape(size, height, -, petal count) aCol(rgb, centre)
  const FLOWER_VS = HEAD + COMMON_VS + `
out vec2 vUv; out vec3 vCol; out float vPetals; out float vCenter;
void main(){
  float g = growth(aPos.z);
  float sway = sin(uTime*2.2 + aPos.x*1.6 + aPos.y*1.2 + aPos.w) * uWind * aShape.y * 0.8;
  vec3 c = vec3(aPos.x + 0.8*sway, terrain(aPos.xy) + aShape.y*g, aPos.y + 0.6*sway);
  float s = aShape.x * g;
  gl_Position = project(c + uRight*aSeg.x*s + uUp*aSeg.y*s*0.85);
  vUv = aSeg; vCol = aCol.rgb; vPetals = aShape.w; vCenter = aCol.w;
}`;
  const FLOWER_FS = HEAD + SUN + `
in vec2 vUv; in vec3 vCol; in float vPetals; in float vCenter; out vec4 o;
void main(){
  float r = length(vUv); float a = atan(vUv.y, vUv.x);
  float petal = 0.5 + 0.5*pow(abs(cos(a*vPetals*0.5)), 0.6);
  if (r > petal*0.95) discard;
  vec3 c = r < 0.26 ? (vCenter > 0.5 ? vec3(0.93,0.72,0.25) : vec3(0.88,0.80,0.45)) : vCol;
  c *= mix(vec3(1.), SHADE, uShadeK * 0.7);
  o = vec4(c, 1.);
}`;

  // ---------- glow (post-processing) ----------
  // The scene is drawn off-screen, then: 1) the brightest parts (rims, tips) are blurred into a glow,
  // 2) optionally the whole frame is blurred into a soft mist, 3) both are added back. Like a black-mist camera filter.
  // Only runs when window.SUNLIGHT asks for bloom/mist, so daytime costs nothing extra.
  const GLOW = {
    threshold: 0.58,   // how bright a pixel must be to glow (0–1)
    bloom: 2.2,        // glow strength
    mist: 0.42,        // soft-focus mist strength (0 = none)
    spread: 1.6,       // how far the glow spreads
  };
  const POST_VS = HEAD + `
layout(location=0) in vec2 aSeg; out vec2 vUv;
void main(){ vUv = aSeg*0.5 + 0.5; gl_Position = vec4(aSeg, 0., 1.); }`;
  // downsample to 1/4 (averaging 4×4); with uThresh > 0 keep only the bright parts
  const PRE_FS = HEAD + `
in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform vec2 uTexel; uniform float uThresh;
void main(){
  vec4 c = 0.25*(texture(uTex, vUv + uTexel*vec2(-1.,-1.)) + texture(uTex, vUv + uTexel*vec2(1.,-1.))
               + texture(uTex, vUv + uTexel*vec2(-1.,1.)) + texture(uTex, vUv + uTexel*vec2(1.,1.)));
  if (uThresh > 0.0) {
    vec3 col = c.rgb / max(c.a, 1e-3);
    float lum = dot(col, vec3(0.3, 0.59, 0.11));
    c *= smoothstep(uThresh, uThresh + 0.22, lum);
  }
  o = c;
}`;
  const BLUR_FS = HEAD + `
in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform vec2 uDir;
void main(){
  vec4 c = texture(uTex, vUv) * 0.2270;
  c += (texture(uTex, vUv + uDir*1.3846) + texture(uTex, vUv - uDir*1.3846)) * 0.3162;
  c += (texture(uTex, vUv + uDir*3.2308) + texture(uTex, vUv - uDir*3.2308)) * 0.0703;
  o = c;
}`;
  const COMP_FS = HEAD + `
in vec2 vUv; out vec4 o;
uniform sampler2D uScene, uBloom, uMist; uniform float uBloomK, uMistK; uniform vec3 uGlowCol;
void main(){
  vec4 s = texture(uScene, vUv), b = texture(uBloom, vUv), m = texture(uMist, vUv);
  vec4 c = s + max(m - s, vec4(0.)) * uMistK;   // soft focus: "lighten" with the blurred copy
  vec3 add = b.rgb * uGlowCol * uBloomK;         // warm glow on the bright parts
  c.rgb += add;
  c.a = clamp(c.a + dot(add, vec3(0.3, 0.59, 0.11)), 0., 1.);
  c.rgb = min(c.rgb, vec3(c.a));
  o = c;
}`;

  function compile(gl, vs, fs) {
    const p = gl.createProgram();
    [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]].forEach(([type, src]) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
      gl.attachShader(p, s);
    });
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
    return { p, u };
  }

  /* ---------- planting ---------- */
  // outline of the patch: a wobbly circle with a couple of lobes
  function edgeR(a) {
    const lobes = 0.2 * Math.pow(Math.max(0, Math.cos(2 * a + 0.35)), 14) + 0.12 * Math.pow(Math.max(0, Math.cos(3 * a - 1.1)), 10);
    return 1 + 0.12 * Math.sin(3 * a + 1.3) + 0.08 * Math.sin(5 * a + 0.4) + 0.05 * Math.sin(8 * a + 2.0) + 0.035 * Math.sin(13 * a + 0.7) + lobes;
  }
  // where clumps are darker or paler: in patches, not random per clump
  const patchy = (x, z) => clamp(0.5 + 0.3 * Math.sin(x * 7.3 + 0.4) * Math.cos(z * 6.1 + 1.9) + 0.2 * Math.sin(x * 11.7 - z * 9.4 + 2.6), 0, 1);
  // low-frequency bumps: where tall clumps grow and where it dips
  const lumpy = (x, z) => clamp(0.5 + 0.28 * Math.sin(x * 3.1 + 1.7) * Math.cos(z * 2.7 - 0.6) + 0.22 * Math.sin(x * 6.3 - z * 5.1 + 2.1), 0, 1);

  function buildField(seed, o) {
    const r = rng(seed);
    const blades = [], dabs = [], flowers = [];
    const sample = (maxD) => {
      const a = r() * Math.PI * 2;
      const e = edgeR(a);
      const d = Math.sqrt(r()) * maxD;
      return { x: Math.cos(a) * e * d, z: Math.sin(a) * e * d, d };
    };
    // short blades can't be too wide (they'd look like lettuce); outlines only on tall enough ones
    // tone: -1 deep … +1 pale, 2 straw; red: 0–1 (red blades get no outline)
    const blade = (x, z, d, h, w, yaw, lean, outline, shape, tone = 0, red = 0) =>
      blades.push(x, z, d, r() * 6.283, h, Math.min(w, h * 0.22), yaw, lean, r(),
        red > 0 ? -red : outline && h > 0.07 ? 1 : 0, tone, shape);

    // clumps: tall and dense in the middle, short and sparse outside
    for (let i = 0; i < o.clumps; i++) {
      const s = sample(1.04);
      const cover = 1 - smooth(clamp((s.d - 0.7) / 0.32, 0, 1));
      if (r() > cover + 0.05) continue;
      const depth = 1 - Math.min(1, s.d);
      let H = (0.036 + 0.095 * Math.pow(depth, 1.2) + r() * 0.03) * lerp(0.55, 1.4, lumpy(s.x, s.z));
      if (r() < 0.05) H *= 1.6;
      // three kinds: single blade, small tuft, big puff (many same-colour blades read as one mass)
      const fringe = 1 - cover, u = r();
      const kind = u < 0.12 + 0.3 * fringe ? 'single' : u < 0.5 + 0.2 * fringe ? 'tuft' : 'puff';
      const big = kind === 'puff' && r() < 0.04 + 0.22 * depth ? 1.6 + r() * 0.6 : 1;
      if (big > 1) H *= 1.25;
      const rad = kind === 'single' ? 0.006
        : kind === 'tuft' ? (0.022 + r() * 0.03) * (0.6 + 0.4 * depth)
        : (0.05 + r() * 0.05) * (0.6 + 0.4 * depth) * big;
      const n = kind === 'single' ? (r() < 0.35 ? 2 : 1)
        : Math.max(1, Math.round((kind === 'tuft' ? 4 + r() * 8 : 10 + r() * 14) * (big > 1 ? 1.8 : 1) * (0.4 + 0.6 * depth)));
      const delay = s.d + r() * 0.05;
      const tone = clamp((patchy(s.x, s.z) - 0.5) * 2.4 + (r() - 0.5) * 0.35, -1, 1);
      for (let k = 0; k < n; k++) {
        const ang = r() * 6.283, q = Math.sqrt(r());
        blade(s.x + Math.cos(ang) * q * rad, s.z + Math.sin(ang) * q * rad, delay + r() * 0.03,
          H * (1 - 0.5 * q * q) * (0.75 + r() * 0.4) * o.scale,
          (0.009 + r() * 0.007) * o.scale,
          ang + (r() - 0.5) * 0.6, 0.12 + 0.45 * q + r() * 0.15,
          r() < 0.012, 2.2 + r() * 1.4, clamp(tone + (r() - 0.5) * 0.15, -1, 1));
      }
    }

    // long thin wisps arching above the clumps; mostly the local colour, a few red or straw
    for (let i = 0; i < o.wisps; i++) {
      const s = sample(0.95);
      const k = r();
      const tone = k > 0.92 ? 2 : (r() - 0.6) * 0.6;
      blade(s.x, s.z, s.d, (0.14 + r() * 0.26) * (1 - s.d * 0.45) * o.scale, (0.0026 + r() * 0.0016) * o.scale,
        r() * 6.283, 0.45 + r() * 0.8, false, 1.15, tone, k < 0.05 ? 0.75 + r() * 0.25 : 0);
    }

    // dabs of ground around the edge
    for (let i = 0; i < o.dabs; i++) {
      const s = sample(1.12);
      if (s.d < 0.7 && r() < 0.7) continue;
      const edge = smooth(clamp((s.d - 0.7) / 0.42, 0, 1));
      const red = r() < 0.02 + 0.06 * edge ? 0.7 + r() * 0.3 : 0;
      dabs.push(s.x, s.z, Math.min(s.d, 1), r() * 6.283, lerp(0.04, 0.012, edge) * (0.6 + r() * 0.8), 1 + r(), r(), 0, r(), red, 0, 0);
    }

    // small flowers (with a stem)
    for (let i = 0; i < o.flowers; i++) {
      const s = sample(0.95);
      const h = (0.02 + r() * 0.06) * o.scale;
      const c = FLOWERS[Math.floor(r() * FLOWERS.length)];
      flowers.push(s.x, s.z, s.d, r() * 6.283, (0.009 + r() * 0.006) * o.scale, h, 0, r() < 0.7 ? 5 : 6, c[0], c[1], c[2], r() < 0.5 ? 1 : 0);
      blade(s.x, s.z, s.d, h, 0.004 * o.scale, r() * 6.283, 0.05, false, 1.2);
    }
    return { blades: new Float32Array(blades), dabs: new Float32Array(dabs), flowers: new Float32Array(flowers) };
  }

  /* ---------- main ---------- */
  const DEFAULTS = {
    seed: 7,
    steps: 24,          // one full turn of the field = this many steps (setAngle works in steps)
    clumps: 3900, wisps: 480, dabs: 2600, flowers: 60, scale: 1,
    zoom: 0.49,         // pixels per world unit = zoom × canvas height (width is ignored on purpose:
                        // on a portrait phone the field is wider than the screen, like a close-up)
    shiftY: -0.56,      // vertical position of the field in clip space (more negative = lower)
    elevation: 13,      // camera tilt in degrees (how much from above we look)
    wind: 0.45,
  };

  function mount(canvas, options) {
    const o = Object.assign({}, DEFAULTS, options);
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) { canvas.style.display = 'none'; return null; }

    const progs = {
      blade: compile(gl, BLADE_VS, BLADE_FS),
      ground: compile(gl, GROUND_VS, GROUND_FS),
      dab: compile(gl, DAB_VS, DAB_FS),
      flower: compile(gl, FLOWER_VS, FLOWER_FS),
      pre: compile(gl, POST_VS, PRE_FS),
      blur: compile(gl, POST_VS, BLUR_FS),
      comp: compile(gl, POST_VS, COMP_FS),
    };

    // off-screen targets for the glow: ms = the scene (multisampled, for smooth edges), scene = resolved,
    // the other four are quarter-size glow / mist buffers
    const post = { w: 0, h: 0 };
    function tex(w, h) {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return { t, f, w, h };
    }
    function setupPost(w, h) {
      if (post.w === w && post.h === h) return;
      if (post.w) {
        gl.deleteFramebuffer(post.ms); gl.deleteRenderbuffer(post.msColor); gl.deleteRenderbuffer(post.msDepth);
        for (const k of ['scene', 'b1', 'b2', 'm1', 'm2']) { gl.deleteTexture(post[k].t); gl.deleteFramebuffer(post[k].f); }
      }
      const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
      post.msColor = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, post.msColor);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h);
      post.msDepth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, post.msDepth);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
      post.ms = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, post.ms);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, post.msColor);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, post.msDepth);
      post.scene = tex(w, h);
      const lw = Math.max(1, Math.ceil(w / 4)), lh = Math.max(1, Math.ceil(h / 4));
      post.b1 = tex(lw, lh); post.b2 = tex(lw, lh); post.m1 = tex(lw, lh); post.m2 = tex(lw, lh);
      post.w = w; post.h = h;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    function pass(prog, target, setup) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.f : null);
      gl.viewport(0, 0, target ? target.w : canvas.width, target ? target.h : canvas.height);
      gl.useProgram(prog.p);
      setup(prog.u);
      gl.bindVertexArray(quadVao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    function bindTex(unit, t) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); }
    function glowChain(a, b, thresh) {
      // downsample (+ keep bright parts) → horizontal blur → vertical blur, twice for a wider glow
      pass(progs.pre, a, (u) => { bindTex(0, post.scene.t); gl.uniform1i(u.uTex, 0); gl.uniform2f(u.uTexel, 1 / post.w, 1 / post.h); gl.uniform1f(u.uThresh, thresh); });
      for (let i = 0; i < 2; i++) {
        const r = GLOW.spread * (i + 1);
        pass(progs.blur, b, (u) => { bindTex(0, a.t); gl.uniform1i(u.uTex, 0); gl.uniform2f(u.uDir, r / a.w, 0); });
        pass(progs.blur, a, (u) => { bindTex(0, b.t); gl.uniform1i(u.uTex, 0); gl.uniform2f(u.uDir, 0, r / a.h); });
      }
    }
    function postProcess(K) {
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, post.ms);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, post.scene.f);
      gl.blitFramebuffer(0, 0, post.w, post.h, 0, 0, post.w, post.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      glowChain(post.b1, post.b2, GLOW.threshold);
      if ((K.mist || 0) > 0.001) glowChain(post.m1, post.m2, 0);
      pass(progs.comp, null, (u) => {
        bindTex(0, post.scene.t); bindTex(1, post.b1.t); bindTex(2, post.m1.t);
        gl.uniform1i(u.uScene, 0); gl.uniform1i(u.uBloom, 1); gl.uniform1i(u.uMist, 2);
        gl.uniform1f(u.uBloomK, GLOW.bloom * (K.bloom || 0)); gl.uniform1f(u.uMistK, GLOW.mist * (K.mist || 0));
        const rc = K.rimCol || [1, 0.86, 0.6];
        gl.uniform3f(u.uGlowCol, Math.min(1, rc[0] * 1.02), rc[1] * 1.02, rc[2] * 1.1);
      });
    }
    const data = buildField(o.seed, o);

    // shared geometry: a blade is a strip going up, sliced finer towards the tip
    const strip = [];
    const SEG = 8;
    for (let i = 0; i <= SEG; i++) { const t = Math.sqrt(i / SEG); strip.push(-1, t, 1, t); }
    const stripBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, stripBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(strip), gl.STATIC_DRAW);
    const quadBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    function vao(geo, inst) {
      const v = gl.createVertexArray(); gl.bindVertexArray(v);
      gl.bindBuffer(gl.ARRAY_BUFFER, geo); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      if (inst) {
        const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, inst, gl.STATIC_DRAW);
        for (let i = 0; i < 3; i++) {
          gl.enableVertexAttribArray(1 + i); gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, 48, i * 16); gl.vertexAttribDivisor(1 + i, 1);
        }
      }
      gl.bindVertexArray(null);
      return v;
    }
    const layers = {
      dab: { vao: vao(quadBuf, data.dabs), count: data.dabs.length / 12, verts: 4 },
      blade: { vao: vao(stripBuf, data.blades), count: data.blades.length / 12, verts: (SEG + 1) * 2 },
      flower: { vao: vao(quadBuf, data.flowers), count: data.flowers.length / 12, verts: 4 },
    };
    const quadVao = vao(quadBuf, null);

    // ground mesh: rings from the centre outwards, same outline as the field (edgeR)
    const ground = [];
    const RINGS = 24, SLICES = 120, GMAX = 0.95;
    const gv = (i, j) => {
      const a = (j / SLICES) * Math.PI * 2, d = (i / RINGS) * GMAX, e = edgeR(a);
      return [Math.cos(a) * e * d, Math.sin(a) * e * d, d];
    };
    for (let i = 0; i < RINGS; i++) for (let j = 0; j < SLICES; j++) {
      const A = gv(i, j), B = gv(i + 1, j), C = gv(i + 1, j + 1), D = gv(i, j + 1);
      for (const v of [A, B, C, A, C, D]) ground.push(...v);
    }
    const groundVao = gl.createVertexArray(); gl.bindVertexArray(groundVao);
    const groundBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, groundBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(ground), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 12, 8);
    gl.bindVertexArray(null);
    const groundCount = ground.length / 3;

    // state
    const st = {
      angle: 0, angleTarget: 0,      // in steps
      grow: 0, growing: false, growStart: 0,
      pointer: null, trail: [],      // cursor position on the ground and the trail it leaves
      t0: performance.now(),
    };
    const stepAngle = (Math.PI * 2) / o.steps;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      }
    }

    function camera() {
      const W = canvas.clientWidth, H = canvas.clientHeight;
      const ppw = o.zoom * H;
      const elev = o.elevation * Math.PI / 180;
      const halfH = (H / 2) / ppw, halfW = halfH * (W / H);
      const yaw = st.angle * stepAngle;
      const target = [0, 0.03, 0], dist = 6;
      const eye = [Math.sin(yaw) * Math.cos(elev) * dist, target[1] + Math.sin(elev) * dist, Math.cos(yaw) * Math.cos(elev) * dist];
      const view = lookAt(eye, target, [0, 1, 0]);
      const proj = ortho(-halfW, halfW, -halfH, halfH, 0.1, 20);
      const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
      const up = [-Math.sin(elev) * Math.sin(yaw), Math.cos(elev), -Math.sin(elev) * Math.cos(yaw)];
      return { vp: mul(proj, view), right, up, shift: [0, o.shiftY], eye, target, halfW, halfH, W, H };
    }

    function setCommon(prog, cam, time, balls, K) {
      const u = prog.u;
      gl.useProgram(prog.p);
      if (u.uVP) gl.uniformMatrix4fv(u.uVP, false, cam.vp);
      if (u.uShift) gl.uniform2fv(u.uShift, cam.shift);
      if (u.uTime) gl.uniform1f(u.uTime, time);
      if (u.uGrow) gl.uniform1f(u.uGrow, st.grow);
      if (u.uWind) gl.uniform1f(u.uWind, o.wind);
      if (u.uRight) gl.uniform3fv(u.uRight, cam.right);
      if (u.uUp) gl.uniform3fv(u.uUp, cam.up);
      if (u.uRootShade) gl.uniform1f(u.uRootShade, 0.42);
      if (u.uShadeK) gl.uniform1f(u.uShadeK, K.shade || 0);
      if (u.uGrassRimK) gl.uniform1f(u.uGrassRimK, K.grassRim || 0);
      if (u.uRimCol) gl.uniform3fv(u.uRimCol, K.rimCol || [1, 0.86, 0.6]);
      if (u.uShadeCol) gl.uniform3fv(u.uShadeCol, K.shadeCol || [0.58, 0.53, 0.45]);
      if (u.uFarCol) gl.uniform3fv(u.uFarCol, K.farCol || [0.76, 0.77, 0.64]);
      if (u['uBalls[0]']) gl.uniform4fv(u['uBalls[0]'], balls);
    }

    // screen position → point on the ground (orthographic: follow the view direction down to y = 0)
    function toGround(px, py) {
      const c = st.cam;
      if (!c) return null;
      const nx = (px / c.W) * 2 - 1, ny = 1 - (py / c.H) * 2 - c.shift[1];
      const f = [c.target[0] - c.eye[0], c.target[1] - c.eye[1], c.target[2] - c.eye[2]];
      const fl = Math.hypot(...f); f[0] /= fl; f[1] /= fl; f[2] /= fl;
      const p = [0, 1, 2].map((i) => c.eye[i] + c.right[i] * nx * c.halfW + c.up[i] * ny * c.halfH);
      if (f[1] >= -1e-4) return null;
      const t = -p[1] / f[1];
      return [p[0] + f[0] * t, p[2] + f[2] * t];
    }
    function pushers(now) {
      const RADIUS = 0.09;
      const out = new Float32Array(36);
      if (st.pointer) out.set([st.pointer[0], st.pointer[1], RADIUS, 1], 0);
      st.trail = st.trail.filter((p) => now - p[2] < 900);
      st.trail.slice(-8).forEach((p, i) => out.set([p[0], p[1], RADIUS * 0.8, 0.6 * (1 - (now - p[2]) / 900)], 4 + i * 4));
      return out;
    }

    let last = performance.now();
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const time = (now - st.t0) / 1000;
      resize();

      if (st.growing) st.grow = Math.min(1.6, ((now - st.growStart) / 1000) / 1.9 * 1.6);
      st.angle += (st.angleTarget - st.angle) * (1 - Math.exp(-dt * 9));

      // only take the glow path when there is glow to draw (daytime renders straight to the screen)
      const K = window.SUNLIGHT || {};
      const usePost = (K.bloom || 0) > 0.001 || (K.mist || 0) > 0.001;
      if (usePost) { setupPost(canvas.width, canvas.height); gl.bindFramebuffer(gl.FRAMEBUFFER, post.ms); }
      else gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.disable(gl.BLEND);

      const cam = camera();
      st.cam = cam;
      const balls = pushers(now);
      setCommon(progs.ground, cam, time, balls, K);
      gl.bindVertexArray(groundVao);
      gl.drawArrays(gl.TRIANGLES, 0, groundCount);
      for (const name of ['dab', 'blade', 'flower']) {
        const L = layers[name];
        if (!L.count) continue;
        setCommon(progs[name], cam, time, balls, K);
        gl.bindVertexArray(L.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, L.verts, L.count);
      }
      if (usePost) postProcess(K);
      gl.bindVertexArray(null);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return {
      grow() { st.growing = true; st.growStart = performance.now(); },
      setAngle(steps, instant) { st.angleTarget = steps; if (instant) st.angle = steps; },
      get angle() { return st.angleTarget; },
      setPointer(px, py) {
        if (px === null) { st.pointer = null; return; }
        const g = toGround(px, py);
        if (!g || Math.hypot(g[0], g[1]) > 1.5) { st.pointer = null; return; }
        const last = st.trail[st.trail.length - 1];
        if (!last || Math.hypot(g[0] - last[0], g[1] - last[1]) > 0.04) st.trail.push([g[0], g[1], performance.now()]);
        st.pointer = g;
      },
    };
  }

  window.Field = { mount };
})();
