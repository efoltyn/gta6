"use strict";
/* src/battle/arenas/erg.js — NPC War: THE ERG: open dunes, snow, fields, forest.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in.

   ============================================================ THE ERG
   The desert world's terrain is one 15 km plane at 63 m a cell; the war is
   fought in a 1.2 km window over it whose ground is a FUNCTION added to the
   world's own heightAt, faded to nothing at the window's edge. The men, the
   sight lines (terrainLos), the camera floor, the craters and the bombs all
   read MAP.groundAt, so the shape below is real cover, not paint.

   FOUR FORMS, ONE WINDOW.
     dune   SAND. Real dune morphology from one wind. Transverse ridges every
            ~118 m whose crest line bends into barchanoid crescents (horns
            trailing DOWNWIND, cusps between them), and where the sand supply
            runs low the ridge breaks into separate BARCHANS with flat lag
            pans between. Each dune has a long windward (stoss) slope at
            ~11.5 deg that steepens over the brink, a SHARP crest, and a
            slip face at the angle of repose, 32 deg, ending in a small
            avalanche apron. Crest heights run 2.5-12 m.
     drift  SNOW. The same wind making softer forms: lower drifts with a
            rounded brink and a 26 deg lee over a long swell, plus drift
            tails in the lee of every rock and wall (ground.js drift()).
            The surface carries sastrugi in the shader.
     roll   FIELDS and FOREST. Rolling ground, no wind shape at all: three
            octaves of smooth hills (260 / 85 / 30 m).

   THE SKIN is drawn at the resolution the form deserves: a 1.2 km square
   turned onto the wind, 2 m a cell along the wind (so a crest is one sharp
   line of vertices) and 4 m across it, lit per pixel (MeshPhongMaterial)
   so the shader can lay WIND RIPPLES into the normal under a low sun. The
   world's coarse plane gives up the same turned square under it. */
/* THE WIND blows from the sun's side (toward -x, -z), so under the dunes'
   low afternoon sun the long stoss slopes take the light and every slip
   face falls into its own shade: the crest is a hard line between the two. */
const DUNE = { on: false, cx: 0, cz: 0, R0: 420, R1: 585, half: 600,
  wa: 0.42 + Math.PI, wx: Math.cos(0.42 + Math.PI), wz: Math.sin(0.42 + Math.PI), lam: 118, phase: 0, skin: null, pal: null, tab: null };
/* THE FAIR FIELD: THE ERG IS TURNED ABOUT ITS CENTRE.

   The armies start at cx -/+ gap/2 on the x axis. The world's ground under
   the window is a place (a slope, a hill), the dunes come off one wind
   (long stoss one way, a 32 deg slip face the other), and the forest, the
   hedgerows and the rocks are scattered by hash. Every one of those dealt
   the two start lines different ground. Measured on main at 81284c57: red
   stood 7.2 m above blue on the dunes (5-7 m on snow, fields, forest), and
   30 v 30 identical riflemen from the red slot won 8% on the dunes, 0% on
   the fields and 33% on the snow. Phase-tuning the crest train could not
   fix it: a dune is not the same ground from its stoss as from its slip
   face, and the world under it was never touched.

   So the war window is one half of the erg and that half TURNED 180 DEGREES
   about the centre (cx, cz): a point (x, z) on the far half reads the ground
   at (2cx - x, 2cz - z). Point symmetry, not a mirror, and that was
   measured too: on a ground mirrored across the centre line red still won
   8-17%, because the men are HANDED (a squad's flank, a sidestep, the order
   bearings are tried in), and a mirror sends red's right hook into the
   ground blue's LEFT hook gets. Turned, each side's right is the other's
   right, the way every fair RTS map is built; the same armies split 50/50.

   `src` is the half that is kept (field.js picks it by measurement). The
   two halves are blended across a SEAM band either side of the centre line
   (a smoothstep weight a(d) with a(-d) = 1 - a(d), so the blend is itself
   point-symmetric and has no crease), and from R0 to R1 out the turned
   ground fades back into the world's own, so the horizon is the world's.
   Every prop, tree, hedge, bank and drift placed on the kept half while the
   field is dressed is placed again turned (position through the centre,
   yaw + PI, a direction reversed); what lands on the far half on its own is
   dropped. The far half's dunes are dunes off the reversed wind, and the
   skin's ripples and the blowing sand there follow it. FOLD.on is a
   BUILD-TIME flag (field.js sets it around the dressing), so a log felled
   or a crater dug in battle lands where it lands; FOLD.ground (the turned
   ground) stays on for the battle. */
const FOLD = { on: false, ground: false, cx: 0, cz: 0, src: -1, seam: 30, inside: 0 };
// the kept half's share of a point d metres onto the kept side of the line
function foldA(d) {
  const S = FOLD.seam;
  if (d >= S) return 1;
  if (d <= -S) return 0;
  const t = (d + S) / (2 * S);
  return t * t * (3 - 2 * t);
}
// is (x) on the far half?
function foldFar(x) { return (x - FOLD.cx) * FOLD.src < 0; }
/* Folds nest: whatever an emitted thing places in turn (a boulder's drift,
   a cluster's stones) is already on its own side, so an inner fold passes
   straight through. */
function foldRun(fn, a, b, c, d, e) {
  FOLD.inside++;
  try { return fn(a, b, c, d, e); } finally { FOLD.inside--; }
}
/* EMIT ONE THING ON A TURNED FIELD: fn(x, z, sign) once on the kept half
   and again turned through the centre with sign -1 (a yaw gains PI, a
   direction is reversed); nothing on the far half, and nothing that would
   overlap its own twin at the centre. Not folding: fn(x, z, 1), as always. */
