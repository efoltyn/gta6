#!/usr/bin/env node
/* tools/units-kit-check.mjs — the shared animal kit, held (node, < 2 s).

   src/units/kit/{gait,quadrig,loft}.js were lifted out of city/dogmodel.js.
   This holds them to two things:
     1  the LAW: a planted foot does not slide (world contact fixed within
        1 mm for its whole stance) at a walk, a trot, a gallop and a turn, for
        every footfall table the kit ships;
     2  the ORIGIN: with the default (DOG) table / spec the kit reproduces the
        dog EXACTLY — the gait frame by frame, ik2, the bone table and bind
        points, and lofted vertex positions / colours / weights. The reference
        is a frozen copy of dogmodel's original code (bottom of this file), so
        the check still means something after dogmodel delegates to the kit.

     node tools/units-kit-check.mjs                                          */
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log((ok ? "  PASS " : "  FAIL ") + msg); };

globalThis.window = globalThis; globalThis.CBZ = {};
const gait = require(path.join(ROOT, "src/units/kit/gait.js"));
const rig = require(path.join(ROOT, "src/units/kit/quadrig.js"));
const loftKit = require(path.join(ROOT, "src/units/kit/loft.js"));
const dog = require(path.join(ROOT, "src/city/dogmodel.js"));   // dims + BREEDS (+ gait, now or once delegated)

// ---------------------------------------------------------------- 1 the law
const ground = (x, z) => 0.15 * Math.sin(x * 0.4) + 0.1 * Math.cos(z * 0.3);
for (const tname of Object.keys(gait.TABLES)) {
  const T = gait.TABLES[tname];
  const D = dog.dims("shepherd", 0);
  for (const [label, v, turn] of [["walk", 1.0, 0], ["trot", 3.0, 0], ["gallop", 7.5, 0], ["turn", 2.0, 0.9]]) {
    const G = gait.create(D, T);
    let x = 0, z = 0, h = 0, worst = 0, stances = 0;
    const planted = G.feet.map(() => null);
    const w = { x: 0, z: 0 };
    for (let f = 0; f < 600; f++) {
      const dt = 1 / 120;
      h += turn * dt; x += Math.cos(h) * v * dt; z += Math.sin(h) * v * dt;
      gait.step(G, dt, v, turn, x, z, h, ground, ground(x, z));
      G.feet.forEach((F, i) => {
        if (F.sw) { planted[i] = null; return; }
        gait.toWorld(F.lx, F.lz, x, z, h, w);
        if (!planted[i]) { planted[i] = { x: w.x, z: w.z, cx: F.cx, cz: F.cz }; stances++; return; }
        worst = Math.max(worst, Math.hypot(w.x - planted[i].x, w.z - planted[i].z));
      });
    }
    check(worst < 1e-3 && stances > 4, tname + " " + label + ": planted feet hold their ground (worst slide " + (worst * 1000).toFixed(3) + " mm over " + stances + " stances)");
  }
}

