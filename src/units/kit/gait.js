/* ============================================================
   units/kit/gait.js — CBZ.quadGait: THE PLANTED-FOOT GAIT, for any animal.

   Lifted out of city/dogmodel.js (where it was the dog's alone) and given a
   FOOTFALL TABLE, so a cat, a horse, an elephant or a bear walks on the same
   solver with its own rhythm. Pure maths: no THREE, loads in node.

   THE LAW. Every foot PLANTS: at touchdown its world contact point is
   recorded and, for the whole stance, the foot is that point brought back
   into the body frame, so a foot in stance cannot slide whatever the body
   does. Swing feet arc from where they lifted to a landing ahead of the
   shoulder/hip. Footfall timing blends between the table's gaits with speed.
   Stance sweep = duty * speed / cadence, so a planted foot moves backward in
   the body frame at exactly the body's speed. At rest the gait stops and the
   worst-placed foot takes a corrective step.

   API
     CBZ.quadGait.create(D, table?) -> G
         D: { K (size factor, 1 = a 0.62 m shepherd), legLen (m),
              feet: [{x, z, front}] neutral foot spots in model space
              (nose +X, ground y = 0), one per leg, any count }
         table: a footfall table (below); default = DOG (dogmodel's numbers)
     CBZ.quadGait.step(G, dt, v, turn, gx, gz, h, ground, gy) -> G
         v forward speed (m/s, MEASURED), turn yaw rate (rad/s), (gx, gz, h)
         the body's world placement (nose = (cos h, sin h)), ground(x,z)->y|null,
         gy the body's own ground y. Writes each foot's LOCAL target
         G.feet[i].{lx, ly, lz}, swing flag .sw and swing progress .u.
     CBZ.quadGait.reset(G, gx, gz, h, ground, gy)   re-plant under the body
     CBZ.quadGait.mix(v, K, legLen, out, table?)    the blended gait at speed v:
         out.{w[], duty, off[], f (cycles/s), S (stride), lift} plus each
         gait's alias weight (DOG: out.wW / wT / wG)
     CBZ.quadGait.toWorld / toLocal(x, z, gx, gz, h, out)
     CBZ.quadGait.TABLES   DOG, CAT, HORSE, ELEPHANT, BEAR (starting points)

   A FOOTFALL TABLE
     { gaits: [ { name, key?, off: [phase per foot], duty, lift }, ... slowest first ],
       trans: [ [lo, hi], ... ]   one per gap: gait i -> i+1 between lo*sqrt(K)
                                  and hi*sqrt(K) m/s (smoothstep)
       fMax, f0, fV               cadence f = min(fMax/k, (f0 + fV*|v|/K)/k), k = sqrt(K)
       strideMax                  stride capped at strideMax * legLen (cadence rises)
       vMove, turnMove            moving when |v| > vMove or |turn| > turnMove
       turnF                      on-the-spot turning cadence (/ sqrt(K))
       settleRate, restLift, restStep   at rest: swing finish rate, lift, re-step distance (x K) }
   Feet order is the D.feet order; dogmodel's is FL FR HL HR.

   HOW AN ANIMAL FILE USES IT (e.g. src/units/species/bengal_tiger.js):
     const G = CBZ.quadGait.create(D, CBZ.quadGait.TABLES.CAT);
     each frame: CBZ.quadGait.step(G, dt, measuredV, turnRate, x, z, heading, groundFn, y);
     then CBZ.quadRig.poseLegs(rig, G, D, body) bends the legs onto G.feet.
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  const PI = Math.PI;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function frac(x) { return x - Math.floor(x); }
  function ease(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

  // ---- THE TABLES. DOG is dogmodel.js's, number for number (the check holds it).
  const DOG = {
    gaits: [
      { name: "walk", key: "wW", off: [0.25, 0.75, 0.00, 0.50], duty: 0.62, lift: 0.05 },    // lateral sequence: HL FL HR FR
      { name: "trot", key: "wT", off: [0.25, 0.75, -0.25, 0.25], duty: 0.42, lift: 0.08 },   // FL+HR, FR+HL
      { name: "gallop", key: "wG", off: [0.25, 0.37, -0.25, -0.13], duty: 0.32, lift: 0.11 }, // HL HR ... FL FR (transverse)
    ],
    trans: [[1.3, 2.0], [4.0, 5.2]],
    fMax: 3.8, f0: 1.05, fV: 0.38, strideMax: 0.62,
    vMove: 0.08, turnMove: 0.35, turnF: 1.5,
    settleRate: 2.6, restLift: 0.045, restStep: 0.07,
  };
  function variant(base, over) { return Object.assign({}, base, over); }
  // starting points, not verdicts: the animal agents own their tables
  const TABLES = {
    DOG: DOG,
    // cats: a stalking walk, a rarely-used trot, a ROTARY gallop (FL FR then HR HL)
    CAT: variant(DOG, {
      gaits: [
        { name: "walk", key: "wW", off: [0.25, 0.75, 0.00, 0.50], duty: 0.66, lift: 0.04 },
        { name: "trot", key: "wT", off: [0.25, 0.75, -0.25, 0.25], duty: 0.45, lift: 0.07 },
        { name: "gallop", key: "wG", off: [0.25, 0.35, -0.13, -0.25], duty: 0.28, lift: 0.13 },
      ],
      trans: [[1.2, 1.9], [3.6, 4.8]],
    }),
    // horses: walk, trot, canter (three-beat), gallop
    HORSE: variant(DOG, {
      gaits: [
        { name: "walk", key: "wW", off: [0.25, 0.75, 0.00, 0.50], duty: 0.64, lift: 0.06 },
        { name: "trot", key: "wT", off: [0.25, 0.75, -0.25, 0.25], duty: 0.44, lift: 0.09 },
        { name: "canter", key: "wC", off: [0.30, 0.15, 0.00, 0.15], duty: 0.38, lift: 0.10 },
        { name: "gallop", key: "wG", off: [0.25, 0.37, -0.25, -0.13], duty: 0.30, lift: 0.12 },
      ],
      trans: [[1.3, 2.0], [3.6, 4.4], [5.6, 6.6]],
    }),
    // elephants never suspend: walk into a fast AMBLE (lateral pairs leading), duty stays > 0.5
    ELEPHANT: variant(DOG, {
      gaits: [
        { name: "walk", key: "wW", off: [0.25, 0.75, 0.00, 0.50], duty: 0.70, lift: 0.04 },
        { name: "amble", key: "wA", off: [0.20, 0.70, 0.00, 0.50], duty: 0.55, lift: 0.05 },
      ],
      trans: [[1.2, 2.2]],
      fMax: 2.4, f0: 0.8, fV: 0.25,
    }),
    // bears: a lumbering pace-like walk, a bounding gallop
    BEAR: variant(DOG, {
      gaits: [
        { name: "walk", key: "wW", off: [0.25, 0.75, 0.05, 0.55], duty: 0.64, lift: 0.05 },
        { name: "pace", key: "wT", off: [0.25, 0.75, 0.25, 0.75], duty: 0.46, lift: 0.07 },
        { name: "gallop", key: "wG", off: [0.25, 0.30, -0.20, -0.15], duty: 0.32, lift: 0.10 },
      ],
      trans: [[1.2, 1.9], [3.4, 4.6]],
    }),
  };

  function mix(v, K, legLen, out, T) {
    T = T || DOG;
    const gs = T.gaits, n = gs.length, nf = gs[0].off.length;
    out = out || {};
    if (!out.off) out.off = new Array(nf).fill(0);
    if (!out.w) out.w = new Array(n).fill(0);
    const k = Math.sqrt(K), av = Math.abs(v);
    // transition i: gait i -> i+1
    const w = out.w;
    if (n === 1) w[0] = 1;
    else {
      // first and last exactly as dogmodel computes them; the middle ones are
      // what is left between their neighbours' transitions
      w[0] = 1 - sstep(T.trans[0][0] * k, T.trans[0][1] * k, av);
      w[n - 1] = sstep(T.trans[n - 2][0] * k, T.trans[n - 2][1] * k, av);
      for (let i = 1; i < n - 1; i++) {
        const below = i === 1 ? w[0] : 1 - sstep(T.trans[i - 1][0] * k, T.trans[i - 1][1] * k, av);
        const above = i === n - 2 ? w[n - 1] : sstep(T.trans[i][0] * k, T.trans[i][1] * k, av);
        w[i] = Math.max(0, 1 - below - above);
      }
    }
    let duty = 0, lift = 0;
    for (let i = 0; i < n; i++) { duty += w[i] * gs[i].duty; if (gs[i].key) out[gs[i].key] = w[i]; }
    out.duty = duty;
    for (let j = 0; j < nf; j++) { let o = 0; for (let i = 0; i < n; i++) o += w[i] * gs[i].off[j]; out.off[j] = o; }
    let f = Math.min(T.fMax / k, (T.f0 + T.fV * av / K) / k);
    const sMax = T.strideMax * (legLen || 0.4);
    if (av > 0 && out.duty * av / f > sMax) f = out.duty * av / sMax;
    out.f = f;
    out.S = av > 0 ? out.duty * av / f : 0;
    for (let i = 0; i < n; i++) lift += gs[i].lift * w[i];
    out.lift = lift * K;
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
  function create(D, table) {
    const T = table || DOG;
    const G = { D: D, T: T, phase: 0, mix: mix(0, D.K, D.legLen, null, T), feet: [], moving: false };
    for (let i = 0; i < D.feet.length; i++) {
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
  function step(G, dt, v, turn, gx, gz, h, ground, gy) {
    const D = G.D, T = G.T || DOG, M = mix(v, D.K, D.legLen, G.mix, T), nf = G.feet.length;
    gy = gy || 0;
    const moving = Math.abs(v) > T.vMove || Math.abs(turn) > T.turnMove;
    G.moving = moving;
    for (let i = 0; i < nf; i++) {
      const F = G.feet[i];
      if (!F.init) { F.init = true; F.sw = false; plantAt(F, D.feet[i].x, D.feet[i].z, gx, gz, h, ground, gy); }
    }
    if (moving) {
      // turning on the spot still steps: a short slow cycle with no stride
      const f = Math.abs(v) > T.vMove ? M.f : T.turnF / Math.sqrt(D.K);
      const S = Math.abs(v) > T.vMove ? M.S * (v < 0 ? -1 : 1) : 0;
      G.phase = frac(G.phase + f * dt);
      for (let i = 0; i < nf; i++) {
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
      for (let i = 0; i < nf; i++) {
        const F = G.feet[i], base = D.feet[i];
        if (F.sw) {
          F.u = Math.min(1, F.u + dt * T.settleRate);
          F.tx = base.x; F.tz = base.z;
          const e = ease(F.u);
          F.lx = lerp(F.sx, F.tx, e); F.lz = lerp(F.sz, F.tz, e);
          F.ly = lerp(F.sy || 0, 0, e) + T.restLift * D.K * Math.sin(PI * F.u);
          if (F.u >= 1) { F.sw = false; plantAt(F, F.lx, F.lz, gx, gz, h, ground, gy); }
          else swinging++;
        } else {
          toLocal(F.cx, F.cz, gx, gz, h, _l);
          F.lx = _l.x; F.lz = _l.z; F.ly = clamp(F.wy - gy, -0.25, 0.25);
        }
      }
      if (!swinging) {
        let worst = -1, wd = T.restStep * D.K;
        for (let i = 0; i < nf; i++) {
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
  function reset(G, gx, gz, h, ground, gy) {
    const D = G.D;
    for (let i = 0; i < G.feet.length; i++) {
      const F = G.feet[i];
      F.sw = false; F.u = 0; F.init = true;
      F.lx = D.feet[i].x; F.lz = D.feet[i].z; F.ly = 0;
      plantAt(F, F.lx, F.lz, gx, gz, h, ground, gy || 0);
    }
  }

  const API = { create: create, step: step, reset: reset, mix: mix, toWorld: toWorld, toLocal: toLocal, TABLES: TABLES, DOG: DOG };
  CBZ.quadGait = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