function foldEmit(x, z, r, fn) {
  if (!FOLD.on || FOLD.inside) return fn(x, z, 1);
  const d = (x - FOLD.cx) * FOLD.src, rr = Math.max(0.5, r || 0);
  if (d < 0) return null;
  if (d <= rr && Math.abs(z - FOLD.cz) <= rr) return null;
  const out = foldRun(fn, x, z, 1);
  foldRun(fn, 2 * FOLD.cx - x, 2 * FOLD.cz - z, -1);
  return out;
}
function foldYaw(yaw, sg) { return sg < 0 ? yaw + Math.PI : yaw; }
/* A SEGMENT (a bank, a berm): the kept half of it, and its turned twin. */
function foldSeg(ax, az, bx, bz, fn) {
  if (!FOLD.on || FOLD.inside) return fn(ax, az, bx, bz);
  const c = FOLD.cx, s = FOLD.src;
  const ka = (ax - c) * s >= 0, kb = (bx - c) * s >= 0;
  if (!ka && !kb) return null;
  if (ka !== kb) {                                     // clip at the line
    const t = (c - ax) / (bx - ax), mz = az + (bz - az) * t;
    if (ka) { bx = c; bz = mz; } else { ax = c; az = mz; }
  }
  const out = foldRun(fn, ax, az, bx, bz);
  foldRun(fn, 2 * c - ax, 2 * FOLD.cz - az, 2 * c - bx, 2 * FOLD.cz - bz);
  return out;
}
/* WHAT THE ERG IS WEARING. `form` is the height function, `surface` what the
   ground layer (ground.js) digs, prints and sprays. Colours are albedo (the
   skin is lit per pixel now); `tint` is what the world's far terrain is worked
   toward so the horizon matches the window. */