// ---------------------------------------------------------------- 2 the origin: gait
{
  const R = refGait();
  let same = true, frames = 0, firstBad = "";
  for (const breed of ["shepherd", "pit", "mastiff", "lab", "mutt"]) {
    const D = dog.dims(breed, 3);
    const A = gait.create(D), B = R.create(D);
    let x = 0, z = 0, h = 0, t = 0;
    for (let f = 0; f < 480; f++) {
      const dt = 1 / 60; t += dt;
      const v = Math.max(0, 6 * Math.sin(t * 0.7)) + (t > 5 && t < 5.6 ? -0.5 : 0), turn = 1.2 * Math.sin(t * 1.3) * (t > 3 ? 1 : 0);
      h += turn * dt; x += Math.cos(h) * v * dt; z += Math.sin(h) * v * dt;
      gait.step(A, dt, v, turn, x, z, h, ground, ground(x, z));
      R.step(B, dt, v, turn, x, z, h, ground, ground(x, z));
      frames++;
      if (A.phase !== B.phase || A.mix.duty !== B.mix.duty || A.mix.f !== B.mix.f || A.mix.S !== B.mix.S || A.mix.lift !== B.mix.lift ||
        A.mix.wW !== B.mix.wW || A.mix.wT !== B.mix.wT || A.mix.wG !== B.mix.wG) { same = false; firstBad = firstBad || breed + " frame " + f + " mix"; }
      for (let i = 0; i < 4; i++) {
        const a = A.feet[i], b = B.feet[i];
        if (a.lx !== b.lx || a.ly !== b.ly || a.lz !== b.lz || a.sw !== b.sw || a.u !== b.u || a.cx !== b.cx || a.cz !== b.cz || a.wy !== b.wy) { same = false; firstBad = firstBad || breed + " frame " + f + " foot " + i; }
      }
      if (f === 240) { gait.reset(A, x, z, h, ground, 0.1); R.reset(B, x, z, h, ground, 0.1); }
    }
  }
  check(same, "DOG table reproduces dogmodel's gait bit for bit (" + frames + " frames, 5 breeds, walk..gallop, turns, a reset" + (firstBad ? "; first diff " + firstBad : "") + ")");
  if (dog.gait) {
    // whatever dogmodel exports today (its own or the kit) still equals the reference
    let same2 = true;
    const D = dog.dims("lab", 0), A = dog.gait.create(D), B = R.create(D);
    for (let f = 0; f < 300; f++) {
      const v = f < 150 ? f / 30 : 2, x = f * 0.02, h = f * 0.004;
      dog.gait.step(A, 1 / 60, v, 0.24, x, 0, h, ground, 0); R.step(B, 1 / 60, v, 0.24, x, 0, h, ground, 0);
      for (let i = 0; i < 4; i++) if (A.feet[i].lx !== B.feet[i].lx || A.feet[i].lz !== B.feet[i].lz || A.feet[i].ly !== B.feet[i].ly) same2 = false;
    }
    check(same2, "CBZ.dogGait (as dogmodel.js exports it) equals the reference");
  }
}
// ik2
{
  let same = true;
  const a = [0, 0], b = [0, 0];
  for (let i = 0; i < 2000; i++) {
    const s = i * 0.37;
    const args = [Math.sin(s) * 0.2, 0.5 + Math.cos(s * 1.3) * 0.1, Math.sin(s * 2.1) * 0.4, Math.cos(s * 0.7) * 0.3, 0.15 + (i % 7) * 0.02, 0.17 + (i % 5) * 0.03, i % 2 ? 1 : -1];
    rig.ik2(...args, a); refIk2(...args, b);
    if (a[0] !== b[0] || a[1] !== b[1]) same = false;
  }
  check(same, "quadRig.ik2 equals dogmodel's ik2 (2000 cases, both bends, out-of-reach targets)");
  if (dog.ik2) { const c = [0, 0], d = [0, 0]; dog.ik2(0, 0.5, 0.1, 0, 0.2, 0.22, -1, c); refIk2(0, 0.5, 0.1, 0, 0.2, 0.22, -1, d); check(c[0] === d[0] && c[1] === d[1], "CBZ.dogIK (as dogmodel.js exports it) equals the reference"); }
}
// bone table + bind points
{
  const T = rig.bones();
  const PARENT = [-1, 0, 0, 2, 3, 4, 4, 4, 1, 8, 9, 2, 2, 12, 13, 2, 15, 16, 1, 18, 19, 1, 21, 22];
  const LEGB = [[12, 13, 14], [15, 16, 17], [18, 19, 20], [21, 22, 23]];
  const BN = { root: 0, pelvis: 1, chest: 2, neck: 3, head: 4, jaw: 5, earL: 6, earR: 7, tail0: 8, tail1: 9, tail2: 10, hackle: 11 };
  check(JSON.stringify(T.PARENT) === JSON.stringify(PARENT) && JSON.stringify(T.LEGB) === JSON.stringify(LEGB) && Object.keys(BN).every((k) => T.BN[k] === BN[k]) && T.NB === 24,
    "quadRig.bones() default = the dog's 24-bone table (BN, LEGB, PARENT)");
  let same = true;
  for (const breed of ["shepherd", "pit", "mastiff", "lab", "mutt"]) {
    const D = dog.dims(breed, 2), A = T.bindPoints(D), B = refBindPoints(D);
    for (let i = 0; i < 24; i++) for (let k = 0; k < 3; k++) if (A[i][k] !== B[i][k]) same = false;
  }
  check(same, "quadRig bindPoints equal dogmodel's for all five breeds");
  const T2 = rig.bones({ neck: 3, tail: 6, hump: true, hackle: false });
  check(T2.NB === 4 + 3 + 2 + 2 + 6 + 1 + 12 - 1 && T2.LEGB.length === 4 && T2.PARENT.every((p, i) => p < i), "a custom spec (3 neck, 6 tail, hump) builds a valid parent-first table (" + T2.NB + " bones)");
}
// loft
{
  const sb = { Math, Object, Array, Number, String, JSON, Float32Array, Uint16Array, Uint32Array, Int32Array, Uint8Array, Map, Set, Symbol, Error, console };
  sb.window = sb; vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "src/vendor/three.r128.min.js"), "utf8"), sb);
  const Ref = refLoft(sb.THREE);
  const D = dog.dims("shepherd", 0), K = D.K;
  const st = [
    { x: -0.3, y: 0.45, rt: 0.08, rb: 0.09, w: 0.07, wts: [1, 1] },
    { x: -0.1, y: 0.47, rt: 0.07, rb: 0.08, w: 0.08, wts: [1, 0.5, 2, 0.5], hk: 0.4 },
    { x: 0.2, y: 0.5, rt: 0.1, rb: 0.16, w: 0.11, wts: [2, 1], hk: 1, sq: 0.85 },
    { x: 0.32, y: 0.55, z: 0.01, rt: 0.08, rb: 0.1, w: 0.09, wts: [2, 0.7, 3, 0.3], tag: "nose" },
  ];
  const col = (x, y, z, ca) => (ca > 0 ? 0xa36a33 : 0xc79c63) + Math.floor(y * 100);
  const A = loftKit.geo(), B = new Ref.Geo();
  loftKit.loft(A, st, 18, col, { capLen: 0.8, hkBone: 11 }); Ref.loft(B, st, 18, col, { capLen: 0.8 });
  loftKit.ellipsoid(A, 0.1, 0.2, 0.05, 0.02, 0.03, 0.025, 10, col, [4, 1]); Ref.ellipsoid(B, 0.1, 0.2, 0.05, 0.02, 0.03, 0.025, 10, col, [4, 1]);
  loftKit.loft(A, st.slice(0, 2), 8, col, { capA: false, side: [0, 1, 0], hkBone: 11 }); Ref.loft(B, st.slice(0, 2), 8, col, { capA: false, side: [0, 1, 0] });
  const eq = (p, q) => p.length === q.length && p.every((v, i) => v === q[i]);
  check(A.n === B.n && eq(A.p, B.p) && eq(A.ix, B.ix) && eq(A.si, B.si) && eq(A.sw, B.sw), "loftKit loft/ellipsoid: " + A.n + " vertices, positions, indices and skin weights equal dogmodel's (hackle blend on bone 11)");
  check(eq(A.c, B.c), "loftKit vertex colours equal THREE r128 Color.setHex");
  void K;
}

