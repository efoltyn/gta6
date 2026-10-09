/* ============================================================
   city/dogmodel.js — ONE DOG BODY, every dog in the game.

   OWNER (2026-10-09): "They look very blocky and fake right now. They don't
   need to be too real, but make them act more real."

   The old dog was nineteen axis-aligned boxes on four straight posts that
   slid back and forth under a rigid plank. This file is the replacement, the
   same way the marine animals were rebuilt: lofted shells, not stacked
   boxes. One body, five breeds, one gait.

   THE BODY. A single SkinnedMesh per dog on ONE shared geometry per breed
   variant (one draw call a dog, shadows included), on a 24-bone skeleton:
     root · pelvis · chest · neck · head · jaw · ears · 3 tail bones ·
     hackle ridge · 3 bones per leg (front: humerus / forearm / pastern+paw,
     hind: thigh / shin / hock+paw).
   The shell is lofted along a curved spine (rump, loin, tuck-up waist, deep
   ribcage, prosternum, then up the neck), the head is lofted skull -> stop ->
   muzzle with a separate lower jaw, ears are pricked, rose or drop, the tail
   is a brush, whip or otter tail. Coat pattern (saddle, mask, blaze, socks,
   patches, brindle) is baked into vertex colours, so one material serves
   every dog.

   BREEDS (proportions + coat, nothing else):
     shepherd  police K9                 tan under a black saddle, black mask
     pit       gang yard dog             blue-grey or brindle, white blaze
     mastiff   heavy guard dog           fawn, black mask and ears
     lab       pet                       yellow, black or chocolate
     mutt      stray                     seeded mix of the above, patched

   THE GAIT (pure maths, no THREE: tools can load it in node). Every foot
   PLANTS: at touchdown its world contact point is recorded and, for the whole
   stance, the foot is that point brought back into the body frame. A foot in
   stance therefore cannot slide, whatever the body does (speed change, turn,
   stop). Swing feet arc from where they lifted to a landing ahead of the
   shoulder/hip. Footfall timing blends with speed:
     walk    lateral-sequence four-beat (HL, FL, HR, FR), duty 0.62
     trot    diagonal pairs (FL+HR, FR+HL), duty 0.42
     gallop  transverse gallop (HL, HR, then FL, FR), duty 0.32, with spine
             flexion/extension and pitch
   Cadence and stride come from the measured speed (like the human mover):
   stance sweep = duty * speed / cadence, so the planted foot moves backward
   in the body frame at exactly the body's speed. At rest the gait stops and
   a foot that was left far from under the body takes a corrective step.
   Legs are 2-bone IK (elbow back, stifle forward) with the pastern/hock set
   by the gait phase (it folds in swing).

   POSTURES AND BODY LANGUAGE (all eased; the dog's state shows here, not in
   text): stand / sit / lie / dead; alert (ears up, tail up), aggression
   (crouch, hackles, head low, ears pinned), fear (tail tucked, ears back,
   rump low), happy (tail wag, relaxed ears, pant), sniff (nose to the
   ground), bark, bite, shake (worry), look-at.

   PUBLIC
     CBZ.dogGait  = { create(dims), step(G, dt, v, turn, gx, gz, h, ground),
                      mix(v, K, legLen, out), toWorld, toLocal, OFFS }
     CBZ.dogModel = { BREEDS, dims(breed, seed), build(breed, seed) -> rig,
                      animate(rig, dt, ctrl), collar(rig, hex|null), mouth(rig) }
   Node: module.exports = { gait: CBZ.dogGait, dims } (tools / node checks).
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  const PI = Math.PI, TAU = PI * 2, HALF = PI / 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function frac(x) { return x - Math.floor(x); }
  function wrapPi(a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; }
  function ease(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function approach(cur, want, rate, dt) { return cur + (want - cur) * Math.min(1, rate * dt); }
  function mkRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // ==========================================================================
  //  BREEDS — proportions in metres, at the breed's own withers height.
  // ==========================================================================
  const BREEDS = {
    shepherd: {
      name: "Shepherd", withers: 0.62, sh: 0.45, hipH: 0.45, bodyL: 0.58,
      chestRt: 0.10, chestRb: 0.16, chestW: 0.115, waistRt: 0.075, waistRb: 0.068, waistW: 0.085,
      rumpR: 0.10, rumpW: 0.10, neckR: 0.072, neckLen: 0.27, neckAng: 0.92,
      skullR: 0.072, skullW: 0.068, headL: 0.13, headAng: -0.22, muzzleL: 0.115, muzzleR: 0.036, muzzleW: 0.034,
      ear: "prick", earL: 0.115, earW: 0.06, tail: "brush", tailL: 0.42, tailR: 0.04, tailRest: 1.05,
      fa: 0.19, fb: 0.19, fc: 0.10, ha: 0.21, hb: 0.21, hc: 0.14, legR: 1.0, pawR: 0.024,
      bite: 12, hp: 55, coats: ["sable"],
    },
    pit: {
      name: "Pit", withers: 0.48, sh: 0.345, hipH: 0.35, bodyL: 0.45,
      chestRt: 0.09, chestRb: 0.13, chestW: 0.125, waistRt: 0.07, waistRb: 0.06, waistW: 0.085,
      rumpR: 0.085, rumpW: 0.09, neckR: 0.075, neckLen: 0.17, neckAng: 0.78,
      skullR: 0.072, skullW: 0.08, headL: 0.11, headAng: -0.12, muzzleL: 0.07, muzzleR: 0.042, muzzleW: 0.046,
      ear: "rose", earL: 0.06, earW: 0.05, tail: "whip", tailL: 0.25, tailR: 0.026, tailRest: 0.55,
      fa: 0.14, fb: 0.15, fc: 0.075, ha: 0.16, hb: 0.16, hc: 0.105, legR: 1.25, pawR: 0.022,
      bite: 15, hp: 50, coats: ["blue", "brindle"],
    },
    mastiff: {
      name: "Mastiff", withers: 0.72, sh: 0.52, hipH: 0.53, bodyL: 0.66,
      chestRt: 0.13, chestRb: 0.19, chestW: 0.165, waistRt: 0.10, waistRb: 0.095, waistW: 0.12,
      rumpR: 0.13, rumpW: 0.125, neckR: 0.105, neckLen: 0.22, neckAng: 0.72,
      skullR: 0.10, skullW: 0.10, headL: 0.16, headAng: -0.18, muzzleL: 0.085, muzzleR: 0.058, muzzleW: 0.06,
      ear: "flop", earL: 0.10, earW: 0.08, tail: "whip", tailL: 0.40, tailR: 0.04, tailRest: 1.0,
      fa: 0.21, fb: 0.22, fc: 0.10, ha: 0.24, hb: 0.23, hc: 0.15, legR: 1.45, pawR: 0.03,
      bite: 18, hp: 75, coats: ["fawn"],
    },
    lab: {
      name: "Lab", withers: 0.57, sh: 0.41, hipH: 0.42, bodyL: 0.55,
      chestRt: 0.10, chestRb: 0.145, chestW: 0.125, waistRt: 0.085, waistRb: 0.075, waistW: 0.095,
      rumpR: 0.10, rumpW: 0.10, neckR: 0.08, neckLen: 0.23, neckAng: 0.85,
      skullR: 0.075, skullW: 0.075, headL: 0.13, headAng: -0.2, muzzleL: 0.10, muzzleR: 0.04, muzzleW: 0.04,
      ear: "flop", earL: 0.09, earW: 0.065, tail: "otter", tailL: 0.38, tailR: 0.045, tailRest: 0.7,
      fa: 0.17, fb: 0.18, fc: 0.09, ha: 0.19, hb: 0.20, hc: 0.13, legR: 1.1, pawR: 0.025,
      bite: 10, hp: 50, coats: ["yellow", "black", "choc"],
    },
    mutt: {
      name: "Mutt", withers: 0.52, sh: 0.375, hipH: 0.38, bodyL: 0.50,
      chestRt: 0.09, chestRb: 0.13, chestW: 0.105, waistRt: 0.072, waistRb: 0.062, waistW: 0.08,
      rumpR: 0.09, rumpW: 0.09, neckR: 0.068, neckLen: 0.22, neckAng: 0.88,
      skullR: 0.068, skullW: 0.066, headL: 0.12, headAng: -0.2, muzzleL: 0.10, muzzleR: 0.034, muzzleW: 0.034,
      ear: "flop", earL: 0.085, earW: 0.055, tail: "brush", tailL: 0.34, tailR: 0.033, tailRest: 0.8,
      fa: 0.155, fb: 0.165, fc: 0.085, ha: 0.175, hb: 0.18, hc: 0.12, legR: 0.95, pawR: 0.022,
      bite: 9, hp: 40, coats: ["patched", "tan", "black-tan", "white"],
    },
  };

  // Full dims for one dog: the breed's numbers, seeded jitter for mutts, and
  // every bind point the skeleton and the gait share.
  function dims(breedKey, seed) {
    const base = BREEDS[breedKey] || BREEDS.mutt;
    const r = mkRng(((seed | 0) * 2654435761) ^ 0x51ed);
    const D = Object.assign({}, base);
    D.key = BREEDS[breedKey] ? breedKey : "mutt";
    if (D.key === "mutt") {
      // a mutt is SOMETHING crossed with something: scale it, stretch it,
      // pick its ears and tail.
      const s = 0.82 + r() * 0.4, len = 0.92 + r() * 0.18, girth = 0.9 + r() * 0.25;
      ["withers", "sh", "hipH", "fa", "fb", "fc", "ha", "hb", "hc", "neckLen", "headL", "muzzleL", "earL", "tailL", "pawR"].forEach(function (k) { D[k] *= s; });
      ["chestRt", "chestRb", "chestW", "waistRt", "waistRb", "waistW", "rumpR", "rumpW", "neckR", "skullR", "skullW", "muzzleR", "muzzleW", "tailR"].forEach(function (k) { D[k] *= s * girth; });
      D.bodyL *= s * len;
      D.ear = r() < 0.45 ? "prick" : (r() < 0.75 ? "flop" : "rose");
      D.tail = r() < 0.6 ? "brush" : "whip";
      D.bite = Math.round(D.bite * s * girth);
    }
    const K = D.K = D.withers / 0.62;
    D.hipX = -D.bodyL / 2; D.shX = D.bodyL / 2;
    // bind points (model space: nose +X, up +Y, ground y = 0)
    D.neckB = { x: D.shX + 0.07 * K, y: D.sh + 0.08 * K };
    D.headP = { x: D.neckB.x + Math.cos(D.neckAng) * D.neckLen, y: D.neckB.y + Math.sin(D.neckAng) * D.neckLen };
    D.u = { x: Math.cos(D.headAng), y: Math.sin(D.headAng) };
    D.jawP = { x: D.headP.x + D.u.x * D.headL * 0.55, y: D.headP.y + D.u.y * D.headL * 0.55 - D.skullR * 0.72 };
    D.earP = { x: D.headP.x + D.u.x * 0.035 * K, y: D.headP.y + D.skullR * 0.8, z: D.skullW * (D.ear === "prick" ? 0.52 : 0.78) };
    D.tailP = { x: D.hipX - 0.09 * K, y: D.hipH + 0.06 * K };
    D.hackleP = { x: D.shX - 0.08 * K, y: D.sh + D.chestRt * 0.9 };
    D.legZf = D.chestW * 0.62; D.legZh = D.rumpW * 0.62;
    D.FJ = { x: D.shX - 0.01 * K, y: D.sh }; D.HJ = { x: D.hipX + 0.01 * K, y: D.hipH };
    D.legLen = Math.min(D.fa + D.fb, D.ha + D.hb);
    // the four feet, FL FR HL HR (L = -z). Neutral stance under the body.
    D.feet = [
      { x: D.FJ.x + 0.02 * K, z: -D.legZf, front: true },
      { x: D.FJ.x + 0.02 * K, z: D.legZf, front: true },
      { x: D.HJ.x - 0.03 * K, z: -D.legZh, front: false },
      { x: D.HJ.x - 0.03 * K, z: D.legZh, front: false },
    ];
    const tip = D.headL + 0.012 * K + D.muzzleL;
    D.mouth = { x: D.headP.x + D.u.x * tip, y: D.headP.y + D.u.y * tip - D.skullR * 0.35, z: 0 };
    return D;
  }

  // ==========================================================================
  //  THE GAIT — pure. Feet plant; the body carries the cycle.
  // ==========================================================================
  // per-foot phase offsets [FL, FR, HL, HR]; laid out so walk -> trot -> gallop
  // blend by sliding the hinds and the right pair, never by a wrap-around.
  const OFFS = {
    walk:   [0.25, 0.75, 0.00, 0.50],     // lateral sequence: HL FL HR FR
    trot:   [0.25, 0.75, -0.25, 0.25],    // FL+HR, FR+HL
    gallop: [0.25, 0.37, -0.25, -0.13],   // HL HR ... FL FR
  };
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
  // model-local (lx, lz) <-> world for a body at (gx, gz) heading h (nose = (cos h, sin h))
  function toWorld(lx, lz, gx, gz, h, out) {
    const c = Math.cos(h), s = Math.sin(h);
    out.x = gx + c * lx - s * lz; out.z = gz + s * lx + c * lz; return out;
  }
  function toLocal(wx, wz, gx, gz, h, out) {
    const c = Math.cos(h), s = Math.sin(h), dx = wx - gx, dz = wz - gz;
    out.x = c * dx + s * dz; out.z = -s * dx + c * dz; return out;
  }
  function gaitCreate(D) {
    const G = { D: D, phase: 0, mix: gaitMix(0, D.K, D.legLen), feet: [], moving: false };
    for (let i = 0; i < 4; i++) {
      G.feet.push({ i: i, sw: false, u: 0, init: false, cx: 0, cz: 0, cy: 0,
        lx: D.feet[i].x, ly: 0, lz: D.feet[i].z, sx: 0, sy: 0, sz: 0, tx: 0, tz: 0, wy: 0, stanceT: 0 });
    }
    return G;
  }
  const _w = { x: 0, z: 0 }, _l = { x: 0, z: 0 };
  function plantAt(F, lx, lz, gx, gz, h, ground, gy) {
    toWorld(lx, lz, gx, gz, h, _w);
    F.cx = _w.x; F.cz = _w.z;
    // the contact's ABSOLUTE height: a planted paw stays on its ground while
    // the body rises or falls over a slope
    const gyw = ground ? ground(_w.x, _w.z) : null;
    F.wy = (gyw == null || !isFinite(gyw)) ? gy : gyw;
  }
  // One frame. v = forward speed (m/s, measured), turn = yaw rate (rad/s),
  // (gx, gz, h) = the body's world placement this frame, ground(x, z) -> y or
  // null, gy = the body's own ground y. Writes each foot's LOCAL target
  // (F.lx, F.ly, F.lz) and its swing-progress; returns G.
  function gaitStep(G, dt, v, turn, gx, gz, h, ground, gy) {
    const D = G.D, M = gaitMix(v, D.K, D.legLen, G.mix);
    gy = gy || 0;
    const moving = Math.abs(v) > 0.08 || Math.abs(turn) > 0.35;
    G.moving = moving;
    for (let i = 0; i < 4; i++) {
      const F = G.feet[i];
      if (!F.init) { F.init = true; F.sw = false; plantAt(F, D.feet[i].x, D.feet[i].z, gx, gz, h, ground, gy); }
    }
    if (moving) {
      // turning on the spot still steps: a short slow cycle with no stride
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
      // AT REST: swings finish, then the worst-placed foot re-steps under the body
      let swinging = 0;
      for (let i = 0; i < 4; i++) {
        const F = G.feet[i], base = D.feet[i];
        if (F.sw) {
          F.u = Math.min(1, F.u + dt * 2.6);
          F.tx = base.x; F.tz = base.z;
          const e = ease(F.u);
          F.lx = lerp(F.sx, F.tx, e); F.lz = lerp(F.sz, F.tz, e);
          F.ly = lerp(F.sy || 0, 0, e) + 0.045 * D.K * Math.sin(PI * F.u);
          if (F.u >= 1) { F.sw = false; plantAt(F, F.lx, F.lz, gx, gz, h, ground, gy); }
          else swinging++;
        } else {
          toLocal(F.cx, F.cz, gx, gz, h, _l);
          F.lx = _l.x; F.lz = _l.z; F.ly = clamp(F.wy - gy, -0.25, 0.25);
        }
      }
      if (!swinging) {
        let worst = -1, wd = 0.07 * D.K;
        for (let i = 0; i < 4; i++) {
          const F = G.feet[i], base = D.feet[i];
          const dd = Math.hypot(F.lx - base.x, F.lz - base.z);
          if (dd > wd) { wd = dd; worst = i; }
        }
        if (worst >= 0) { const F = G.feet[worst]; F.sw = true; F.u = 0; F.sx = F.lx; F.sz = F.lz; F.sy = F.ly; }
      }
    }
    return G;
  }
  // re-anchor every foot where the body now stands (after a sit/lie/teleport)
  function gaitReset(G, gx, gz, h, ground, gy) {
    const D = G.D;
    for (let i = 0; i < 4; i++) {
      const F = G.feet[i];
      F.sw = false; F.u = 0; F.init = true;
      F.lx = D.feet[i].x; F.lz = D.feet[i].z; F.ly = 0;
      plantAt(F, F.lx, F.lz, gx, gz, h, ground, gy || 0);
    }
  }
  CBZ.dogGait = { create: gaitCreate, step: gaitStep, reset: gaitReset, mix: gaitMix, toWorld: toWorld, toLocal: toLocal, OFFS: OFFS };

  // 2-bone IK in the sagittal plane: root (jx, jy) -> joint -> end (tx, ty).
  // bend -1 puts the joint BEHIND the line (the elbow), +1 in front (the stifle).
  // Writes the two absolute bone direction angles into out[0], out[1].
  function ik2(jx, jy, tx, ty, a, b, bend, out) {
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
  CBZ.dogIK = ik2;

  if (typeof module !== "undefined" && module.exports) module.exports = { gait: CBZ.dogGait, dims: dims, BREEDS: BREEDS, ik2: ik2 };

  const THREE = W.THREE;
  if (!THREE) return;

  // ==========================================================================
  //  THE SKELETON
  // ==========================================================================
  const BN = { root: 0, pelvis: 1, chest: 2, neck: 3, head: 4, jaw: 5, earL: 6, earR: 7, tail0: 8, tail1: 9, tail2: 10, hackle: 11 };
  const LEGB = [[12, 13, 14], [15, 16, 17], [18, 19, 20], [21, 22, 23]];   // FL FR HL HR: upper, lower, foot
  const PARENT = [-1, 0, 0, 2, 3, 4, 4, 4, 1, 8, 9, 2, 2, 12, 13, 2, 15, 16, 1, 18, 19, 1, 21, 22];
  const NB = 24;

  function bindPoints(D) {
    const K = D.K, P = new Array(NB);
    P[0] = [0, 0, 0];
    P[1] = [D.hipX, D.hipH, 0];
    P[2] = [D.shX, D.sh, 0];
    P[3] = [D.neckB.x, D.neckB.y, 0];
    P[4] = [D.headP.x, D.headP.y, 0];
    P[5] = [D.jawP.x, D.jawP.y, 0];
    P[6] = [D.earP.x, D.earP.y, -D.earP.z];
    P[7] = [D.earP.x, D.earP.y, D.earP.z];
    P[8] = [D.tailP.x, D.tailP.y, 0];
    P[9] = [D.tailP.x - D.tailL * 0.33, D.tailP.y, 0];
    P[10] = [D.tailP.x - D.tailL * 0.66, D.tailP.y, 0];
    P[11] = [D.hackleP.x, D.hackleP.y, 0];
    for (let L = 0; L < 4; L++) {
      const front = L < 2, z = (L % 2 === 0 ? -1 : 1) * (front ? D.legZf : D.legZh);
      const J = front ? D.FJ : D.HJ, a = front ? D.fa : D.ha, b = front ? D.fb : D.hb;
      const ids = LEGB[L];
      P[ids[0]] = [J.x, J.y, z];
      P[ids[1]] = [J.x, J.y - a, z];
      P[ids[2]] = [J.x, J.y - a - b, z];
    }
    void K;
    return P;
  }

  // ==========================================================================
  //  GEOMETRY — lofted shells, vertex-coloured, rigidly or blend skinned
  // ==========================================================================
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

  // stations: { x, y, z, rt, rb, w, sq?, wts, tag?, hk? }  (rt = radius toward
  // "up", rb = away from it, w = sideways). capA / capB close the ends.
  function loft(G, st, S, colour, opts) {
    opts = opts || {};
    const side0 = opts.side || [0, 0, 1];
    const list = st.slice();
    function tangentAt(arr, i) {
      const a = arr[Math.max(0, i - 1)], b = arr[Math.min(arr.length - 1, i + 1)];
      return norm3([b.x - a.x, b.y - a.y, (b.z || 0) - (a.z || 0)]);
    }
    function capRings(endIdx, dir) {
      const s0 = list[endIdx], t = tangentAt(list, endIdx);
      const len = Math.min(s0.rt, s0.rb, s0.w) * (opts.capLen || 1.0);
      const out = [];
      const ks = [0.78, 0.48, 0.12], ds = [0.32, 0.66, 0.95];
      for (let k = 0; k < 3; k++) {
        out.push(Object.assign({}, s0, {
          x: s0.x + t[0] * len * ds[k] * dir, y: s0.y + t[1] * len * ds[k] * dir, z: (s0.z || 0) + t[2] * len * ds[k] * dir,
          rt: s0.rt * ks[k], rb: s0.rb * ks[k], w: s0.w * ks[k], cap: k + 1,
        }));
      }
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
          ow.push(BN.hackle, hw); wts = ow;
        }
        G.vert(x, y, z, colour(x, y, z, ca, sa, R, i / (rings.length - 1)), wts);
      }
    }
    for (let i = 0; i < rings.length - 1; i++) {
      const A = base[i], Bb = base[i + 1];
      for (let j = 0; j < S; j++) {
        const j1 = (j + 1) % S;
        G.ix.push(A + j, A + j1, Bb + j);
        G.ix.push(A + j1, Bb + j1, Bb + j);
      }
    }
  }
  function ellipsoid(G, cx, cy, cz, rx, ry, rz, S, colour, wts) {
    const st = [], n = 5;
    for (let i = 0; i < n; i++) {
      const t = -0.86 + 1.72 * i / (n - 1), k = Math.sqrt(1 - t * t);
      st.push({ x: cx + t * rx, y: cy, z: cz, rt: ry * k, rb: ry * k, w: rz * k, wts: wts });
    }
    loft(G, st, S, colour, { capLen: 0.55 });
  }

  // ---- COATS: (part, point, up-ness, side-ness) -> hex ---------------------
  function coatFn(D, coat, seed) {
    const r = mkRng((seed | 0) ^ 0xC0A7);
    const K = D.K;
    const pal = {
      sable: { base: 0xa36a33, dark: 0x1c1813, light: 0xc79c63, mask: 0x1a1612 },
      blue: { base: 0x5c6068, dark: 0x45484f, light: 0xe2ddd3, mask: 0x4a4d54 },
      brindle: { base: 0x6e4c2d, dark: 0x2a1e14, light: 0xe0d6c6, mask: 0x2c2118 },
      fawn: { base: 0xbf935a, dark: 0x8c6a3e, light: 0xd2b07a, mask: 0x1f1813 },
      yellow: { base: 0xd8b27a, dark: 0xc49a60, light: 0xe6cc9c, mask: 0xd0a86e },
      black: { base: 0x1d1b1a, dark: 0x141312, light: 0x2a2725, mask: 0x1a1817 },
      choc: { base: 0x4b2f1f, dark: 0x3a2417, light: 0x5c3b27, mask: 0x46291b },
      patched: { base: 0xe6dfd2, dark: 0x5e3b20, light: 0xf2ede4, mask: 0x5e3b20 },
      tan: { base: 0xb48551, dark: 0x8e6337, light: 0xe2cfae, mask: 0x8e6337 },
      "black-tan": { base: 0x1f1b18, dark: 0x16130f, light: 0xa66c34, mask: 0x1f1b18 },
      white: { base: 0xe7e1d5, dark: 0xcbc1ae, light: 0xf3efe7, mask: 0xd8cfbe },
    }[coat] || { base: 0x8a6a48, dark: 0x5a4430, light: 0xc8b090, mask: 0x3a2c20 };
    const NOSE = 0x141110, EYE = 0x1a120b, INNER = 0x9b6a62, PAD = 0x2a2420;
    const ph = [r() * 6, r() * 6, r() * 6, r() * 6];
    const blaze = coat === "blue" || coat === "brindle" || coat === "patched" || coat === "tan";
    const socks = coat === "blue" || coat === "brindle" || coat === "patched" || (coat === "white");
    function patch(x, y, z) {
      const n = Math.sin(x * 9.1 / K + ph[0]) * Math.sin(z * 13.3 / K + ph[1]) + Math.sin(y * 11.7 / K + ph[2]) * Math.sin(x * 6.3 / K + z * 4.1 / K + ph[3]);
      return n > 0.42;
    }
    return function (part, x, y, z, ca, sa, R) {
      if (R && R.tag === "nose") return NOSE;
      if (R && R.tag === "pad") return PAD;
      if (part === "eye") return EYE;
      let c = pal.base;
      const top = ca, under = ca < -0.45;
      switch (coat) {
        case "sable":
          if (part === "torso") {
            if (top > 0.05 && x > D.hipX - 0.12 * K && x < D.shX + 0.03 * K) c = pal.dark;
            else if (under) c = pal.light;
          } else if (part === "neck") c = top > 0.35 ? pal.dark : (under ? pal.light : pal.base);
          else if (part === "head") c = R && R.muz ? pal.mask : (top > 0.55 ? 0x3b2a1b : pal.base);
          else if (part === "jaw") c = pal.mask;
          else if (part === "ear") c = ca < -0.3 ? INNER : pal.dark;
          else if (part === "tail") c = top > -0.2 ? pal.dark : pal.base;
          else if (part === "thigh") c = top < -0.2 && y > D.hipH - 0.08 * K ? pal.dark : pal.base;
          break;
        case "brindle":
          c = (Math.sin(x * 70 / K + Math.sin(y * 9 / K) * 2 + ph[0]) > 0.35) ? pal.dark : pal.base;
          if ((part === "torso" && under && x > 0) || (part === "neck" && under) || (part === "jaw")) c = pal.light;
          if (part === "ear") c = ca < -0.3 ? INNER : pal.dark;
          break;
        case "blue":
          if ((part === "torso" && under && x > -0.05 * K) || (part === "neck" && ca < -0.2) || part === "jaw") c = pal.light;
          if (part === "head" && R && R.muz && ca < 0) c = pal.light;
          if (part === "ear") c = ca < -0.3 ? INNER : pal.dark;
          break;
        case "fawn":
          if (part === "head" && R && R.muz) c = pal.mask;
          else if (part === "jaw" || part === "ear") c = part === "ear" && ca < -0.3 ? 0x3a2a20 : pal.mask;
          else if (under && part === "torso") c = pal.light;
          break;
        case "patched":
          if (part !== "leg" && part !== "foot" && patch(x, y, z)) c = pal.dark;
          if (part === "ear") c = pal.dark;
          if (part === "head" && sa > 0.4 && !(R && R.muz)) c = pal.dark;
          break;
        case "black-tan":
          if ((part === "head" && R && R.muz) || (part === "leg" || part === "foot") || (part === "torso" && under && x > 0) || part === "jaw") c = pal.light;
          if (part === "ear") c = ca < -0.3 ? INNER : pal.base;
          break;
        default:
          if (under && part === "torso") c = pal.light;
          if (part === "ear") c = ca < -0.3 ? INNER : pal.dark;
          if (part === "head" && R && R.muz) c = pal.mask;
      }
      if (blaze && (part === "torso" || part === "neck") && ca < -0.25 && x > D.shX - 0.12 * K) c = pal.light;
      if (socks && (part === "foot")) c = pal.light;
      if (part === "ear" && ca < -0.3 && coat !== "sable" && coat !== "fawn") c = INNER;
      return c;
    };
  }

  // ---- the shell ------------------------------------------------------------
  function buildGeometry(D, coat, seed) {
    const G = new Geo(), K = D.K;
    const col = coatFn(D, coat, seed);
    const C = function (part) { return function (x, y, z, ca, sa, R) { return col(part, x, y, z, ca, sa, R); }; };
    const P = BN.pelvis, CH = BN.chest, NK = BN.neck, HD = BN.head;
    const L = function (t) { return lerp(D.hipX, D.shX, t); };
    const LY = function (t) { return lerp(D.hipH, D.sh, t); };

    // TORSO: rump -> loin -> tuck-up waist -> deep ribs -> prosternum -> neck
    const nb = D.neckB, hp = D.headP;
    const nk = function (t) { return { x: lerp(nb.x, hp.x, t), y: lerp(nb.y, hp.y, t) }; };
    const n0 = nk(0), n1 = nk(0.38), n2 = nk(0.72), n3 = nk(0.97);
    const torso = [
      { x: D.hipX - 0.11 * K, y: D.hipH + 0.035 * K, rt: D.rumpR * 0.62, rb: D.rumpR * 0.58, w: D.rumpW * 0.58, wts: [P, 1] },
      { x: D.hipX - 0.06 * K, y: D.hipH + 0.03 * K, rt: D.rumpR * 0.9, rb: D.rumpR * 0.88, w: D.rumpW * 0.92, wts: [P, 1] },
      { x: D.hipX, y: D.hipH + 0.025 * K, rt: D.rumpR, rb: D.rumpR * 1.02, w: D.rumpW, wts: [P, 1] },
      { x: D.hipX + 0.09 * K, y: D.hipH + 0.035 * K, rt: D.waistRt * 1.1, rb: lerp(D.rumpR, D.waistRb, 0.55), w: lerp(D.rumpW, D.waistW, 0.6), wts: [P, 0.85, CH, 0.15] },
      { x: L(0.34), y: LY(0.34) + 0.04 * K, rt: D.waistRt, rb: D.waistRb, w: D.waistW, wts: [P, 0.55, CH, 0.45] },
      { x: L(0.52), y: LY(0.52) + 0.025 * K, rt: D.chestRt * 0.93, rb: lerp(D.waistRb, D.chestRb, 0.62), w: D.chestW * 0.9, wts: [P, 0.22, CH, 0.78], hk: 0.4 },
      { x: L(0.72), y: D.sh + 0.012 * K, rt: D.chestRt, rb: D.chestRb, w: D.chestW, wts: [CH, 1], hk: 0.9 },
      { x: D.shX - 0.02 * K, y: D.sh + 0.02 * K, rt: D.chestRt * 0.96, rb: D.chestRb * 0.93, w: D.chestW * 0.96, wts: [CH, 1], hk: 1 },
      { x: D.shX + 0.055 * K, y: D.sh + 0.035 * K, rt: D.chestRt * 0.85, rb: D.chestRb * 0.62, w: D.chestW * 0.8, wts: [CH, 1], hk: 0.7 },
    ];
    loft(G, torso, 18, C("torso"), { capLen: 0.8 });
    const neck = [
      { x: D.shX - 0.03 * K, y: D.sh + 0.03 * K, rt: D.chestRt * 0.9, rb: D.chestRb * 0.7, w: D.chestW * 0.85, wts: [CH, 1] },
      { x: n0.x, y: n0.y, rt: D.neckR * 1.32, rb: D.neckR * 1.45, w: D.neckR * 1.25, wts: [CH, 0.55, NK, 0.45], hk: 0.5 },
      { x: n1.x, y: n1.y, rt: D.neckR * 1.08, rb: D.neckR * 1.1, w: D.neckR * 1.04, wts: [CH, 0.08, NK, 0.92] },
      { x: n2.x, y: n2.y, rt: D.neckR, rb: D.neckR * 0.98, w: D.neckR * 0.95, wts: [NK, 1] },
      { x: n3.x, y: n3.y, rt: D.neckR * 0.92, rb: D.neckR * 0.9, w: D.neckR * 0.88, wts: [NK, 0.45, HD, 0.55] },
    ];
    loft(G, neck, 14, C("neck"), { capLen: 0.6 });

    // HEAD: occiput -> cranium -> cheeks -> STOP -> muzzle -> nose
    const u = D.u, H = D.headP;
    const hpnt = function (d, dy) { return { x: H.x + u.x * d, y: H.y + u.y * d + (dy || 0) }; };
    const h0 = hpnt(-0.015 * K), h1 = hpnt(0.035 * K), h2 = hpnt(0.08 * K, -0.004 * K), h3 = hpnt(D.headL, -D.skullR * 0.18);
    const mz = -D.skullR * 0.32;
    const m0 = hpnt(D.headL + 0.012 * K, mz), m1 = hpnt(D.headL + D.muzzleL * 0.5, mz - D.muzzleR * 0.05), m2 = hpnt(D.headL + D.muzzleL, mz - D.muzzleR * 0.12);
    const head = [
      { x: h0.x, y: h0.y, rt: D.skullR * 0.72, rb: D.skullR * 0.78, w: D.skullW * 0.72, wts: [HD, 1] },
      { x: h1.x, y: h1.y, rt: D.skullR, rb: D.skullR * 0.92, w: D.skullW, wts: [HD, 1] },
      { x: h2.x, y: h2.y, rt: D.skullR * 0.94, rb: D.skullR * 0.9, w: D.skullW * 0.98, wts: [HD, 1], sq: 0.9 },
      { x: h3.x, y: h3.y, rt: D.skullR * 0.6, rb: D.skullR * 0.72, w: D.skullW * 0.74, wts: [HD, 1] },
      { x: m0.x, y: m0.y, rt: D.muzzleR, rb: D.muzzleR * 0.78, w: D.muzzleW, wts: [HD, 1], muz: true, sq: 0.85 },
      { x: m1.x, y: m1.y, rt: D.muzzleR * 0.92, rb: D.muzzleR * 0.68, w: D.muzzleW * 0.9, wts: [HD, 1], muz: true, sq: 0.85 },
      { x: m2.x, y: m2.y, rt: D.muzzleR * 0.78, rb: D.muzzleR * 0.55, w: D.muzzleW * 0.76, wts: [HD, 1], muz: true, tag: "nose" },
    ];
    loft(G, head, 14, C("head"), { capLen: 0.7 });
    // the lower jaw hangs off its own hinge so a bark opens the mouth
    const J = D.jawP, jEnd = hpnt(D.headL + D.muzzleL * 0.94, mz - D.muzzleR * 0.95);
    const jaw = [];
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      jaw.push({ x: lerp(J.x, jEnd.x, t), y: lerp(J.y, jEnd.y, t), rt: lerp(0.016, 0.01, t) * K, rb: lerp(0.024, 0.014, t) * K, w: lerp(D.skullW * 0.62, D.muzzleW * 0.6, t), wts: [BN.jaw, 1], muz: true });
    }
    loft(G, jaw, 10, C("jaw"), { capLen: 0.8 });
    // eyes, set into the brow just behind the stop
    for (let s = -1; s <= 1; s += 2) {
      const e = hpnt(D.headL * 0.78, D.skullR * 0.22);
      ellipsoid(G, e.x, e.y, s * D.skullW * 0.66, 0.013 * K, 0.012 * K, 0.009 * K, 8, function () { return col("eye"); }, [HD, 1]);
    }

    // EARS
    for (let s = -1; s <= 1; s += 2) {
      const eb = BN[s < 0 ? "earL" : "earR"], E = D.earP, z0 = s * E.z;
      const st = [];
      if (D.ear === "prick") {
        for (let i = 0; i < 4; i++) {
          const t = i / 3;
          st.push({ x: E.x - 0.012 * K * t, y: E.y + D.earL * t, z: z0 + s * D.earL * 0.22 * t,
            rt: 0.011 * K * (1 - t * 0.6), rb: 0.008 * K * (1 - t * 0.6), w: D.earW * 0.5 * (1 - t * 0.9), wts: [eb, 1] });
        }
        loft(G, st, 8, C("ear"), { capLen: 0.6 });
      } else if (D.ear === "flop") {
        const pts = [[0, 0, 0], [0.01, 0.01, 0.022], [0.016, -D.earL * 0.45, 0.034], [0.012, -D.earL, 0.032]];
        for (let i = 0; i < 4; i++) {
          const t = i / 3, q = pts[i];
          st.push({ x: E.x + q[0] * K, y: E.y + q[1], z: z0 + s * q[2] * K,
            rt: D.earW * 0.5 * (i === 0 ? 0.7 : (1 - t * 0.35)), rb: D.earW * 0.45 * (i === 0 ? 0.7 : (1 - t * 0.35)), w: 0.009 * K, wts: [eb, 1] });
        }
        loft(G, st, 8, C("ear"), { capLen: 0.5, side: [0, 0, 1] });
      } else {
        const pts = [[0, 0, 0], [-0.008, D.earL * 0.45, 0.012], [-0.03, D.earL * 0.55, 0.02], [-0.05, D.earL * 0.35, 0.026]];
        for (let i = 0; i < 4; i++) {
          const t = i / 3, q = pts[i];
          st.push({ x: E.x + q[0] * K, y: E.y + q[1], z: z0 + s * q[2] * K,
            rt: D.earW * 0.42 * (1 - t * 0.5), rb: D.earW * 0.42 * (1 - t * 0.5), w: 0.008 * K, wts: [eb, 1] });
        }
        loft(G, st, 8, C("ear"), { capLen: 0.5 });
      }
    }

    // TAIL along -X from its root, three bones
    const T = D.tailP, tl = D.tailL, tr = D.tailR, tst = [];
    const prof = D.tail === "brush" ? [0.8, 1.0, 1.15, 1.12, 0.9, 0.55]
      : D.tail === "otter" ? [1.15, 1.0, 0.82, 0.62, 0.45, 0.25] : [1.0, 0.85, 0.66, 0.5, 0.36, 0.2];
    for (let i = 0; i < prof.length; i++) {
      const t = i / (prof.length - 1), x = T.x - tl * t;
      let wts;
      if (t < 0.33) wts = [BN.tail0, 1 - t / 0.33 * 0.5, BN.tail1, t / 0.33 * 0.5];
      else if (t < 0.66) wts = [BN.tail1, 1 - (t - 0.33) / 0.33 * 0.5, BN.tail2, (t - 0.33) / 0.33 * 0.5 + 0.0];
      else wts = [BN.tail2, 1];
      tst.push({ x: x, y: T.y, rt: tr * prof[i], rb: tr * prof[i] * 0.95, w: tr * prof[i] * 0.92, wts: wts });
    }
    loft(G, tst, 10, C("tail"), { capLen: 0.9 });

    // LEGS: straight down in the bind pose; the IK bends them every frame
    const pts = bindPoints(D);
    const lr = D.legR;
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, ids = LEGB[Lg], P0 = pts[ids[0]], z = P0[2];
      const a = front ? D.fa : D.ha, b = front ? D.fb : D.hb, c = front ? D.fc : D.hc;
      const x = P0[0], y0 = P0[1];
      if (front) {
        loft(G, [
          { x: x, y: y0 + 0.06 * K, z: z, rt: 0.046 * K * lr, rb: 0.05 * K * lr, w: 0.036 * K * lr, wts: [ids[0], 1] },
          { x: x, y: y0, z: z, rt: 0.047 * K * lr, rb: 0.052 * K * lr, w: 0.038 * K * lr, wts: [ids[0], 1] },
          { x: x, y: y0 - a * 0.55, z: z, rt: 0.036 * K * lr, rb: 0.04 * K * lr, w: 0.031 * K * lr, wts: [ids[0], 1] },
          { x: x, y: y0 - a, z: z, rt: 0.028 * K * lr, rb: 0.034 * K * lr, w: 0.027 * K * lr, wts: [ids[0], 0.6, ids[1], 0.4] },
        ], 10, C("leg"), { capLen: 0.7 });
        loft(G, [
          { x: x, y: y0 - a, z: z, rt: 0.027 * K * lr, rb: 0.033 * K * lr, w: 0.026 * K * lr, wts: [ids[1], 1] },
          { x: x, y: y0 - a - b * 0.5, z: z, rt: 0.022 * K * lr, rb: 0.022 * K * lr, w: 0.021 * K * lr, wts: [ids[1], 1] },
          { x: x, y: y0 - a - b, z: z, rt: 0.02 * K * lr, rb: 0.021 * K * lr, w: 0.02 * K * lr, wts: [ids[1], 0.5, ids[2], 0.5] },
        ], 10, C("leg"), { capLen: 0.7 });
      } else {
        loft(G, [
          { x: x, y: y0 + 0.07 * K, z: z, rt: 0.05 * K * lr, rb: 0.062 * K * lr, w: 0.045 * K * lr, wts: [ids[0], 1] },
          { x: x, y: y0, z: z, rt: 0.056 * K * lr, rb: 0.072 * K * lr, w: 0.05 * K * lr, wts: [ids[0], 1] },
          { x: x, y: y0 - a * 0.5, z: z, rt: 0.045 * K * lr, rb: 0.056 * K * lr, w: 0.04 * K * lr, wts: [ids[0], 1] },
          { x: x, y: y0 - a, z: z, rt: 0.027 * K * lr, rb: 0.03 * K * lr, w: 0.026 * K * lr, wts: [ids[0], 0.55, ids[1], 0.45] },
        ], 10, C("thigh"), { capLen: 0.7 });
        loft(G, [
          { x: x, y: y0 - a, z: z, rt: 0.026 * K * lr, rb: 0.036 * K * lr, w: 0.024 * K * lr, wts: [ids[1], 1] },
          { x: x, y: y0 - a - b * 0.45, z: z, rt: 0.02 * K * lr, rb: 0.03 * K * lr, w: 0.019 * K * lr, wts: [ids[1], 1] },
          { x: x, y: y0 - a - b, z: z, rt: 0.018 * K * lr, rb: 0.026 * K * lr, w: 0.018 * K * lr, wts: [ids[1], 0.5, ids[2], 0.5] },
        ], 10, C("leg"), { capLen: 0.7 });
      }
      // pastern / hock -> paw
      const fy = y0 - a - b;
      loft(G, [
        { x: x, y: fy, z: z, rt: 0.019 * K * lr, rb: 0.021 * K * lr, w: 0.018 * K * lr, wts: [ids[2], 1] },
        { x: x, y: fy - c * 0.6, z: z, rt: 0.017 * K * lr, rb: 0.017 * K * lr, w: 0.017 * K * lr, wts: [ids[2], 1] },
        { x: x, y: fy - c * 0.92, z: z, rt: 0.02 * K * lr, rb: 0.018 * K * lr, w: 0.019 * K * lr, wts: [ids[2], 1] },
      ], 8, C("foot"), { capLen: 0.7 });
      const pr = D.pawR;
      ellipsoid(G, x + pr * 0.55, fy - c, z, pr * 1.45, pr * 0.82, pr * 1.12, 10, function (px, py, pz, ca, sa, R) { return col("foot", px, py, pz, ca, sa, R); }, [ids[2], 1]);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(G.p, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(G.c, 3));
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(G.si, 4));
    geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(G.sw, 4));
    geo.setIndex(G.ix);
    geo.computeVertexNormals();
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, D.withers * 0.55, 0), D.withers * 1.7);
    geo._shared = true;
    return geo;
  }

  // ==========================================================================
  //  BUILD — shared geometry per breed variant, a skeleton per dog
  // ==========================================================================
  const _geoCache = new Map();
  let _mat = null;
  function dogMat() {
    if (!_mat) { _mat = new THREE.MeshLambertMaterial({ vertexColors: true, skinning: true }); _mat._shared = true; _mat.name = "dog-coat"; }
    return _mat;
  }
  function build(breedKey, seed, coat) {
    seed = Math.abs(seed | 0);
    // mutts carry their seed in the geometry key (each is its own cross); a
    // pedigree shares one shell per coat.
    const key0 = BREEDS[breedKey] ? breedKey : "mutt";
    const D = dims(key0, key0 === "mutt" ? (seed % 6) : 0);
    const coats = BREEDS[key0].coats;
    const cz = coat && coats.indexOf(coat) >= 0 ? coat : coats[((seed >>> 3) % coats.length + coats.length) % coats.length];
    const gkey = key0 + "|" + (key0 === "mutt" ? (seed % 6) : 0) + "|" + cz;
    let geo = _geoCache.get(gkey);
    if (!geo) { geo = buildGeometry(D, cz, key0 === "mutt" ? seed % 6 : 1); _geoCache.set(gkey, geo); }

    const pts = bindPoints(D);
    const bones = [];
    for (let i = 0; i < NB; i++) { const b = new THREE.Bone(); b.name = "dog" + i; bones.push(b); }
    for (let i = 0; i < NB; i++) {
      const p = PARENT[i], P = pts[i], Q = p >= 0 ? pts[p] : [0, 0, 0];
      bones[i].position.set(P[0] - Q[0], P[1] - Q[1], P[2] - Q[2]);
      if (p >= 0) bones[p].add(bones[i]);
    }
    const mesh = new THREE.SkinnedMesh(geo, dogMat());
    mesh.add(bones[0]);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    mesh.castShadow = true;
    mesh.name = "dog-body";
    const group = new THREE.Group();
    group.add(mesh);
    group.userData.dynamic = true;      // never batched / frozen by the static sweeps
    const bindPos = bones.map(function (b) { return b.position.clone(); });
    const rig = {
      group: group, mesh: mesh, bones: bones, bindPos: bindPos, dims: D, breed: key0, coat: cz,
      G: gaitCreate(D), st: null, collarMesh: null, t: Math.random() * 10,
    };
    return rig;
  }

  // collar on the neck bone (a torus round the neck axis). null removes it.
  const _collarGeo = new Map();
  function collar(rig, hex) {
    if (rig.collarMesh) { rig.collarMesh.parent && rig.collarMesh.parent.remove(rig.collarMesh); rig.collarMesh = null; }
    if (hex == null) return null;
    const D = rig.dims;
    let g = _collarGeo.get(D.key + D.neckR);
    if (!g) { g = new THREE.TorusGeometry(D.neckR * 1.12, 0.011 * D.K, 6, 16); g._shared = true; _collarGeo.set(D.key + D.neckR, g); }
    const m = new THREE.Mesh(g, CBZ.cmat ? CBZ.cmat(hex) : new THREE.MeshLambertMaterial({ color: hex }));
    const dir = new THREE.Vector3(Math.cos(D.neckAng), Math.sin(D.neckAng), 0);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    m.position.copy(dir).multiplyScalar(D.neckLen * 0.3);
    rig.bones[BN.neck].add(m);
    rig.collarMesh = m;
    return m;
  }
  function mouth(rig) { const M = rig.dims.mouth; return { x: M.x, y: M.y, z: 0 }; }

  // ==========================================================================
  //  ANIMATE — gait + posture + body language -> bones
  //  ctrl: { x, z, y, heading, posture ("stand"|"sit"|"lie"|"dead"),
  //          alert, aggr, fear, happy, sniff (0..1), lookYaw, lookPitch,
  //          bark, bite (one-shot triggers), shake, pant, tilt, ground(x,z) }
  // ==========================================================================
  const _ik = [0, 0];
  function newState() {
    return { px: null, pz: null, ph: 0, v: 0, turn: 0, alert: 0, aggr: 0, fear: 0, happy: 0, sniff: 0, sit: 0, lie: 0, dead: 0,
      pant: 0, lookY: 0, lookP: 0, tilt: 0, barkT: 0, biteT: 0, shake: 0, wagPh: 0, wasPost: false, t: 0 };
  }
  function animate(rig, dt, c) {
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.1) dt = 0.1;
    const D = rig.D || rig.dims, K = D.K, b = rig.bones, bp = rig.bindPos;
    const st = rig.st || (rig.st = newState());
    st.t += dt;
    const gx = c.x, gz = c.z, h = c.heading || 0;
    // ---- MEASURED motion (whatever moved the body, the legs answer to it)
    if (st.px == null) { st.px = gx; st.pz = gz; st.ph = h; }
    const mdx = gx - st.px, mdz = gz - st.pz;
    let v = (mdx * Math.cos(h) + mdz * Math.sin(h)) / dt, turn = wrapPi(h - st.ph) / dt;
    if (mdx * mdx + mdz * mdz > 9) { v = 0; turn = 0; gaitReset(rig.G, gx, gz, h, c.ground, c.y); }
    st.px = gx; st.pz = gz; st.ph = h;
    st.v = approach(st.v, clamp(v, -3, 12), 9, dt);
    st.turn = approach(st.turn, clamp(turn, -8, 8), 9, dt);
    // ---- moods + postures, eased
    const post = c.posture || "stand";
    st.sit = approach(st.sit, post === "sit" ? 1 : 0, 3.2, dt);
    st.lie = approach(st.lie, post === "lie" ? 1 : 0, 2.6, dt);
    st.dead = approach(st.dead, post === "dead" ? 1 : 0, 6, dt);
    st.alert = approach(st.alert, clamp(c.alert || 0, 0, 1), 5, dt);
    st.aggr = approach(st.aggr, clamp(c.aggr || 0, 0, 1), 6, dt);
    st.fear = approach(st.fear, clamp(c.fear || 0, 0, 1), 5, dt);
    st.happy = approach(st.happy, clamp(c.happy || 0, 0, 1), 4, dt);
    st.sniff = approach(st.sniff, clamp(c.sniff || 0, 0, 1), 3, dt);
    st.pant = approach(st.pant, clamp(c.pant != null ? c.pant : Math.min(1, Math.abs(st.v) / 4), 0, 1), 2, dt);
    st.lookY = approach(st.lookY, clamp(c.lookYaw || 0, -1.1, 1.1), 6, dt);
    st.lookP = approach(st.lookP, clamp(c.lookPitch || 0, -0.6, 0.7), 6, dt);
    st.tilt = approach(st.tilt, c.tilt || 0, 4, dt);
    st.shake = approach(st.shake, c.shake ? 1 : 0, 10, dt);
    if (c.bark && st.barkT <= 0) st.barkT = 0.24;
    if (c.bite && st.biteT <= 0) st.biteT = 0.34;
    if (st.barkT > 0) st.barkT = Math.max(0, st.barkT - dt);
    if (st.biteT > 0) st.biteT = Math.max(0, st.biteT - dt);
    const sitK = st.sit, lieK = Math.min(st.lie, 1 - sitK), deadK = st.dead;
    const postK = Math.max(sitK, lieK, deadK);

    // ---- GAIT (only while standing)
    const G = rig.G;
    if (postK < 0.08) {
      if (st.wasPost) { gaitReset(G, gx, gz, h, c.ground, c.y); st.wasPost = false; }
      gaitStep(G, dt, st.v, st.turn, gx, gz, h, c.ground, c.y);
    } else st.wasPost = true;
    const M = G.mix, ph = G.phase * TAU;
    const moveK = clamp(Math.abs(st.v) / 0.5, 0, 1);

    // ---- BODY (pelvis + chest) for STAND, then SIT / LIE, blended
    const cr = Math.max(st.aggr * 0.5, st.fear * 0.85);
    const gal = M.wG * moveK;
    let pX = D.hipX, pY = D.hipH, pR = 0, cX = D.shX, cY = D.sh, cR = 0;
    const bob = -(0.006 * M.wW + 0.016 * M.wT) * K * (0.5 - 0.5 * Math.cos(2 * ph)) * moveK;
    pY += bob; cY += bob;
    pY += 0.028 * K * gal * Math.sin(ph - 1.6); cY += 0.028 * K * gal * Math.sin(ph + 0.3);
    const flex = 0.13 * gal * Math.sin(ph + 0.6);
    pR += flex; cR -= flex * 0.5;
    pX += 0.03 * K * gal * Math.sin(ph + 0.6); cX -= 0.02 * K * gal * Math.sin(ph + 0.6);
    pY -= 0.02 * K * gal; cY -= 0.02 * K * gal;
    pY -= 0.075 * K * cr * (1 + st.fear * 0.4); cY -= 0.055 * K * cr;
    pR += 0.10 * st.fear;
    cX += 0.02 * K * st.aggr;
    if (st.barkT > 0) cY += 0.012 * K * Math.sin(PI * (1 - st.barkT / 0.24));
    const biteE = st.biteT > 0 ? Math.sin(PI * (1 - st.biteT / 0.34)) : 0;
    cX += 0.05 * K * biteE; pX += 0.02 * K * biteE;
    // sit: the rump on the ground, the body pitched nose-up about the shoulders
    const Lb = D.shX - D.hipX;
    const sCX = D.shX - 0.03 * K, sCY = D.sh + 0.035 * K, sPY = D.rumpR * 0.85 + 0.015 * K;
    const sP = Math.asin(clamp((sCY - sPY) / Lb, -0.9, 0.9));
    const sPX = sCX - Lb * Math.cos(sP);
    // lie (sphinx): sternum and hips down
    const lCY = D.chestRb * 0.92, lPY = D.rumpR * 0.85, lCX = D.shX + 0.02 * K;
    const lP = Math.atan2(lCY - lPY, Lb), lPX = lCX - Lb * Math.cos(lP);
    const wS = sitK, wL = lieK, wSt = Math.max(0, 1 - wS - wL);
    pX = pX * wSt + sPX * wS + lPX * wL; pY = pY * wSt + sPY * wS + lPY * wL;
    cX = cX * wSt + sCX * wS + lCX * wL; cY = cY * wSt + sCY * wS + lCY * wL;
    pR = pR * wSt + sP * wS + lP * wL; cR = cR * wSt + sP * wS + lP * wL;

    // happy wiggle from the hips when standing still
    const wagF = 6.5 + st.happy * 4.5;
    st.wagPh += dt * TAU * wagF * (0.35 + 0.65 * Math.max(st.happy, st.alert * 0.4));
    const wagAmp = (st.happy * 0.62 + st.alert * 0.07) * (1 - st.fear * 0.7) * (1 - deadK);

    b[BN.pelvis].position.set(pX, pY, 0);
    b[BN.pelvis].rotation.set(0, st.happy * 0.1 * Math.sin(st.wagPh) * (1 - moveK), pR);
    b[BN.chest].position.set(cX, cY, 0);
    b[BN.chest].rotation.set(0, 0, cR);

    // ---- LEGS: feet from the gait (stand) blended with posture feet, IK
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, F = G.feet[Lg], ids = LEGB[Lg];
      const a = front ? D.fa : D.ha, bl = front ? D.fb : D.hb, cl = front ? D.fc : D.hc;
      // the joint in model space (parent bone frame -> model)
      const par = front ? BN.chest : BN.pelvis;
      const bx = front ? cX : pX, by = front ? cY : pY, br = front ? cR : pR;
      const off = bp[ids[0]];
      const jx = bx + Math.cos(br) * off.x - Math.sin(br) * off.y;
      const jy = by + Math.sin(br) * off.x + Math.cos(br) * off.y;
      // gait foot (stand)
      let fx = F.lx, fy = F.ly + D.pawR;
      const su = F.sw ? Math.sin(PI * F.u) : 0;
      let fa = front ? (-HALF + 0.3 - 1.25 * su) : (-HALF + 0.08 - 0.55 * su);
      if (!front && !F.sw) fa += 0.25 * clamp((D.feet[Lg].x - F.lx) / (0.3 * K), -1, 1);   // push-off
      // posture feet
      let sfx, sfy, sfa, lfx, lfy, lfa;
      if (front) { sfx = D.shX + 0.03 * K; sfy = D.pawR; sfa = -HALF + 0.22; lfx = D.shX + a * 0.6 + bl * 0.8; lfy = D.pawR; lfa = 0.05; }
      else { sfx = sPX + 0.2 * K; sfy = D.pawR; sfa = 0; lfx = lPX + 0.2 * K; lfy = D.pawR; lfa = 0; }
      fx = fx * wSt + sfx * wS + lfx * wL; fy = fy * wSt + sfy * wS + lfy * wL; fa = fa * wSt + sfa * wS + lfa * wL;
      if (deadK > 0) {
        const dx2 = jx + (front ? 0.08 : -0.06) * K, dy2 = jy - (a + bl + cl) * 1.05;
        fx = lerp(fx, dx2, deadK); fy = lerp(fy, dy2, deadK); fa = lerp(fa, -HALF + (front ? 0.2 : -0.1), deadK);
      }
      // the wrist / hock is the IK end; the pastern hangs from it at fa
      const wx = fx - cl * Math.cos(fa), wy = fy - cl * Math.sin(fa);
      ik2(jx, jy, wx, wy, a, bl, front ? -1 : 1, _ik);
      const t1 = _ik[0], t2 = _ik[1];
      b[ids[0]].rotation.set(0, 0, t1 + HALF - br);
      b[ids[1]].rotation.set(0, 0, t2 - t1);
      b[ids[2]].rotation.set(0, 0, fa - t2);
      void par;
    }

    // ---- NECK / HEAD / JAW
    const barkE = st.barkT > 0 ? Math.sin(PI * (1 - st.barkT / 0.24)) : 0;
    let nP = -0.04 + st.alert * 0.14 - st.sniff * 0.95 - st.fear * 0.32 - st.aggr * 0.3 - 0.28 * gal
      + st.lookP * 0.55 + barkE * 0.14 - biteE * 0.25 - cR * 0.75 - lieK * 0.05 - deadK * 0.5;
    nP += 0.035 * M.wW * moveK * Math.sin(2 * ph + 0.5);          // the walking nod
    b[BN.neck].rotation.set(0, st.lookY * 0.55 + st.shake * 0.38 * Math.sin(st.t * 23), nP);
    const sniffWig = st.sniff * 0.05 * Math.sin(st.t * 26);
    b[BN.head].rotation.set(st.tilt * 0.38 + st.shake * 0.2 * Math.sin(st.t * 23 + 1), st.lookY * 0.4, st.lookP * 0.35 - st.sniff * 0.3 + sniffWig + deadK * -0.3);
    // a bite: the mouth opens through the lunge, then SNAPS shut on contact
    const el = 0.34 - st.biteT;
    const biteOpen = st.biteT > 0 ? (el < 0.14 ? 0.75 * el / 0.14 : Math.max(0, 0.75 * (1 - (el - 0.14) / 0.05))) : 0;
    const jawOpen = st.pant * 0.16 * (1 - st.aggr) + barkE * 0.55 + st.aggr * 0.1 + biteOpen + deadK * 0.18;
    b[BN.jaw].rotation.set(0, 0, -clamp(jawOpen, 0, 0.8));

    // ---- EARS: up and forward when alert, pinned back when afraid or biting
    const pin = Math.max(st.fear, st.aggr * 0.75, biteE);
    for (let s = 0; s < 2; s++) {
      const e = b[s === 0 ? BN.earL : BN.earR], sg = s === 0 ? -1 : 1;
      if (D.ear === "prick") e.rotation.set(sg * (0.1 + 0.35 * pin), 0, -0.12 * st.alert + 0.95 * pin + 0.3 * st.happy * (1 - st.alert));
      else e.rotation.set(sg * (-0.15 * st.alert + 0.12 * st.fear + 0.18 * gal * Math.sin(2 * ph)), 0, 0.55 * pin - 0.25 * st.alert + 0.15 * st.happy);
    }

    // ---- TAIL: carriage = mood, wag = happiness
    let carry = D.tailRest - st.alert * 0.95 - st.happy * 0.45 - st.aggr * 0.75 + st.fear * 0.95 - 0.55 * gal;
    carry = carry * (1 - deadK) + 0.15 * deadK;
    carry = clamp(carry, -0.95, 1.55);
    b[BN.tail0].rotation.set(0, wagAmp * Math.sin(st.wagPh), carry);
    b[BN.tail1].rotation.set(0, wagAmp * 0.8 * Math.sin(st.wagPh - 0.7), (D.tail === "brush" ? 0.12 : 0.05) + st.fear * 0.45 - st.alert * 0.1);
    b[BN.tail2].rotation.set(0, wagAmp * 0.7 * Math.sin(st.wagPh - 1.4), (D.tail === "brush" ? 0.1 : 0.0) + st.fear * 0.3);

    // ---- HACKLES: the ridge over the shoulders stands up
    const hk = Math.max(st.aggr, st.fear * 0.55) * (1 - deadK);
    b[BN.hackle].position.set(bp[BN.hackle].x, bp[BN.hackle].y + 0.03 * K * hk, 0);
    return st;
  }

  CBZ.dogModel = { BREEDS: BREEDS, dims: dims, build: build, animate: animate, collar: collar, mouth: mouth, BN: BN };
})();