const ERG_PAL = {
  sand:   { form: "dune",  surface: "sand", sand: 0xc89a62, crest: 0xdcb47a, trough: 0xa5774a, slip: 0xd1a46a, pan: 0x9d8466,
            amp: 1, tint: null, tuft: 0x9a8a5a, tufts: 700, rough: 0.96 },
  snow:   { form: "drift", surface: "snow", sand: 0xe4e9ee, crest: 0xf4f7fa, trough: 0xd1d9e1, slip: 0xc7d3df, pan: 0xd6dce1,
            amp: 1, tint: [0.88, 0.91, 0.94], tuft: 0x857e6c, tufts: 160, rough: 0.72 },
  grass:  { form: "roll",  surface: "grass", sand: 0x6c8744, crest: 0x7a9650, trough: 0x5c763a, slip: 0x6c8744, pan: 0x8b8758,
            amp: 1, tint: [0.36, 0.45, 0.25], tuft: 0x5b7832, tufts: 0, rough: 0.93 },
  forest: { form: "roll",  surface: "forest", sand: 0x46372a, crest: 0x4e3e2d, trough: 0x392d21, slip: 0x46372a, pan: 0x403326,
            amp: 0.85, tint: [0.2, 0.27, 0.15], tuft: 0x4f6b2e, tufts: 0, rough: 0.97 },
};
function hash2(ix, iz, salt) {
  let h = (ix * 374761393 + iz * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vn2(x, z, salt) {
  const ix = Math.floor(x), iz = Math.floor(z);
  let fx = x - ix, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, salt), b = hash2(ix + 1, iz, salt);
  const c = hash2(ix, iz + 1, salt), d = hash2(ix + 1, iz + 1, salt);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
function duneWeight(x, z) {
  const r = Math.max(Math.abs(x - DUNE.cx), Math.abs(z - DUNE.cz));
  if (r <= DUNE.R0) return 1;
  if (r >= DUNE.R1) return 0;
  const t = (r - DUNE.R0) / (DUNE.R1 - DUNE.R0);
  return 1 - t * t * (3 - 2 * t);
}

/* ---- THE DUNE: one crest k at along-wind coordinate u, across-wind v. ----
   The crest's height comes from the sand supply along it; low supply turns a
   ridge into a chain of crescents (barchans), high supply into a transverse
   ridge with only a sinuous crest. Module scratch (no allocation per call:
   this runs on every terrain-sight sample). */
let _cH = 0, _cU = 0;
function duneCrest(k, v, amp, snow) {
  // supply: this crest's own run, over a regional field — part of the
  // window is a barchan field, part a train of transverse ridges
  const loc = vn2(v * 0.0052 + k * 3.7, k * 0.61, 41), reg = vn2(k * 0.18, v * 0.0017, 39);
  let S = loc * 0.6 + reg * 0.85 - 0.3; S = S < 0 ? 0 : S > 1 ? 1 : S;
  const Lb = 70 + 60 * hash2(k, 7, 43);
  let t = v / Lb + hash2(k, 3, 47); t -= Math.floor(t);
  const c = Math.pow(Math.sin(Math.PI * t), 0.7);
  let iso = 1.35 - 1.7 * S; iso = iso < 0 ? 0 : iso > 1 ? 1 : iso;
  const H = (snow ? 1.2 + 4 * S : 2 + 6 * S) * (1 - iso + iso * c) * amp;
  const warp = (vn2(v * 0.008 + k * 5.1, k * 0.3, 17) - 0.5) * 44 + (vn2(v * 0.03, k * 0.7 + 1, 29) - 0.5) * 9;
  _cH = H;
  _cU = k * DUNE.lam + warp + (1 - c) * (6 + 14 * iso);
}
/* THE CREST TABLE. A crest's height and its along-wind position depend on
   (k, v) only, so the window's dozen crests are sampled once a metre along
   their length when the window is raised and read back by linear
   interpolation: the ground function every sight line samples every 3 m
   costs ~60 ns instead of ~1 us. Off the table it computes directly. */
function duneTable() {
  const P = DUNE.pal, snow = P.form === "drift", amp = P.amp == null ? 1 : P.amp;
  const key = DUNE.cx + "," + DUNE.cz + "," + P.form + "," + amp + "," + DUNE.phase;
  if (DUNE.tab && DUNE.tab.key === key) return DUNE.tab;
  const u0 = DUNE.cx * DUNE.wx + DUNE.cz * DUNE.wz - DUNE.phase, v0 = -DUNE.cx * DUNE.wz + DUNE.cz * DUNE.wx;
  const R = DUNE.half * 1.5;
  const k0 = Math.floor((u0 - R) / DUNE.lam) - 2, nK = Math.ceil(2 * R / DUNE.lam) + 5;
  const vMin = Math.floor(v0 - R), nV = Math.ceil(2 * R) + 2;
  const H = new Float32Array(nK * nV), U = new Float32Array(nK * nV);
  for (let a = 0; a < nK; a++) for (let b = 0; b < nV; b++) {
    duneCrest(k0 + a, vMin + b, amp, snow);
    H[a * nV + b] = _cH; U[a * nV + b] = _cU;
  }
  return (DUNE.tab = { key: key, k0: k0, nK: nK, vMin: vMin, nV: nV, H: H, U: U, snow: snow, amp: amp });
}
function crestAt(T, k, v) {
  const a = k - T.k0, fb = v - T.vMin, b = Math.floor(fb);
  if (a < 0 || a >= T.nK || b < 0 || b >= T.nV - 1) { duneCrest(k, v, T.amp, T.snow); return; }
  const t = fb - b, i = a * T.nV + b;
  _cH = T.H[i] + (T.H[i + 1] - T.H[i]) * t;
  _cU = T.U[i] + (T.U[i + 1] - T.U[i]) * t;
}
const DS = { h: 0, lee: 0, crest: 0, trough: 0, frac: 0 };     // the last sample's anatomy
function duneShape(x, z, amp, snow) {
  const u = x * DUNE.wx + z * DUNE.wz - DUNE.phase, v = -x * DUNE.wz + z * DUNE.wx;
  const k0 = Math.floor(u / DUNE.lam);
  const TL = snow ? 0.53 : 0.6249;                 // tan(26 deg) snow lee, tan(32 deg) angle of repose
  const T = duneTable();
  let best = 0, bH = 1, bdu = 1e9, blee = 0;
  for (let k = k0 - 1; k <= k0 + 1; k++) {
    crestAt(T, k, v);
    const H = _cH;
    if (H < 0.25) continue;
    const du = u - _cU;
    const Lw = H * 4.9;
    let h = 0, lee = 0;
    if (du <= 0) {
      if (du < -Lw) continue;
      const t = 1 + du / Lw;
      h = H * t * t * (1.55 - 0.55 * t);            // the stoss: concave foot, convex brink
    } else {
      const rc = snow ? 3 : 0.35;                    // sand breaks sharp; snow rounds over
      const lin = du < rc ? H - du * du * TL / (2 * rc) : H - TL * (du - rc * 0.5);
      const a0 = H * 0.1;                            // the avalanche apron at the toe
      h = lin > a0 ? lin : a0 * Math.exp((lin - a0) / a0);
      if (h < 0.02) continue;
      lee = lin > a0 ? 1 : Math.max(0, lin / a0);
    }
    if (h > best) { best = h; bH = H; bdu = du; blee = lee; }
  }
  DS.lee = blee;
  DS.crest = Math.exp(-Math.abs(bdu) / (bdu > 0 ? 2.5 : 6));
  DS.trough = best < 0.6 ? 1 - best / 0.6 : 0;
  DS.frac = best / Math.max(0.5, bH);
  // so no slope is a perfect plane: a low cross-lump, and the base level
  const lump = (vn2(x * 0.045, z * 0.045, 53) - 0.5) * 0.5;
  const swell = snow ? (vn2(x * 0.0034, z * 0.0034, 59) - 0.5) * 2 : 0;
  return best - (snow ? 1.6 : 2.8) + lump + swell;
}
function rollShape(x, z, amp) {
  DS.lee = 0; DS.crest = 0; DS.trough = 0;
  const a = (vn2(x / 260, z / 260, 61) - 0.5) * 8;
  const b = (vn2(x / 85, z / 85, 67) - 0.5) * 2.6;
  const c = (vn2(x / 30, z / 30, 71) - 0.5) * 1.1;
  const h = (a + b + c) * amp;
  DS.frac = Math.max(0, Math.min(1, 0.5 + h / 14));
  DS.trough = Math.max(0, Math.min(1, -h / 6));
  return h;
}
function duneDetail(x, z) {
  if (!DUNE.on) return 0;
  const w = duneWeight(x, z);
  if (w <= 0) { DS.h = 0; DS.lee = 0; DS.crest = 0; DS.trough = 0; DS.frac = 0; return 0; }
  const P = DUNE.pal || ERG_PAL.sand;
  const amp = P.amp == null ? 1 : P.amp;
  let h;
  if (P.form === "roll") h = rollShape(x, z, amp);
  else h = duneShape(x, z, amp, P.form === "drift");
  DS.h = h * w;
  return DS.h;
}
/* CREST LINES, for the blowing sand: every crest over 2.5 m inside the box,
   walked along its length. */
function duneCrests(cx, cz, hx, hz, step) {
  const out = [];
  if (!DUNE.pal || DUNE.pal.form === "roll") return out;
  const P = DUNE.pal, snow = P.form === "drift";
  const u0 = cx * DUNE.wx + cz * DUNE.wz - DUNE.phase, v0 = -cx * DUNE.wz + cz * DUNE.wx;
  const R = Math.max(hx, hz);
  for (let k = Math.floor((u0 - R) / DUNE.lam) - 1; k <= Math.floor((u0 + R) / DUNE.lam) + 1; k++) {
    for (let v = v0 - R; v <= v0 + R; v += step) {
      duneCrest(k, v, P.amp == null ? 1 : P.amp, snow);
      if (_cH < (snow ? 1.6 : 2.5)) continue;
      const cu = _cU + DUNE.phase, x = cu * DUNE.wx - v * DUNE.wz, z = cu * DUNE.wz + v * DUNE.wx;
      if (Math.abs(x - cx) > hx || Math.abs(z - cz) > hz) continue;
      // on a turned field the crests are the kept half's, twice (the far
      // half's own crest train is not the ground there any more)
      if (FOLD.ground && (x - FOLD.cx) * FOLD.src < FOLD.seam) continue;    // the blend band has no clean crest
      out.push({ x: x, z: z, y: MAP_GROUND(x, z), h: _cH });
      if (FOLD.ground) {
        const mx = 2 * FOLD.cx - x, mz = 2 * FOLD.cz - z;
        if (Math.abs(mx - cx) <= hx && Math.abs(mz - cz) <= hz) out.push({ x: mx, z: mz, y: MAP_GROUND(mx, mz), h: _cH });
      }
    }
  }
  return out;
}

/* ---- THE FIELDS' PARCELS, shared by the skin shader and fields.js -------
   A turned grid of parcels; each cell's crop is read from a 16 x 16 type
   table, uploaded as a texture so the shader and the layout agree EXACTLY
   (no float hash that could round differently on a GPU). */
const PARCEL = { ang: 0.21, w: 104, d: 78, n: 16, types: null, tex: null };
const CROP = { pasture: 0, wheat: 1, maize: 2, plough: 3, stubble: 4 };
function parcelTypes() {
  if (PARCEL.types) return PARCEL.types;
  const t = new Uint8Array(PARCEL.n * PARCEL.n);
  const W = [0.3, 0.22, 0.16, 0.16, 0.16];
  for (let j = 0; j < PARCEL.n; j++) for (let i = 0; i < PARCEL.n; i++) {
    let r = hash2(i, j, 211), k = 0;
    while (k < W.length - 1 && r > W[k]) { r -= W[k]; k++; }
    t[j * PARCEL.n + i] = k;
  }
  PARCEL.types = t;
  return t;
}
function parcelAt(x, z) {
  const rx = x - DUNE.cx, rz = z - DUNE.cz;
  const c = Math.cos(PARCEL.ang), s = Math.sin(PARCEL.ang);
  const a = rx * c + rz * s, b = -rx * s + rz * c;
  const i = Math.floor(a / PARCEL.w), j = Math.floor(b / PARCEL.d);
  const T = parcelTypes(), n = PARCEL.n;
  const ii = Math.max(0, Math.min(n - 1, i + n / 2)), jj = Math.max(0, Math.min(n - 1, j + n / 2));
  return { i: i, j: j, u: a - i * PARCEL.w, v: b - j * PARCEL.d, type: T[jj * n + ii], rows: hash2(i, j, 223) < 0.5 ? 0 : 1 };
}

/* ---- THE SKIN ------------------------------------------------------------ */
const ERG_GLSL = [
  "float egH(vec2 p) { p = mod(p, 289.0); vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }",
  "float egN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);",
  "  return mix(mix(egH(i), egH(i + vec2(1.0, 0.0)), f.x), mix(egH(i + vec2(0.0, 1.0)), egH(i + vec2(1.0, 1.0)), f.x), f.y); }",
].join("\n");
// per-form surface work, at <normal_fragment_maps>: it may bend `normal`
// (view space) and re-colour diffuseColor before the lights read either
function ergSurfaceGLSL(form, surface) {
  const head =
    "{ float dist = length(vEW - cameraPosition);\n" +
    "  vec2 rel = vEW.xz - uC;\n" +
    // the turned field (FOLD): the far half wears the kept half's surface,
    // turned through the centre, and its bent normals turn with it
    "  float fS = 1.0; if (uF.x > 0.5 && rel.x * uF.y < 0.0) { rel = -rel; fS = -1.0; }\n" +
    "  vec2 q = vec2(dot(rel, uW), dot(rel, vec2(-uW.y, uW.x)));\n" +
    "  float lee = vED.x, crest = vED.y, trough = vED.z, frac = vED.w;\n" +
    "  vec3 wN = vec3(0.0);\n" +
    "  diffuseColor.rgb *= 0.95 + 0.1 * egN(rel * 0.013) + 0.04 * (egN(rel * 0.07 + 7.0) - 0.5);\n";
  const tail =
    "  wN.xz *= fS;\n" +
    "  normal = normalize(normal + (viewMatrix * vec4(wN, 0.0)).xyz);\n" +
    "  diffuseColor.rgb *= 1.0 - smoothstep(160.0, 800.0, dist) * 0.04; }\n";
  if (form === "dune") return head +
    // RIPPLES: wind-transverse, sinuous, bifurcating; gentle stoss, steep lee.
    // Coarser in the troughs, gone on the slip face (avalanching sand wipes
    // them), quiet right on the brink.
    "  float kR = (1.0 - smoothstep(16.0, 70.0, dist)) * (1.0 - smoothstep(0.12, 0.5, lee)) * (1.0 - crest * 0.6);\n" +
    "  float kC = (1.0 - smoothstep(30.0, 120.0, dist)) * (1.0 - smoothstep(0.12, 0.5, lee));\n" +
    "  if (kC > 0.0) {\n" +
    "    float warp = 0.55 * sin(q.y * 0.83 + egN(q * vec2(0.05, 0.3)) * 4.0) + 0.45 * egN(q * vec2(0.11, 0.9));\n" +
    "    float lam = 0.72 + 0.4 * trough;\n" +
    "    float ph = (q.x + warp) / lam * 6.2832;\n" +
    "    float rip = sin(ph) + 0.28 * sin(2.0 * ph);\n" +
    "    float dr = (cos(ph) + 0.56 * cos(2.0 * ph)) * 6.2832 / lam;\n" +
    "    wN -= vec3(uW.x, 0.0, uW.y) * dr * 0.016 * kR;\n" +
    // dark heavy minerals settle in the ripple troughs: ripples read even in flat light
    "    diffuseColor.rgb *= 1.0 - 0.07 * kC * smoothstep(0.2, 1.1, -rip);\n" +
    "  }\n" +
    // wind-sorted bands parallel to the crest on the stoss
    "  float bands = sin(frac * 26.0 + egN(q * vec2(0.02, 0.006)) * 7.0);\n" +
    "  diffuseColor.rgb *= 1.0 + 0.035 * bands * (1.0 - lee) * (1.0 - trough);\n" +
    // the slip face: grainflow tongues down the fall line
    "  float gf = egN(vec2(q.y * 1.7, q.x * 0.12));\n" +
    "  diffuseColor.rgb *= 1.0 + 0.07 * (gf - 0.5) * lee;\n" +
    "  wN += vec3(-uW.y, 0.0, uW.x) * (egN(vec2(q.y * 1.7 + 0.15, q.x * 0.12)) - gf) * 0.9 * lee * (1.0 - smoothstep(20.0, 80.0, dist));\n" +
    // grain, where the lens is close
    "  float gr = egH(floor(vEW.xz * 22.0));\n" +
    "  diffuseColor.rgb *= 1.0 + (gr - 0.5) * 0.06 * (1.0 - smoothstep(4.0, 14.0, dist));\n" +
    tail;
  if (form === "drift") return head +
    // SASTRUGI: sharp wind-carved ridges along the wind, irregular, in fields
    "  float kS = 1.0 - smoothstep(30.0, 140.0, dist);\n" +
    "  if (kS > 0.0) {\n" +
    "    vec2 s = vec2(q.x * 0.32, q.y * 2.1);\n" +
    "    float field = smoothstep(0.35, 0.7, egN(q * 0.025));\n" +
    "    float r0 = 1.0 - abs(2.0 * egN(s) - 1.0);\n" +
    "    float rx = 1.0 - abs(2.0 * egN(s + vec2(0.06, 0.0)) - 1.0);\n" +
    "    float ry = 1.0 - abs(2.0 * egN(s + vec2(0.0, 0.18)) - 1.0);\n" +
    "    r0 = r0 * r0 * r0; rx = rx * rx * rx; ry = ry * ry * ry;\n" +
    "    float a = 0.11 * kS * field * (1.0 - lee);\n" +
    "    wN -= (vec3(uW.x, 0.0, uW.y) * (rx - r0) / 0.06 * 0.32 + vec3(-uW.y, 0.0, uW.x) * (ry - r0) / 0.18 * 2.1) * a * 0.18;\n" +
    "    diffuseColor.rgb *= 1.0 - 0.05 * r0 * field * kS;\n" +
    "  }\n" +
    // wind crust: glazed patches, a little greyer and smoother
    "  float crust = smoothstep(0.58, 0.78, egN(rel * 0.031 + 3.0));\n" +
    "  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.95, 0.965, 0.99), crust);\n" +
    "  specularStrength *= 1.0 + 2.5 * crust;\n" +
    // the lee holds blue shade (sky-lit hollows)
    "  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.9, 0.95, 1.05), lee * 0.7 + trough * 0.3);\n" +
    // glints: a crystal catches the sun from one angle only
    "  float gl = egH(floor(vEW.xz * 20.0) + floor(normalize(vEW - cameraPosition).xz * 6.0) * 31.0);\n" +
    "  vSpark = step(0.9965, gl) * (1.0 - smoothstep(6.0, 40.0, dist));\n" +
    tail;
  if (surface === "forest") return head +
    // LEAF LITTER: duff browns, moss in the damp hollows, fallen leaves, twigs
    "  float kL = 1.0 - smoothstep(10.0, 45.0, dist);\n" +
    "  float moss = smoothstep(0.58, 0.78, egN(rel * 0.09 + 11.0) * 0.7 + trough * 0.5);\n" +
    "  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.26, 0.11), moss * 0.7);\n" +
    "  float damp = egN(rel * 0.21 + 4.0);\n" +
    "  diffuseColor.rgb *= 0.86 + 0.24 * damp;\n" +
    "  vec2 lc = floor(vEW.xz * 5.0); float lh = egH(lc);\n" +
    "  vec3 leaf = lh < 0.33 ? vec3(0.55, 0.32, 0.12) : (lh < 0.66 ? vec3(0.62, 0.48, 0.2) : vec3(0.38, 0.24, 0.13));\n" +
    "  float lf = step(0.55, egH(lc + 17.0)) * (1.0 - moss) * kL;\n" +
    "  vec2 lp = fract(vEW.xz * 5.0) - 0.5; lf *= 1.0 - smoothstep(0.16, 0.3, length(lp * vec2(1.0, 1.7)));\n" +
    "  diffuseColor.rgb = mix(diffuseColor.rgb, leaf, lf * 0.75);\n" +
    // twigs: one thin stick per 1.4 m cell, at its own angle
    "  vec2 tc = floor(vEW.xz / 1.4); vec2 tp = fract(vEW.xz / 1.4) - 0.5; float ta = egH(tc + 5.0) * 3.14;\n" +
    "  vec2 td = vec2(cos(ta), sin(ta)); float along = dot(tp, td), off = abs(dot(tp, vec2(-td.y, td.x)));\n" +
    "  float twig = step(0.45, egH(tc)) * (1.0 - smoothstep(0.006, 0.014, off)) * step(abs(along), 0.32) * kL;\n" +
    "  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.12, 0.08), twig * 0.8);\n" +
    "  wN += vec3(egN(vEW.xz * 3.1) - 0.5, 0.0, egN(vEW.xz * 3.1 + 9.0) - 0.5) * 0.25 * kL;\n" +
    // DAPPLED LIGHT: the canopy map over the stand, broken by sun flecks
    "  vec2 cuv = (rel - uCanopyR.xy) / uCanopyR.zw;\n" +
    "  float cov = (cuv.x > 0.0 && cuv.x < 1.0 && cuv.y > 0.0 && cuv.y < 1.0) ? texture2D(uCanopy, cuv).r : 0.0;\n" +
    "  float fleck = smoothstep(0.58, 0.82, egN(vEW.xz * 0.55 + 3.0) * 0.6 + egN(vEW.xz * 1.9) * 0.4);\n" +
    "  vShade = mix(1.0, min(1.0, 0.34 + 0.72 * fleck), cov);\n" +
    tail;
  // FIELDS: the parcel's crop, by the type table, with rows and furrows
  return head +
    "  float pc = cos(uParcel.x), ps = sin(uParcel.x);\n" +
    "  vec2 pa = vec2(rel.x * pc + rel.y * ps, -rel.x * ps + rel.y * pc);\n" +
    "  vec2 cell = floor(pa / uParcel.yz);\n" +
    "  vec2 loc = pa - cell * uParcel.yz;\n" +
    "  vec4 pt = texture2D(uParcelT, (clamp(cell + 8.0, 0.0, 15.0) + 0.5) / 16.0);\n" +
    "  float ty = floor(pt.r * 255.0 + 0.5); float rowAx = pt.g > 0.5 ? 1.0 : 0.0;\n" +
    "  float edge = min(min(loc.x, uParcel.y - loc.x), min(loc.y, uParcel.z - loc.y));\n" +
    "  float rc = mix(loc.x, loc.y, rowAx);\n" +
    "  float kF = 1.0 - smoothstep(40.0, 200.0, dist);\n" +
    "  vec3 turf = vec3(1.0);\n" +
    "  TURF_CALL\n" +
    "  vec3 col = diffuseColor.rgb * turf;\n" +
    "  if (ty > 0.5 && edge > 2.5) {\n" +
    "    float row = 0.5 + 0.5 * cos(rc / 0.76 * 6.2832);\n" +
    "    if (ty < 1.5) { col = vec3(0.6, 0.5, 0.27) * (0.9 + 0.12 * egN(rel * 0.05)) * (1.0 - 0.08 * row * kF); }\n" +             // wheat stubble ground under the crop
    "    else if (ty < 2.5) { col = mix(vec3(0.3, 0.24, 0.17), vec3(0.32, 0.4, 0.17), row * 0.6) * (0.92 + 0.12 * egN(rel * 0.04)); }\n" +   // maize: soil between rows
    "    else if (ty < 3.5) { col = vec3(0.34, 0.26, 0.18) * (0.88 + 0.16 * egN(rel * 0.03)) * (0.86 + 0.2 * row);\n" +           // ploughed furrows
    "      float d = -sin(rc / 0.76 * 6.2832) * 6.2832 / 0.76; vec2 ax = rowAx > 0.5 ? vec2(-ps, pc) : vec2(pc, ps);\n" +
    "      wN -= vec3(ax.x, 0.0, ax.y) * d * 0.035 * kF; }\n" +
    "    else { col = vec3(0.66, 0.6, 0.38) * (0.92 + 0.1 * egN(rel * 0.06)) * (1.0 - 0.1 * step(0.8, fract(rc / 4.5)) * kF); }\n" +  // stubble with windrows
    "  }\n" +
    // the farm track along every third boundary
    "  float trk = 1.0 - smoothstep(1.4, 2.2, abs(loc.y - 1.0));\n" +
    "  trk *= step(0.5, mod(cell.y, 3.0)) < 0.5 ? 1.0 : 0.0;\n" +
    "  col = mix(col, vec3(0.42, 0.36, 0.27) * (0.9 + 0.15 * egN(vEW.xz * 0.8)), trk * 0.85);\n" +
    "  diffuseColor.rgb = col;\n" +
    tail;
}
let ERG_CANOPY = null;      // the forest's canopy-cover texture (forest.js fills it)
function ergMaterial(P) {
  // PER-PIXEL, LAMBERT-BRIGHT: Phong lights per fragment (so the ripples
  // and sastrugi bent into the normal take the sun) on the same diffuse
  // scale as the Lambert the rest of the page is tuned for; Standard under
  // r128's legacy lights washed the sand to paper. A dull specular: sand
  // and litter barely shine, crusted snow a little.
  const mat = new THREE.MeshPhongMaterial({ vertexColors: true, specular: P.surface === "snow" ? 0x1c1f22 : 0x080808,
    shininess: P.surface === "snow" ? 18 : 6 });
  const form = P.form, surface = P.surface;
  if (!ERG_CANOPY) {
    const d = new Uint8Array(4); d[0] = 0;
    ERG_CANOPY = { tex: new THREE.DataTexture(d, 1, 1, THREE.RGBAFormat), rect: new THREE.Vector4(0, 0, 1, 1) };
    ERG_CANOPY.tex.needsUpdate = true;
  }
  let parcelTex = null;
  if (surface === "grass") {
    const T = parcelTypes(), n = PARCEL.n, d = new Uint8Array(n * n * 4);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = (j * n + i) * 4;
      d[k] = T[j * n + i]; d[k + 1] = hash2(i - n / 2, j - n / 2, 223) < 0.5 ? 0 : 255; d[k + 3] = 255;
    }
    parcelTex = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
    parcelTex.magFilter = THREE.NearestFilter; parcelTex.minFilter = THREE.NearestFilter;
    parcelTex.needsUpdate = true;
    PARCEL.tex = parcelTex;
  }
  const turfOn = surface === "grass" && !!CBZ.GROUND_TURF_GLSL;
  mat.onBeforeCompile = function (sh) {
    sh.uniforms.uC = { value: new THREE.Vector2(DUNE.cx, DUNE.cz) };
    sh.uniforms.uW = { value: new THREE.Vector2(DUNE.wx, DUNE.wz) };
    sh.uniforms.uF = { value: new THREE.Vector2(FOLD.ground ? 1 : 0, FOLD.src) };
    sh.uniforms.uCanopy = { value: ERG_CANOPY.tex };
    sh.uniforms.uCanopyR = { value: ERG_CANOPY.rect };
    sh.uniforms.uParcel = { value: new THREE.Vector3(PARCEL.ang, PARCEL.w, PARCEL.d) };
    sh.uniforms.uParcelT = { value: parcelTex || ERG_CANOPY.tex };
    sh.vertexShader = "attribute vec4 aD;\nvarying vec4 vED;\nvarying vec3 vEW;\n" +
      sh.vertexShader.replace("#include <project_vertex>",
        "#include <project_vertex>\nvED = aD; vEW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    let surf = ergSurfaceGLSL(form, surface).replace("TURF_CALL",
      turfOn ? "turf = groundTurf(vEW.xz, dist, 0.35);" : "turf = vec3(0.92 + 0.16 * egN(rel * 0.043) + 0.08 * (egN(vEW.xz * 0.6) - 0.5) * kF);");
    sh.fragmentShader = "varying vec4 vED;\nvarying vec3 vEW;\nuniform vec2 uC;\nuniform vec2 uW;\nuniform vec2 uF;\n" +
      "uniform sampler2D uCanopy;\nuniform vec4 uCanopyR;\nuniform vec3 uParcel;\nuniform sampler2D uParcelT;\n" +
      ERG_GLSL + "\n" + (turfOn ? CBZ.GROUND_TURF_GLSL + "\n" : "") +
      sh.fragmentShader
        .replace("void main() {", "void main() {\n  float vSpark = 0.0; float vShade = 1.0;")
        .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n" + surf)
        // dappled shade is light the canopy took away: it darkens what the sun
        // and sky put on the floor, both
        .replace("#include <aomap_fragment>", "#include <aomap_fragment>\n" +
          "reflectedLight.directDiffuse *= vShade; reflectedLight.indirectDiffuse *= mix(1.0, vShade, 0.7);")
        .replace("#include <tonemapping_fragment>", "gl_FragColor.rgb += vSpark * vec3(0.9, 0.95, 1.0);\n#include <tonemapping_fragment>");
  };
  mat.customProgramCacheKey = function () { return "npcwar-erg2-" + form + "-" + surface + (turfOn ? "t" : ""); };
  if (CBZ.battleGround) CBZ.battleGround.patchTerrain(mat);
  return mat;
}
function ergSkin(world) {
  const P = DUNE.pal || ERG_PAL.sand;
  const S = DUNE.half * 2;
  const roll = P.form === "roll";
  const NU = roll ? 300 : 600, NV = 300;
  const du = S / NU, dv = S / NV;
  const n = (NU + 1) * (NV + 1);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), aD = new Float32Array(n * 4);
  const sand = new THREE.Color(P.sand), crest = new THREE.Color(P.crest), trough = new THREE.Color(P.trough),
    slip = new THREE.Color(P.slip), pan = new THREE.Color(P.pan), tmp = new THREE.Color();
  const W = [DUNE.wx, DUNE.wz], Q = [-DUNE.wz, DUNE.wx];
  for (let j = 0; j <= NV; j++) {
    const v = -DUNE.half + j * dv;
    for (let i = 0; i <= NU; i++) {
      const u = -DUNE.half + i * du;
      const lx = u * W[0] + v * Q[0], lz = u * W[1] + v * Q[1];
      const x = lx + DUNE.cx, z = lz + DUNE.cz;
      // world + detail + earthworks: what the men stand on. duneDetail ran
      // inside it for this very point, so DS holds this vertex's anatomy
      // (the earthworks add height, never anatomy)
      const y = MAP_GROUND(x, z);
      const k = j * (NU + 1) + i;
      pos[k * 3] = lx; pos[k * 3 + 1] = y; pos[k * 3 + 2] = lz;
      const far = FOLD.ground && foldFar(x);
      const w = duneWeight(x, z), fx = far ? 2 * FOLD.cx - x : x, fz = far ? 2 * FOLD.cz - z : z;
      const lee = DS.lee * w, cr = DS.crest * w, tr = DS.trough * w;
      tmp.copy(sand);
      if (roll) {
        tmp.lerp(DS.h > 0 ? crest : trough, Math.min(1, Math.abs(DS.h) / 6) * 0.5);
      } else {
        tmp.lerp(crest, cr * 0.55);
        tmp.lerp(slip, lee * 0.45);
        tmp.lerp(trough, tr * 0.6);
        const flat = vn2(fx * 0.012, fz * 0.012, 61);
        if (flat > 0.6) tmp.lerp(pan, Math.min(1, (flat - 0.6) * 4) * tr * 0.7);
      }
      tmp.multiplyScalar(0.96 + vn2(fx * 0.21, fz * 0.21, 71) * 0.06);
      if (w < 1) tmp.lerp(sand, 1 - w);
      col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
      aD[k * 4] = lee; aD[k * 4 + 1] = cr; aD[k * 4 + 2] = tr; aD[k * 4 + 3] = DS.frac;
    }
  }
  const idx = new Uint32Array(NU * NV * 6);
  let o = 0;
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
    idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("aD", new THREE.BufferAttribute(aD, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  // the winding must face up: flip if the first triangle's normal points down
  if (g.attributes.normal.getY(0) < 0) {
    for (let t = 0; t < idx.length; t += 3) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
    g.computeVertexNormals();
  }
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, ergMaterial(P));
  m.position.set(DUNE.cx, 0, DUNE.cz);
  m.receiveShadow = true; m.castShadow = true;
  m.userData.terrain = true; m.userData.dynamic = true;
  m.name = "duneSkin";
  CBZ.scene.add(m);
  DUNE.skin = m;
  // the world's own plane gives up the turned window, per fragment
  const T = world && world.terrain;
  if (T && T.material) {
    T.userData.dynamic = true;
    T.material.onBeforeCompile = function (sh) {
      sh.uniforms.uHole = { value: new THREE.Vector3(DUNE.cx, DUNE.cz, DUNE.half - 4) };
      sh.uniforms.uHoleW = { value: new THREE.Vector2(DUNE.wx, DUNE.wz) };
      sh.vertexShader = "varying vec3 vHoleW;\n" + sh.vertexShader.replace("#include <project_vertex>",
        "#include <project_vertex>\nvHoleW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = "varying vec3 vHoleW;\nuniform vec3 uHole;\nuniform vec2 uHoleW;\n" + sh.fragmentShader.replace("void main() {",
        "void main() {\n { vec2 d = vHoleW.xz - uHole.xy; vec2 q = vec2(dot(d, uHoleW), dot(d, vec2(-uHoleW.y, uHoleW.x)));\n" +
        "   if (abs(q.x) < uHole.z && abs(q.y) < uHole.z) discard; }")
        // the erg beyond the skin wears the skin's sand, so the rim has no seam
        // (the salt pan and the mountains past the dune ring keep their own)
        .replace("#include <color_fragment>", "#include <color_fragment>\n" +
          "diffuseColor.rgb *= mix(vec3(0.9, 0.78, 0.65), vec3(1.0), smoothstep(2650.0, 2900.0, length(vHoleW.xz)));" +
          (P.tint ? "\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(" + P.tint.map(function (v) { return v.toFixed(3); }).join(",") +
            "), 0.82 * (1.0 - smoothstep(2650.0, 2900.0, length(vHoleW.xz))));" : ""));
    };
    T.material.needsUpdate = true;
  }
  // THE CITY LEAVES THE HORIZON. The desert world is a basin with a 200-tower
  // downtown in the middle of it, and from the erg every low shot framed a
  // grey block skyline behind the war. Everything of the downtown is taken off
  // the scene (its far colliders are two kilometres from any man and stay
  // harmless); the terrain, the inland sea and the desert's own rocks, scrub
  // and mesas stay, and the mountains close the view the way a basin should.
  if (world && world.root) {
    const drop = [];
    world.root.children.forEach(function (o) {
      if (o.name === "terrain" || o.name === "sea") return;
      if (o.isInstancedMesh && o.count > 0) {
        const mm = new THREE.Matrix4(), pp = new THREE.Vector3();
        o.getMatrixAt(0, mm); pp.setFromMatrixPosition(mm);
        if (Math.hypot(pp.x, pp.z) > 1100) return;     // desert dress, out on the erg
      }
      drop.push(o);
    });
    drop.forEach(function (o) { world.root.remove(o); });
  }
  reseatDesertDress(world);
}
// the old name, kept for anything that still calls it
function duneSkin(world) { return ergSkin(world); }
/* THE DRESS ON THE NEW SAND. The desert's rocks and scrub were seated on the
   coarse heightAt; inside the window the ground moved under them by metres,
   so each one is re-seated on the ground it actually stands on, the scrub
   cones leave the window, and dry grass tufts (a spray of thin blades,
   instanced) grow where a desert plant would: in the troughs and on the pan,
   never on a live slip face. */
/* A ROCK IS NOT A D12, AND NOT A FACETED BALL EITHER. r128's icosahedron
   is non-indexed, so displacing it and asking for normals gave every face
   its own flat normal: a lumpy disco ball in one flat colour. The shell is
   welded first (smooth normals across the lumps), pushed out by noise at
   three scales plus bedding ledges, and PAINTED per vertex by a caller
   (sandstone strata and desert varnish in the erg, encrusting growth and
   silt on the reef, granite and lichen in the north). */
function weldGeo(g) {
  const p = g.attributes.position, seen = new Map(), idx = [], pos = [];
  for (let i = 0; i < p.count; i++) {
    const k = Math.round(p.getX(i) * 1e4) + "," + Math.round(p.getY(i) * 1e4) + "," + Math.round(p.getZ(i) * 1e4);
    let j = seen.get(k);
    if (j === undefined) { j = pos.length / 3; pos.push(p.getX(i), p.getY(i), p.getZ(i)); seen.set(k, j); }
    idx.push(j);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  return out;
}
function lumpRock(detail, salt, flat, paint) {
  const g = weldGeo(new THREE.IcosahedronGeometry(1, detail));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let k = 0.74 + vn2(x * 1.9 + salt, z * 1.9 + y * 1.6, 83) * 0.38 + vn2(x * 4.7 + y, y * 4.7 + z + salt, 89) * 0.13 +
      vn2(x * 11 + salt, z * 11 + y * 7, 97) * 0.045;
    k *= 1 + 0.035 * Math.sin(y * 10 + vn2(x * 2 + salt, z * 2, 7) * 3);      // bedding ledges
    p.setXYZ(i, x * k, y * k * (y > 0 ? flat : 1), z * k);
  }
  g.computeVertexNormals();
  const n = g.attributes.normal, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const c = paint(p.getX(i), p.getY(i), p.getZ(i), n.getY(i));
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}
function rockGeometry() {
  return lumpRock(2, 0, 0.72, function (x, y, z, ny) {        // 260 instances: 320 tris each
    const band = Math.sin(y * 7.5 + vn2(x * 1.3, z * 1.3, 5) * 2.4);
    let r = 0.6 + band * 0.045, g = 0.47 + band * 0.03, b = 0.36 + band * 0.02;
    if (band > 0.55) { r += 0.05; g -= 0.01; }                        // an iron-red bed
    const v = 0.9 + vn2(x * 6, z * 6 + y * 3, 13) * 0.2;
    r *= v; g *= v; b *= v;
    if (ny > 0.55) { const k = (ny - 0.55) * 0.5; r -= r * k; g -= g * k; b -= b * k * 0.8; }   // desert varnish
    const dust = Math.max(0, Math.min(1, (-y - 0.05) * 2.2));         // sand banked at the foot
    r += (0.77 - r) * dust; g += (0.58 - g) * dust; b += (0.36 - b) * dust;
    return [r, g, b];
  });
}
function tuftGeometry() {
  const parts = [];
  for (let b = 0; b < 9; b++) {
    const c = new THREE.ConeGeometry(0.035, 0.55 + hash2(b, 1, 7) * 0.5, 3, 1);
    c.translate(0, (0.55 + hash2(b, 1, 7) * 0.5) / 2, 0);
    const a = b * 2.39996, lean = 0.25 + hash2(b, 2, 7) * 0.5;
    c.rotateX(Math.cos(a) * lean); c.rotateZ(Math.sin(a) * lean);
    c.translate(Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08);
    parts.push(c);
  }
  // merge by hand (r128 BufferGeometryUtils is not on this page)
  const flat = parts.map(function (c) { return c.index ? c.toNonIndexed() : c; });
  let total = 0; flat.forEach(function (c) { total += c.attributes.position.count; });
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
  let o = 0;
  flat.forEach(function (ci) {
    pos.set(ci.attributes.position.array, o * 3); nor.set(ci.attributes.normal.array, o * 3);
    o += ci.attributes.position.count;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos.slice(0, o * 3), 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor.slice(0, o * 3), 3));
  return out;
}
function reseatDesertDress(world) {
  if (!world || !world.root) return;
  const mtx = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const PAL = DUNE.pal || ERG_PAL.sand;
  world.root.traverse(function (o) {
    if (!o.isInstancedMesh) return;
    const geoT = o.geometry && o.geometry.type;
    const isRock = geoT === "DodecahedronGeometry" || geoT === "DodecahedronBufferGeometry";
    const isScrub = geoT === "ConeGeometry" || geoT === "ConeBufferGeometry";
    if (!isRock && !isScrub) return;
    if (isRock) {
      o.geometry = PAL.surface === "sand" ? rockGeometry() : CBZ.battleDress.geo.boulder(0, true);
      o.material = new THREE.MeshLambertMaterial({ vertexColors: true });
      o.receiveShadow = true;
    }
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, mtx); mtx.decompose(p, q, s);
      const w = duneWeight(p.x, p.z);
      if (isScrub) {
        if (w > 0) o.setMatrixAt(i, zero);      // the cones leave the window
        continue;
      }
      // the old rocks in the battle window make way for the dressing's own;
      // the rest are sunk a third into their sand, which is how stone sits
      if (Math.abs(p.x - DUNE.cx) < DUNE.R0 && Math.abs(p.z - DUNE.cz) < DUNE.R0 && PAL.surface !== "sand") { o.setMatrixAt(i, zero); continue; }
      p.y = MAP_GROUND(p.x, p.z) + s.y * 0.12;
      mtx.compose(p, q, s); o.setMatrixAt(i, mtx);
    }
    o.instanceMatrix.needsUpdate = true;
  });
  // dry grass, only where a lens can see it
  const N = PAL.tufts || 0;
  if (!N) return;
  const tuft = new THREE.InstancedMesh(tuftGeometry(), new THREE.MeshLambertMaterial({ color: PAL.tuft }), N);
  let k = 0;
  for (let i = 0; i < N * 3 && k < N; i++) {
    const x = DUNE.cx + (hash2(i, 3, 101) - 0.5) * (DUNE.R0 * 1.8), z = DUNE.cz + (hash2(i, 4, 101) - 0.5) * (DUNE.R0 * 1.8);
    duneDetail(x, z);
    if (DS.lee > 0.2 || DS.crest > 0.5 || vn2(x * 0.02, z * 0.02, 131) < 0.42) continue;
    const sc = 0.7 + hash2(i, 5, 101) * 1.1;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash2(i, 6, 101) * 6.28);
    mtx.compose(p.set(x, MAP_GROUND(x, z) - 0.05, z), q, s.set(sc, sc * (0.8 + hash2(i, 7, 101) * 0.5), sc));
    tuft.setMatrixAt(k++, mtx);
  }
  tuft.count = k;
  tuft.instanceMatrix.needsUpdate = true;
  tuft.castShadow = true; tuft.frustumCulled = false; tuft.userData.dynamic = true;
  CBZ.scene.add(tuft);
}
let MAP_GROUND = function () { return 0; };