console.log("\n" + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);

// ======================================================================
//  FROZEN REFERENCE — city/dogmodel.js's original gait / ik2 / bind points /
//  loft (2026-10-09, dogs1009b), verbatim but for packaging. Do not "fix" it:
//  it is the measuring stick the kit is held to.
// ======================================================================
function refIk2(jx, jy, tx, ty, a, b, bend, out) {
  const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
  let dx = tx - jx, dy = ty - jy, d = Math.hypot(dx, dy);
  const dmin = Math.abs(a - b) + 1e-4, dmax = a + b - 1e-4;
  if (d < 1e-6) { dx = 0; dy = -1; d = dmin; }
  const dc = clamp(d, dmin, dmax);
  const base = Math.atan2(dy, dx);
  const A = Math.acos(clamp((a * a + dc * dc - b * b) / (2 * a * dc), -1, 1));
  const t1 = base + bend * A;
  const ex = jx + a * Math.cos(t1), ey = jy + a * Math.sin(t1);
  out[0] = t1; out[1] = Math.atan2(ty - ey, tx - ex);
  return out;
}
function refBindPoints(D) {
  const LEGB = [[12, 13, 14], [15, 16, 17], [18, 19, 20], [21, 22, 23]];
  const P = new Array(24);
  P[0] = [0, 0, 0]; P[1] = [D.hipX, D.hipH, 0]; P[2] = [D.shX, D.sh, 0];
  P[3] = [D.neckB.x, D.neckB.y, 0]; P[4] = [D.headP.x, D.headP.y, 0]; P[5] = [D.jawP.x, D.jawP.y, 0];
  P[6] = [D.earP.x, D.earP.y, -D.earP.z]; P[7] = [D.earP.x, D.earP.y, D.earP.z];
  P[8] = [D.tailP.x, D.tailP.y, 0]; P[9] = [D.tailP.x - D.tailL * 0.33, D.tailP.y, 0]; P[10] = [D.tailP.x - D.tailL * 0.66, D.tailP.y, 0];
  P[11] = [D.hackleP.x, D.hackleP.y, 0];
  for (let L = 0; L < 4; L++) {
    const front = L < 2, z = (L % 2 === 0 ? -1 : 1) * (front ? D.legZf : D.legZh);
    const J = front ? D.FJ : D.HJ, a = front ? D.fa : D.ha, b = front ? D.fb : D.hb;
    const ids = LEGB[L];
    P[ids[0]] = [J.x, J.y, z]; P[ids[1]] = [J.x, J.y - a, z]; P[ids[2]] = [J.x, J.y - a - b, z];
  }
  return P;
}
function refGait() {
  const PI = Math.PI;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function frac(x) { return x - Math.floor(x); }
  function ease(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  const OFFS = { walk: [0.25, 0.75, 0.00, 0.50], trot: [0.25, 0.75, -0.25, 0.25], gallop: [0.25, 0.37, -0.25, -0.13] };
  function gaitMix(v, K, legLen, out) {
    out = out || { off: [0, 0, 0, 0] };
    const k = Math.sqrt(K), av = Math.abs(v);
    const wG = sstep(4.0 * k, 5.2 * k, av), wW = 1 - sstep(1.3 * k, 2.0 * k, av);
    const wT = Math.max(0, 1 - wW - wG);
    out.wW = wW; out.wT = wT; out.wG = wG;
    out.duty = wW * 0.62 + wT * 0.42 + wG * 0.32;
    for (let i = 0; i < 4; i++) out.off[i] = wW * OFFS.walk[i] + wT * OFFS.trot[i] + wG * OFFS.gallop[i];
    let f = Math.min(3.8 / k, (1.05 + 0.38 * av / K) / k);
    const sMax = 0.62 * (legLen || 0.4);
    if (av > 0 && out.duty * av / f > sMax) f = out.duty * av / sMax;
    out.f = f;
    out.S = av > 0 ? out.duty * av / f : 0;
    out.lift = (0.05 * wW + 0.08 * wT + 0.11 * wG) * K;
    return out;
  }
  function toWorld(lx, lz, gx, gz, h, out) { const c = Math.cos(h), s = Math.sin(h); out.x = gx + c * lx - s * lz; out.z = gz + s * lx + c * lz; return out; }
  function toLocal(wx, wz, gx, gz, h, out) { const c = Math.cos(h), s = Math.sin(h), dx = wx - gx, dz = wz - gz; out.x = c * dx + s * dz; out.z = -s * dx + c * dz; return out; }
  function gaitCreate(D) {
    const G = { D: D, phase: 0, mix: gaitMix(0, D.K, D.legLen), feet: [], moving: false };
    for (let i = 0; i < 4; i++) G.feet.push({ i: i, sw: false, u: 0, init: false, cx: 0, cz: 0, cy: 0, lx: D.feet[i].x, ly: 0, lz: D.feet[i].z, sx: 0, sy: 0, sz: 0, tx: 0, tz: 0, wy: 0, stanceT: 0 });
    return G;
  }
  const _w = { x: 0, z: 0 }, _l = { x: 0, z: 0 };
  function plantAt(F, lx, lz, gx, gz, h, ground, gy) {
    toWorld(lx, lz, gx, gz, h, _w); F.cx = _w.x; F.cz = _w.z;
    const gyw = ground ? ground(_w.x, _w.z) : null;
    F.wy = (gyw == null || !isFinite(gyw)) ? gy : gyw;
  }
  function gaitStep(G, dt, v, turn, gx, gz, h, ground, gy) {
    const D = G.D, M = gaitMix(v, D.K, D.legLen, G.mix);
    gy = gy || 0;
    const moving = Math.abs(v) > 0.08 || Math.abs(turn) > 0.35;
    G.moving = moving;
    for (let i = 0; i < 4; i++) { const F = G.feet[i]; if (!F.init) { F.init = true; F.sw = false; plantAt(F, D.feet[i].x, D.feet[i].z, gx, gz, h, ground, gy); } }
    if (moving) {
      const f = Math.abs(v) > 0.08 ? M.f : 1.5 / Math.sqrt(D.K);
      const S = Math.abs(v) > 0.08 ? M.S * (v < 0 ? -1 : 1) : 0;
      G.phase = frac(G.phase + f * dt);
      for (let i = 0; i < 4; i++) {
        const F = G.feet[i], base = D.feet[i];
        const ph = frac(G.phase + M.off[i]);
        const stance = ph < M.duty;
        if (stance) {
          if (F.sw) { F.sw = false; F.u = 0; plantAt(F, F.lx, F.lz, gx, gz, h, ground, gy); F.stanceT = 0; }
          toLocal(F.cx, F.cz, gx, gz, h, _l);
          F.lx = _l.x; F.lz = _l.z; F.ly = clamp(F.wy - gy, -0.25, 0.25); F.stanceT += dt;
        } else {
          const u = (ph - M.duty) / (1 - M.duty);
          if (!F.sw) { F.sw = true; F.sx = F.lx; F.sz = F.lz; F.sy = F.ly; }
          F.tx = base.x + S * 0.5; F.tz = base.z;
          const e = ease(u);
          F.u = u;
          F.lx = lerp(F.sx, F.tx, e); F.lz = lerp(F.sz, F.tz, e);
          F.ly = lerp(F.sy || 0, 0, e) + M.lift * Math.sin(PI * u);
        }
      }
    } else {
      let swinging = 0;
      for (let i = 0; i < 4; i++) {
        const F = G.feet[i], base = D.feet[i];
        if (F.sw) {
          F.u = Math.min(1, F.u + dt * 2.6);
          F.tx = base.x; F.tz = base.z;
          const e = ease(F.u);
          F.lx = lerp(F.sx, F.tx, e); F.lz = lerp(F.sz, F.tz, e);
          F.ly = lerp(F.sy || 0, 0, e) + 0.045 * D.K * Math.sin(PI * F.u);
          if (F.u >= 1) { F.sw = false; plantAt(F, F.lx, F.lz, gx, gz, h, ground, gy); } else swinging++;
        } else { toLocal(F.cx, F.cz, gx, gz, h, _l); F.lx = _l.x; F.lz = _l.z; F.ly = clamp(F.wy - gy, -0.25, 0.25); }
      }
      if (!swinging) {
        let worst = -1, wd = 0.07 * D.K;
        for (let i = 0; i < 4; i++) { const F = G.feet[i], base = D.feet[i]; const dd = Math.hypot(F.lx - base.x, F.lz - base.z); if (dd > wd) { wd = dd; worst = i; } }
        if (worst >= 0) { const F = G.feet[worst]; F.sw = true; F.u = 0; F.sx = F.lx; F.sz = F.lz; F.sy = F.ly; }
      }
    }
    return G;
  }
  function gaitReset(G, gx, gz, h, ground, gy) {
    const D = G.D;
    for (let i = 0; i < 4; i++) { const F = G.feet[i]; F.sw = false; F.u = 0; F.init = true; F.lx = D.feet[i].x; F.lz = D.feet[i].z; F.ly = 0; plantAt(F, F.lx, F.lz, gx, gz, h, ground, gy || 0); }
  }
  return { create: gaitCreate, step: gaitStep, reset: gaitReset, mix: gaitMix };
}
function refLoft(THREE) {
  const TAU = Math.PI * 2;
  const HACKLE = 11;
  function Geo() { this.p = []; this.c = []; this.si = []; this.sw = []; this.ix = []; this.n = 0; }
  const _cc = new THREE.Color();
  Geo.prototype.vert = function (x, y, z, hex, wts) {
    this.p.push(x, y, z);
    _cc.setHex(hex); this.c.push(_cc.r, _cc.g, _cc.b);
    let s = 0; for (let k = 1; k < wts.length; k += 2) s += wts[k];
    s = s || 1;
    for (let k = 0; k < 4; k++) {
      const bi = k * 2 < wts.length ? wts[k * 2] : 0, bw = k * 2 < wts.length ? wts[k * 2 + 1] / s : 0;
      this.si.push(bi); this.sw.push(bw);
    }
    return this.n++;
  };
  function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; return v; }
  function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function loft(G, st, S, colour, opts) {
    opts = opts || {};
    const side0 = opts.side || [0, 0, 1];
    const list = st.slice();
    function tangentAt(arr, i) { const a = arr[Math.max(0, i - 1)], b = arr[Math.min(arr.length - 1, i + 1)]; return norm3([b.x - a.x, b.y - a.y, (b.z || 0) - (a.z || 0)]); }
    function capRings(endIdx, dir) {
      const s0 = list[endIdx], t = tangentAt(list, endIdx);
      const len = Math.min(s0.rt, s0.rb, s0.w) * (opts.capLen || 1.0);
      const out = [];
      const ks = [0.78, 0.48, 0.12], ds = [0.32, 0.66, 0.95];
      for (let k = 0; k < 3; k++) out.push(Object.assign({}, s0, { x: s0.x + t[0] * len * ds[k] * dir, y: s0.y + t[1] * len * ds[k] * dir, z: (s0.z || 0) + t[2] * len * ds[k] * dir, rt: s0.rt * ks[k], rb: s0.rb * ks[k], w: s0.w * ks[k], cap: k + 1 }));
      return out;
    }
    let rings = list;
    if (opts.capA !== false) rings = capRings(0, -1).reverse().concat(rings);
    if (opts.capB !== false) rings = rings.concat(capRings(list.length - 1, 1));
    const base = [];
    for (let i = 0; i < rings.length; i++) {
      const R = rings[i];
      const t = tangentAt(rings, i);
      let up = cross3(side0, t);
      if (Math.hypot(up[0], up[1], up[2]) < 1e-4) up = [0, 1, 0];
      norm3(up);
      const sd = norm3(cross3(t, up));
      const e = R.sq || 1;
      base.push(G.n);
      for (let j = 0; j < S; j++) {
        const a = TAU * j / S, ca = Math.cos(a), sa = Math.sin(a);
        const pc = Math.sign(ca) * Math.pow(Math.abs(ca), e), ps = Math.sign(sa) * Math.pow(Math.abs(sa), e);
        const r = ca >= 0 ? R.rt : R.rb;
        const x = R.x + up[0] * pc * r + sd[0] * ps * R.w;
        const y = R.y + up[1] * pc * r + sd[1] * ps * R.w;
        const z = (R.z || 0) + up[2] * pc * r + sd[2] * ps * R.w;
        let wts = R.wts;
        if (R.hk && ca > 0.5) {
          const hw = R.hk * (ca - 0.5) / 0.5 * 0.85, ow = [];
          for (let k = 0; k < wts.length; k += 2) ow.push(wts[k], wts[k + 1] * (1 - hw));
          ow.push(HACKLE, hw); wts = ow;
        }
        G.vert(x, y, z, colour(x, y, z, ca, sa, R, i / (rings.length - 1)), wts);
      }
    }
    for (let i = 0; i < rings.length - 1; i++) {
      const A = base[i], Bb = base[i + 1];
      for (let j = 0; j < S; j++) { const j1 = (j + 1) % S; G.ix.push(A + j, A + j1, Bb + j); G.ix.push(A + j1, Bb + j1, Bb + j); }
    }
  }
  function ellipsoid(G, cx, cy, cz, rx, ry, rz, S, colour, wts) {
    const st = [], n = 5;
    for (let i = 0; i < n; i++) { const t = -0.86 + 1.72 * i / (n - 1), k = Math.sqrt(1 - t * t); st.push({ x: cx + t * rx, y: cy, z: cz, rt: ry * k, rb: ry * k, w: rz * k, wts: wts }); }
    loft(G, st, S, colour, { capLen: 0.55 });
  }
  return { Geo, loft, ellipsoid };
}
