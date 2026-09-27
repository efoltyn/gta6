/* ============================================================
   city/fitout_plans.js — HOW PEOPLE LIVE: the flats.

   The fit-out core (city/fitout.js) builds whatever is declared, lazily.
   This file is the architecture of the places people LIVE:

   CBZ.fitoutUnitPlan(U, seed) — THE ONE UNIT PLANNER, pure data, called
     EAGERLY by interior_programs.js's residential program (to stand the bed a
     resident sleeps in and file the kitchen drawer) and LAZILY by the
     "residential" fit-out below (to build everything else). One plan, two
     passes, so the bed the sim knows about is the bed you walk up to.

     A unit is read the way a flat is drawn: you come in off the corridor
     into a short entry hall; the BATHROOM is beside the entry on the wider
     side with its door onto the hall (plumbing stacks against the corridor,
     where the risers are); the KITCHEN runs along the other party wall from
     the door; LIVING fills the middle; the BEDROOM is behind a partition at
     the window, with its door on the kitchen side so the bed wall is solid.
     Smaller plates fall back to a studio (bed in an alcove at the window)
     and an SRO (bed, hotplate, shared bath down the hall) — which is what
     those plate sizes actually are.

   The TENANT is a hash: who lives here decides the paint, the linen, the
   clutter and what is under the mattress. A dealer's flat has a scale on the
   coffee table and money under the bed; a family's has a high chair; a
   vacant unit is a drop cloth and a paint tray, waiting for a lease.

   Plans: "residential" (corridor + every unit), "flat" (the one-dwelling
   storey buildings.js still dresses). Draw verbs for the owner's furnishing
   catalogue: tv, plant, rug.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  function H(a, b, s) { return CBZ.hash01 ? CBZ.hash01(a, b, s) : 0.5; }

  // ---- tenants --------------------------------------------------------------
  const TENANTS = [
    { id: "tidy",    w: 0.26 },
    { id: "messy",   w: 0.20 },
    { id: "family",  w: 0.14 },
    { id: "elder",   w: 0.10 },
    { id: "dealer",  w: 0.10 },
    { id: "student", w: 0.10 },
    { id: "vacant",  w: 0.10 },
  ];
  function tenantOf(h) { let a = 0; for (let i = 0; i < TENANTS.length; i++) { a += TENANTS[i].w; if (h < a) return TENANTS[i].id; } return "tidy"; }
  const PAINT = [0xeee8dc, 0xdfe5dc, 0xd9e1e8, 0xe6ddd0, 0xe9e2d6, 0xd6d9cf, 0xefe7e1, 0xdcd4c8];
  const ACCENT = [0x9aa892, 0x8fa3b5, 0xb88b6e, 0x6f7f8f, 0xa99a7c, 0x7d8a72];
  const SOFA = [0x5b6470, 0x7a5a45, 0x4c5a4a, 0x8a8076, 0x3f4a5a, 0x6b4e4a, 0x9a8f80];
  const LINEN = [0xdad6cf, 0x9fb0c4, 0xc9b8a6, 0x8a9a8a, 0xe3ddd3, 0xb7a3b8];
  const RUG = [0x8a5a48, 0x4f5f6f, 0x9a8a6a, 0x6a4a5a, 0x5a6a5a, 0xa89a88];
  const WOOD = [0x6b4a30, 0x8a6a48, 0x3e2e22, 0xa58a68];

  /* ========================================================================
     THE FRAME — (d, t): d = metres in from the flat's front door, t = metres
     along the corridor from the door's centre line.
     ======================================================================== */
  function frame(U) {
    const inX = U.inX, inZ = U.inZ, tX = U.alongX ? 1 : 0, tZ = U.alongX ? 0 : 1;
    const dx = U.door.x, dz = U.door.z;
    const dOf = function (x, z) { return (x - dx) * inX + (z - dz) * inZ; };
    const tOf = function (x, z) { return (x - dx) * tX + (z - dz) * tZ; };
    const D = Math.max(dOf(U.x0, U.z0), dOf(U.x1, U.z1), dOf(U.x0, U.z1), dOf(U.x1, U.z0));
    const ta = tOf(U.x0, U.z0), tb = tOf(U.x1, U.z1);
    const F = {
      D: D, tLo: Math.min(ta, tb), tHi: Math.max(ta, tb),
      P: function (d, t) { return { x: dx + inX * d + tX * t, z: dz + inZ * d + tZ * t }; },
      yaw: function (dd, dt) { return Math.atan2(inX * dd + tX * dt, inZ * dd + tZ * dt); },
      // sizes in (depth, lateral) -> (x, z)
      wx: function (sd, st) { return U.alongX ? st : sd; },
      wz: function (sd, st) { return U.alongX ? sd : st; },
    };
    F.W = F.tHi - F.tLo;
    return F;
  }

  /* ========================================================================
     CBZ.fitoutUnitPlan(U, seed) -> plan (pure; building-local results)
     ======================================================================== */
  CBZ.fitoutUnitPlan = function (U, seed) {
    if (!U || !U.door) return null;
    const F = frame(U);
    const D = F.D, W = F.W, tLo = F.tLo, tHi = F.tHi;
    if (!(D > 2.4 && W > 2.2)) return null;
    const hx = (U.x0 + U.x1) * 0.5, hz = (U.z0 + U.z1) * 0.5;
    const tenant = tenantOf(H(hx * 3.7, hz * 2.3 + (U.floor | 0) * 1.9, 0x7E4A));
    const pick = function (arr, s) { return arr[(H(hx + s, hz - s * 0.7, 0x7E50 + s) * arr.length) | 0]; };
    const plan = {
      tenant: tenant, D: D, W: W, tLo: tLo, tHi: tHi, kind: "sro",
      paint: pick(PAINT, 1), accent: pick(ACCENT, 2), sofa: pick(SOFA, 3), linen: pick(LINEN, 4),
      rug: pick(RUG, 5), wood: pick(WOOD, 6), flip: H(hx, hz, 0x7E51) < 0.5,
      bath: null, kitchen: null, bedroom: null, bed: null, living: null,
    };
    const HALL = 0.62;                       // half the entry hall (door 1.0 + casing)
    const wLo = -HALL - tLo, wHi = tHi - HALL;   // lateral room either side of the hall
    // bath on the wider side (ties broken by the hash so a corridor alternates)
    const sB = (Math.abs(wLo - wHi) < 0.2 ? (plan.flip ? -1 : 1) : (wLo > wHi ? -1 : 1));
    const sK = -sB;
    const edgeB = sB < 0 ? tLo : tHi, edgeK = sK < 0 ? tLo : tHi;
    const wB = sB < 0 ? wLo : wHi, wK = sK < 0 ? wLo : wHi;
    plan.sB = sB; plan.sK = sK; plan.edgeB = edgeB; plan.edgeK = edgeK;

    // ---- BATHROOM: beside the entry, door onto the hall ---------------------
    let bd = 0;
    if (wB >= 1.22 && D >= 4.4) {
      bd = Math.min(2.6, Math.max(2.2, D * 0.28));
      const tIn = sB * HALL;                            // the bath's hall-side wall line
      plan.bath = { d0: 0, d1: bd, tWall: tIn, tEdge: edgeB, w: wB, doorD: bd - 0.5 };
    }
    // ---- KITCHEN: along the other party wall, from the door -----------------
    const kDepth = 0.62;
    const hallClear = wK + HALL + (plan.bath ? HALL : 0) - kDepth;   // not used as a gate on its own
    if (wK >= kDepth + 0.08 && D >= 3.4) {
      const kEnd = Math.min(D - (D >= 6 ? 2.6 : 1.4), Math.max(2.2, Math.min(3.4, D * 0.42)));
      if (kEnd > 1.6) plan.kitchen = { d0: 0.08, d1: kEnd, tFront: edgeK - sK * kDepth, tEdge: edgeK };
    }
    if (!plan.kitchen && D >= 3.2 && plan.bath) {
      // no room beside the door: the run goes on the far side of the bath wall
      const k0 = bd + 0.1, k1 = Math.min(D - 1.6, bd + 2.6);
      if (k1 - k0 > 1.5) plan.kitchen = { d0: k0, d1: k1, tFront: edgeB - sB * kDepth, tEdge: edgeB, behindBath: true };
    }
    // ---- BEDROOM: behind a partition at the window --------------------------
    const front = Math.max(bd, plan.kitchen && !plan.kitchen.behindBath ? plan.kitchen.d1 : 0);
    if (D - front >= 6.2 && W >= 3.0) {
      plan.kind = "onebed";
      const dB = D - Math.min(3.4, Math.max(3.0, (D - front) * 0.42));
      const gapT = edgeK - sK * 0.62;                   // bedroom door on the kitchen side
      plan.bedroom = { d: dB, gapT: gapT, gapW: 0.86 };
      const wide = Math.max(1.2, Math.min(1.6, W - 1.9));
      // the bed's kitchen-side edge keeps 0.8 m off the door swing
      let tb2 = (tLo + tHi) / 2;
      const kEdge = tb2 + sK * wide / 2;
      if ((gapT - kEdge) * sK < 0.95) tb2 = gapT - sK * (0.95 + wide / 2);
      tb2 = Math.max(tLo + wide / 2 + 0.08, Math.min(tHi - wide / 2 - 0.08, tb2));
      const bdc = dB + 1.25;                            // headboard posts touch the partition
      const p = F.P(bdc, tb2);
      plan.bed = { x: p.x, z: p.z, yaw: F.yaw(-1, 0), len: 2.1, wide: wide, d: bdc, t: tb2, tone: { linen: plan.linen } };
      plan.living = { d0: front + 0.1, d1: dB - 0.12 };
    } else if (D - front >= 3.3 && W >= 2.6) {
      plan.kind = "studio";
      // bed in an alcove at the window, head to the bath-side party wall
      const len = 2.0, wide = Math.min(1.4, D - front - 1.4);
      const dC = D - 0.12 - wide / 2 - 0.35;
      const tC = edgeB - sB * (len / 2 + 0.08);
      const p = F.P(dC, tC);
      plan.bed = { x: p.x, z: p.z, yaw: F.yaw(0, sB), len: len, wide: Math.max(0.9, wide), d: dC, t: tC, tone: { linen: plan.linen } };
      plan.living = { d0: front + 0.1, d1: dC - wide / 2 - 0.2 };
    } else {
      plan.kind = "sro";
      const len = 1.95, wide = 0.95;
      const dC = Math.max(front + wide / 2 + 0.3, D - 0.12 - wide / 2 - 0.2);
      const tC = edgeB - sB * (len / 2 + 0.08);
      const p = F.P(dC, tC);
      if (dC + wide / 2 < D - 0.05 && Math.abs(tC - (tLo + tHi) / 2) + len / 2 < W / 2 + 0.01)
        plan.bed = { x: p.x, z: p.z, yaw: F.yaw(0, sB), len: len, wide: wide, d: dC, t: tC, tone: { linen: plan.linen } };
      plan.living = { d0: front + 0.1, d1: D - 0.2 };
    }
    // a vacant unit is between tenants: the bed frame stays (the landlord's),
    // nothing else does.
    if (plan.kitchen) {
      const kp = F.P((plan.kitchen.d0 + plan.kitchen.d1) / 2, plan.kitchen.tFront + sK * 0.3 * (plan.kitchen.behindBath ? -1 : 1));
      plan.kitchen.x = kp.x; plan.kitchen.z = kp.z;
    }
    plan.F = F;
    return plan;
  };

  /* ========================================================================
     PROPS — the small things a room is actually made of. (d,t) frame boxes.
     ======================================================================== */
  function fbox(B, F, d, y, t, sd, h, st, col, o) {
    const p = F.P(d, t);
    return B.box(p.x, y, p.z, F.wx(sd, st), h, F.wz(sd, st), col, o);
  }
  // wall across the flat at depth d (runs along t)
  function wallAcross(B, U, F, d, t0, t1, o) {
    const p0 = F.P(d, t0), p1 = F.P(d, t1);
    if (U.alongX) B.wall("x", p0.z, p0.x, p1.x, remapGaps(o, F, d, true, U));
    else B.wall("z", p0.x, p0.z, p1.z, remapGaps(o, F, d, true, U));
  }
  // wall along the depth at lateral t (runs along d)
  function wallAlong(B, U, F, t, d0, d1, o) {
    const p0 = F.P(d0, t), p1 = F.P(d1, t);
    if (U.alongX) B.wall("z", p0.x, p0.z, p1.z, remapGaps(o, F, t, false, U));
    else B.wall("x", p0.z, p0.x, p1.x, remapGaps(o, F, t, false, U));
  }
  // gaps are authored in the frame (t for an across wall, d for an along wall)
  function remapGaps(o, F, fixed, across, U) {
    if (!o || !o.gaps) return o;
    const out = Object.assign({}, o);
    out.gaps = o.gaps.map(function (g) {
      const p = across ? F.P(fixed, g.c) : F.P(g.c, fixed);
      const c = across ? (U.alongX ? p.x : p.z) : (U.alongX ? p.z : p.x);
      return { c: c, w: g.w, h: g.h };
    });
    return out;
  }
  function skinAt(B, U, F, which, v, from, to, o) {
    // which: "d" = a face at constant depth v (runs along t), "t" = at lateral v
    const side = o.side;
    if (which === "d") {
      const p0 = F.P(v, from), p1 = F.P(v, to);
      if (U.alongX) B.skin("x", p0.z, p0.x, p1.x, side * U.inZ, remapGaps(o, F, v, true, U));
      else B.skin("z", p0.x, p0.z, p1.z, side * U.inX, remapGaps(o, F, v, true, U));
    } else {
      const p0 = F.P(from, v), p1 = F.P(to, v);
      if (U.alongX) B.skin("z", p0.x, p0.z, p1.z, side, remapGaps(o, F, v, false, U));
      else B.skin("x", p0.z, p0.x, p1.x, side, remapGaps(o, F, v, false, U));
    }
  }

  function books(B, F, d, y, t, len, alongT, salt) {
    let s = -len / 2;
    const cols = [0x7a2e2e, 0x2e4a7a, 0x3e6a3e, 0xc8b88a, 0x5a3a6a, 0x222222, 0xb86a2e, 0xe0dcd0];
    let i = 0;
    while (s < len / 2 - 0.03) {
      const th = 0.025 + H(d + i, t + salt, 0xB00C) * 0.035;
      const hh = 0.16 + H(t + i, d - salt, 0xB00D) * 0.1;
      const c = cols[(H(i + salt, d + t, 0xB00E) * cols.length) | 0];
      if (alongT) fbox(B, F, d, y + hh / 2, t + s + th / 2, 0.16, hh, th, c);
      else fbox(B, F, d + s + th / 2, y + hh / 2, t, th, hh, 0.16, c);
      s += th + 0.004; i++;
      if (i > 40) break;
    }
  }
  function plant(B, x, z, y, big, salt) {
    const s = big ? 1 : 0.55;
    B.box(x, y + 0.18 * s, z, 0.34 * s, 0.36 * s, 0.34 * s, 0x8a5a3c);
    B.box(x, y + 0.37 * s, z, 0.3 * s, 0.02, 0.3 * s, 0x3a2a1e);
    const leaf = [0x3f7a45, 0x4f8a4a, 0x356a3c];
    const n = big ? 7 : 4;
    for (let i = 0; i < n; i++) {
      const a = i * 2.39 + salt, r = (0.06 + (i % 3) * 0.06) * s;
      const hh = (0.35 + (i % 4) * 0.18) * s;
      B.box(x + Math.cos(a) * r, y + 0.38 * s + hh / 2, z + Math.sin(a) * r, 0.16 * s, hh, 0.16 * s, leaf[i % 3]);
    }
  }
  function frameArt(B, F, U, d, y, t, w, h, onDepthFace, faceSign, col) {
    // a framed print hung on a wall: onDepthFace = the wall is at constant d
    const bd = 0.03;
    if (onDepthFace) {
      fbox(B, F, d + faceSign * bd / 2, y, t, bd, h, w, 0x1d1b19);
      fbox(B, F, d + faceSign * (bd + 0.003), y, t, 0.004, h - 0.08, w - 0.08, 0xf2eee6);
      fbox(B, F, d + faceSign * (bd + 0.006), y, t, 0.004, h - 0.2, w - 0.2, col);
    } else {
      fbox(B, F, d, y, t + faceSign * bd / 2, w, h, bd, 0x1d1b19);
      fbox(B, F, d, y, t + faceSign * (bd + 0.003), w - 0.08, h - 0.08, 0.004, 0xf2eee6);
      fbox(B, F, d, y, t + faceSign * (bd + 0.006), w - 0.2, h - 0.2, 0.004, col);
    }
  }
  const ART = [0x5a7a9a, 0xb87a4a, 0x3a5a4a, 0x9a4a4a, 0xc8a86a, 0x4a4a6a, 0x7a8a6a];

  /* ========================================================================
     THE FLAT, BUILT
     ======================================================================== */
  function drawUnit(B, U) {
    const plan = U.plan || CBZ.fitoutUnitPlan(U, 0);
    if (!plan) return;
    const F = plan.F || frame(U);
    const D = F.D, tLo = F.tLo, tHi = F.tHi, sB = plan.sB, sK = plan.sK;
    const fy = B.fy, y0 = B.y0, ceil = B.ceil;
    const vacant = plan.tenant === "vacant";
    const cleared = CBZ.fitoutRoomCleared && CBZ.fitoutRoomCleared(B, "u:" + U.id);
    const salt = (U.n | 0) * 7.1 + (U.floor | 0);
    const lit = function (d0, d1, t0, t1) { const a = F.P(d0, t0), b = F.P(d1, t1); return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) }; };
    const whole = lit(0, D, tLo, tHi);
    // every fixture in this flat lights THIS flat: light does not walk through
    // a party wall into next door (and the bake only tests what can reach).
    const B0 = B;
    B = Object.assign({}, B0, {
      light: function (x, z, o) { o = Object.assign({}, o || {}); if (!o.rect) o.rect = whole; return B0.light(x, z, o); },
      lamp: function (x, z, y, o) { o = Object.assign({}, o || {}); if (!o.rect) o.rect = whole; return B0.lamp(x, z, y, o); },
    });

    // ---- FLOORS: oak through the flat, ceramic in the bath and kitchen ------
    const wet = [];
    if (plan.bath) wet.push(lit(0, plan.bath.d1, Math.min(plan.bath.tWall, plan.bath.tEdge), Math.max(plan.bath.tWall, plan.bath.tEdge)));
    const floorMat = vacant ? "concrete" : (plan.tenant === "student" || plan.tenant === "messy" ? "vinyl" : "wood");
    const dryHoles = wet.slice();
    B.plane(whole.x0, whole.z0, whole.x1, whole.z1, fy, floorMat, floorMat === "wood" ? 0xffffff : 0xf4efe6,
      { cell: 1.0, holes: dryHoles.concat(B.holes()) });
    for (let i = 0; i < wet.length; i++) B.plane(wet[i].x0, wet[i].z0, wet[i].x1, wet[i].z1, fy + 0.004, "tile", 0xffffff, { cell: 0.6 });
    if (plan.kitchen && !vacant) {
      const kr = lit(plan.kitchen.d0, plan.kitchen.d1 + 0.2, plan.kitchen.tEdge, plan.kitchen.tFront - sK * 0.7 * (plan.kitchen.behindBath ? -1 : 1));
      B.plane(kr.x0, kr.z0, kr.x1, kr.z1, fy + 0.004, "tile", 0xe8e4dc, { cell: 0.6 });
    }

    // a finished ceiling (the slab's underside is raw concrete)
    B.plane(whole.x0, whole.z0, whole.x1, whole.z1, ceil - 0.01, "plaster", vacant ? 0xe6e4df : 0xf6f4f0, { down: true, cell: 1.2, holes: B.holes() });

    // ---- PAINT: the flat's own walls (party walls + the corridor wall) ------
    const paint = vacant ? 0xe9e6df : plan.paint;
    skinAt(B, U, F, "d", 0, tLo, tHi, { side: 1, tint: paint, gaps: [{ c: 0, w: 1.12, h: 2.2 }] });
    if (U.partyLo) skinAt(B, U, F, "t", tLo, 0, D, { side: 1, tint: paint });
    if (U.partyHi) skinAt(B, U, F, "t", tHi, 0, D, { side: -1, tint: paint });
    // the inside of the front door frame
    fbox(B, F, 0.02, y0 + 1.1, -0.56, 0.05, 2.2, 0.07, 0xf2efe8);
    fbox(B, F, 0.02, y0 + 1.1, 0.56, 0.05, 2.2, 0.07, 0xf2efe8);
    fbox(B, F, 0.02, y0 + 2.23, 0, 0.05, 0.07, 1.2, 0xf2efe8);

    // ---- BATHROOM -------------------------------------------------------------
    if (plan.bath) {
      const bt = plan.bath, t0 = Math.min(bt.tWall, bt.tEdge), t1 = Math.max(bt.tWall, bt.tEdge);
      const tw = bt.tWall;                                  // hall-side wall line
      wallAlong(B, U, F, tw, 0.02, bt.d1, { gaps: [{ c: bt.doorD, w: 0.78, h: 2.05 }], tint: paint, mat: "plaster" });
      wallAcross(B, U, F, bt.d1, t0 - (sB < 0 ? 0 : 0.06), t1 + (sB < 0 ? 0.06 : 0), { tint: paint, mat: "plaster" });
      // subway tile to 1.2 m on the wet walls, inside the bath
      const tin = tw + sB * 0.07;                           // inner (bath-side) face of the hall wall
      skinAt(B, U, F, "d", bt.d1 - 0.07, t0 + 0.02, t1 - 0.02, { side: -1, mat: "subway", tint: 0xffffff, h: 1.25, noSkirt: true });
      skinAt(B, U, F, "d", 0.012, t0 + 0.02, t1 - 0.02, { side: 1, mat: "subway", tint: 0xffffff, h: 1.25, noSkirt: true });
      // WC against the corridor wall, basin beside it, shower at the party wall
      const bw = Math.abs(bt.tEdge - tw) - 0.07;
      const tMid = (bt.tEdge + tin) / 2;
      const wcT = tin + sB * 0.45;
      if (!vacant || true) {
        fbox(B, F, 0.3, fy + 0.2, wcT, 0.52, 0.4, 0.38, 0xf4f4f2);          // bowl
        fbox(B, F, 0.1, fy + 0.62, wcT, 0.18, 0.4, 0.4, 0xf4f4f2);          // cistern
        fbox(B, F, 0.36, fy + 0.415, wcT, 0.46, 0.03, 0.36, 0xe8e8e6);       // seat
      }
      // shower: tray + glass at the party wall end
      const shW = Math.min(0.9, bw * 0.5), shD = Math.min(1.0, bt.d1 - 0.3);
      const shT = bt.tEdge - sB * (shW / 2 + 0.02), shDc = bt.d1 - 0.1 - shD / 2;
      fbox(B, F, shDc, fy + 0.04, shT, shD, 0.08, shW, 0xeeeeec);
      fbox(B, F, shDc, fy + 1.05, shT - sB * (shW / 2), shD, 1.9, 0.02, 0xcfe3ea, { glass: true });
      fbox(B, F, shDc, fy + 2.0, bt.tEdge - sB * 0.2, 0.12, 0.05, 0.05, 0xc0c0c0);   // shower head
      // basin + mirror cabinet on the hall wall (inside)
      const bnD = 0.95;
      const bnT = tin + sB * 0.26;
      if (Math.abs(bnD - bt.doorD) > 0.65) {
        fbox(B, F, bnD, fy + 0.42, bnT, 0.55, 0.84, 0.44, 0xf0efec);
        fbox(B, F, bnD, fy + 0.86, bnT, 0.6, 0.04, 0.48, 0xdedcd8);
        fbox(B, F, bnD, fy + 0.9, bnT + sB * 0.05, 0.36, 0.06, 0.28, 0xffffff);
        fbox(B, F, bnD, fy + 1.55, tin + sB * 0.05, 0.55, 0.7, 0.1, 0xd6dee4);
        fbox(B, F, bnD, fy + 1.55, tin + sB * 0.102, 0.48, 0.62, 0.004, 0xa9bcc8, { glow: true });
        B.loot(F.P(bnD, tin).x, F.P(bnD, tin).z, "medicine");
      }
      // towel on a rail by the shower
      fbox(B, F, shDc - shD / 2 - 0.3, fy + 1.1, bt.tEdge - sB * 0.05, 0.5, 0.02, 0.02, 0xc0c0c0);
      if (!vacant) fbox(B, F, shDc - shD / 2 - 0.3, fy + 0.9, bt.tEdge - sB * 0.06, 0.42, 0.42, 0.03, plan.accent);
      B.light(F.P(bt.d1 / 2, tMid).x, F.P(bt.d1 / 2, tMid).z, { kind: "dome", r: 3.2, i: 0.7, rect: lit(0, bt.d1, t0, t1) });
    }

    // ---- KITCHEN --------------------------------------------------------------
    if (plan.kitchen) {
      const k = plan.kitchen;
      const s = k.behindBath ? sB : sK;                  // which party wall it hugs
      const tE = k.tEdge, tC = tE - s * 0.31;           // cabinet centre line
      const d0 = k.d0, d1 = k.d1, L = d1 - d0, dm = (d0 + d1) / 2;
      const body = [0x55606e, 0xe6e2da, 0x3c4a3c, 0x7a5a3e][(H(salt, 3, 0xC17) * 4) | 0];
      const top = [0xd9d6cf, 0x2a2a2a, 0xb9aa90][(H(salt, 4, 0xC18) * 3) | 0];
      // fridge by the door end
      const frD = d0 + 0.36;
      fbox(B, F, frD, fy + 0.93, tC, 0.68, 1.86, 0.62, 0xdcdcda);
      fbox(B, F, frD, fy + 1.3, tC - s * 0.315, 0.02, 0.4, 0.02, 0x9a9a9a);
      // base run
      const b0 = d0 + 0.72, bL = Math.max(0.6, d1 - b0);
      fbox(B, F, b0 + bL / 2, fy + 0.44, tC, bL, 0.84, 0.58, body);
      fbox(B, F, b0 + bL / 2, fy + 0.05, tC - s * 0.25, bL, 0.1, 0.02, 0x1a1a1a);      // toe kick shadow
      fbox(B, F, b0 + bL / 2, fy + 0.9, tC - s * 0.01, bL + 0.02, 0.04, 0.62, top);
      // door lines on the base run
      for (let q = b0 + 0.6; q < d1 - 0.1; q += 0.6) fbox(B, F, q, fy + 0.46, tC - s * 0.292, 0.012, 0.72, 0.005, 0x2a2a2a);
      // sink (mid) and hob (far end)
      const sinkD = b0 + bL * 0.35, hobD = b0 + bL * 0.8;
      fbox(B, F, sinkD, fy + 0.905, tC, 0.5, 0.012, 0.4, 0x9aa0a6);
      fbox(B, F, sinkD, fy + 1.05, tE - s * 0.08, 0.04, 0.26, 0.04, 0xc8c8c8);
      fbox(B, F, sinkD, fy + 1.17, tE - s * 0.16, 0.04, 0.03, 0.18, 0xc8c8c8);
      fbox(B, F, hobD, fy + 0.925, tC, 0.56, 0.012, 0.5, 0x151515);
      for (const a of [-1, 1]) for (const c2 of [-1, 1]) fbox(B, F, hobD + a * 0.13, fy + 0.935, tC + c2 * 0.12, 0.16, 0.008, 0.16, 0x303030);
      fbox(B, F, hobD, fy + 0.45, tC - s * 0.293, 0.56, 0.5, 0.01, 0x202226);         // oven door
      // splashback tile + upper cabinets + hood
      skinAt(B, U, F, "t", tE - s * 0.012, b0, d1, { side: -s, mat: "subway", tint: 0xffffff, h: 1.52, noSkirt: true });
      const uy = fy + 1.95;
      fbox(B, F, b0 + bL / 2, uy, tE - s * 0.18, bL, 0.7, 0.34, body);
      fbox(B, F, hobD, fy + 1.55, tE - s * 0.24, 0.6, 0.12, 0.46, 0x8a8e92);
      fbox(B, F, b0 + bL / 2, fy + 1.58, tE - s * 0.26, bL - 0.1, 0.02, 0.04, 0xfff3d8, { glow: true });  // under-cabinet strip
      B.lamp(F.P(b0 + bL / 2, tE - s * 0.3).x, F.P(b0 + bL / 2, tE - s * 0.3).z, fy + 1.4, { r: 2.2, i: 0.35, color: 0xfff1d6 });
      // life on the worktop
      if (!vacant) {
        const topY = fy + 0.92;
        fbox(B, F, b0 + 0.25, topY + 0.14, tC + s * 0.1, 0.24, 0.28, 0.2, 0xd0d0d0);     // kettle / coffee maker
        fbox(B, F, sinkD + 0.42, topY + 0.02, tC, 0.34, 0.04, 0.26, plan.wood);        // chopping board
        if (plan.tenant === "messy" || plan.tenant === "student") {
          for (let q = 0; q < 3; q++) fbox(B, F, sinkD - 0.05 + q * 0.03, fy + 0.93 + q * 0.025, tC + 0.02, 0.26, 0.02, 0.26, 0xefefef);   // dishes in the sink
          fbox(B, F, hobD, topY + 0.07, tC, 0.26, 0.12, 0.26, 0x3a3a3a);               // a pan left on
        }
        if (plan.tenant === "family") fbox(B, F, d1 + 0.5, fy + 0.45, tC - s * 0.5, 0.45, 0.9, 0.45, 0xe8d8b8);   // high chair
      }
      B.light(F.P(dm, tC - s * 0.7).x, F.P(dm, tC - s * 0.7).z, { kind: "dome", r: 4.2, i: 0.55 });
    }

    // ---- BEDROOM ----------------------------------------------------------------
    const bed = plan.bed;
    if (plan.bedroom) {
      const br = plan.bedroom;
      wallAcross(B, U, F, br.d, tLo, tHi, { gaps: [{ c: br.gapT, w: br.gapW, h: 2.05 }], tint: paint, mat: "plaster" });
      B.light(F.P((br.d + D) / 2, (tLo + tHi) / 2).x, F.P((br.d + D) / 2, (tLo + tHi) / 2).z,
        { kind: "dome", r: 4.2, i: 0.55, rect: lit(br.d, D, tLo, tHi) });
    }
    if (bed && !vacant && !cleared) {
      // nightstands + lamps at the head, a rug under the foot
      const headD = plan.kind === "onebed" ? plan.bedroom.d + 0.3 : bed.d;
      if (plan.kind === "onebed") {
        for (const s2 of [-1, 1]) {
          const nt = bed.t + s2 * (bed.wide / 2 + 0.26);
          if (nt < tLo + 0.22 || nt > tHi - 0.22) continue;
          fbox(B, F, headD, fy + 0.26, nt, 0.4, 0.52, 0.4, plan.wood);
          fbox(B, F, headD, fy + 0.54, nt, 0.14, 0.04, 0.14, 0x303030);
          fbox(B, F, headD, fy + 0.72, nt, 0.24, 0.2, 0.24, 0xf0e6d0, { glow: true });
          B.lamp(F.P(headD, nt).x, F.P(headD, nt).z, fy + 0.75, { r: 2.4, i: 0.4, rect: lit(plan.bedroom.d, D, tLo, tHi) });
          if (s2 === 1) books(B, F, headD, fy + 0.52, nt, 0.2, false, salt);
        }
        const rugD = bed.d + 0.4;
        fbox(B, F, rugD, fy + 0.006, bed.t, 1.6, 0.012, Math.min(bed.wide + 1.0, tHi - tLo - 0.3), plan.rug, { faces: 4 });
        // wardrobe on the kitchen-side party wall, clear of the bed and the door
        const wT = plan.edgeK - sK * 0.31;
        const bedEdge = bed.t + sK * bed.wide / 2;
        if ((wT - sK * 0.31 - bedEdge) * sK > 0.55) {
          const wd0 = plan.bedroom.d + 1.0, wd1 = Math.min(D - 0.3, wd0 + 1.4);
          if (wd1 - wd0 > 0.9 && B.furn("locker", F.P((wd0 + wd1) / 2, wT).x, F.P((wd0 + wd1) / 2, wT).z, F.yaw(0, -sK), { n: Math.max(2, Math.round((wd1 - wd0) / 0.45)), h: 2.0 }))
            B.loot(F.P((wd0 + wd1) / 2, wT).x, F.P((wd0 + wd1) / 2, wT).z, "closet");
        }
        // art over the bed
        frameArt(B, F, U, plan.bedroom.d + 0.07, fy + 1.55, bed.t, Math.min(1.1, bed.wide), 0.7, true, 1, ART[(H(salt, 9, 0xA27) * ART.length) | 0]);
      } else {
        // alcove bed: one side table and a lamp at the window end
        const nt = bed.d - (bed.wide / 2 + 0.25);
        fbox(B, F, nt, fy + 0.26, plan.edgeB - sB * 0.25, 0.4, 0.52, 0.4, plan.wood);
        fbox(B, F, nt, fy + 0.66, plan.edgeB - sB * 0.25, 0.22, 0.18, 0.22, 0xf0e6d0, { glow: true });
        B.lamp(F.P(nt, plan.edgeB - sB * 0.25).x, F.P(nt, plan.edgeB - sB * 0.25).z, fy + 0.7, { r: 2.2, i: 0.35 });
      }
      // WHAT IS UNDER THE MATTRESS
      const lootP = F.P(bed.d, bed.t);
      B.loot(lootP.x, lootP.z, "mattress");
      if (plan.tenant === "messy" || plan.tenant === "student") {
        fbox(B, F, bed.d + (plan.kind === "onebed" ? 1.35 : 0), fy + 0.08, bed.t + sK * (bed.wide / 2 + 0.3), 0.5, 0.16, 0.4, 0x4a5a7a);   // laundry pile
      }
    }

    // ---- LIVING -------------------------------------------------------------------
    const L = plan.living;
    if (L && !vacant && !cleared && L.d1 - L.d0 > 1.8) {
      const len = Math.min(2.2, L.d1 - L.d0 - 0.4);
      const sofaD = (L.d0 + L.d1) / 2 + (plan.kitchen && !plan.kitchen.behindBath ? Math.min(0.5, (L.d1 - L.d0) * 0.1) : 0);
      const W2 = tHi - tLo;
      if (W2 >= 3.0 && len >= 1.5) {
        // sofa back to the bath-side party wall, TV on the kitchen side
        const sofaT = plan.edgeB - sB * 0.52;
        const sp = F.P(sofaD, sofaT);
        const sofa = B.furn("sofa", sp.x, sp.z, F.yaw(0, -sB), { len: len, tone: { cloth: plan.sofa } });
        // SOMEBODY HOME. propuse files a seat once (a rebuild's re-file is
        // deduped to null), so the first build's record is kept on the unit.
        if (sofa && sofa.seats && sofa.seats[0] && sofa.seats[0].rec) U._sofaSeat = sofa.seats[0];
        if (H(salt, 21, 0x9E0) < 0.45) {
          const st = U._sofaSeat;
          if (st && st.rec) B.person({ x: st.x - B.ox, z: st.z - B.oz, face: st.face, seat: st.rec, when: "day", opts: { resident: true } });
          if (U.bedRec && bed) B.person({ x: bed.x, z: bed.z, face: bed.yaw, bed: U.bedRec, when: "night", opts: { resident: true } });
        }
        const ctT = sofaT - sB * 1.05;
        if ((ctT - plan.edgeK) * sB > 0.9 || true) {
          const cp = F.P(sofaD, ctT);
          B.furn("coffee", cp.x, cp.z, F.yaw(0, -sB), { len: Math.min(1.1, len - 0.4), deep: 0.55 });
          fbox(B, F, sofaD, fy + 0.006, (sofaT + plan.edgeK) / 2, Math.min(len + 0.6, L.d1 - L.d0), 0.012, Math.min(2.4, Math.abs(plan.edgeK - sofaT) - 0.2), plan.rug, { faces: 4 });
          // coffee table life
          const topY = fy + 0.4;
          if (plan.tenant === "dealer") {
            fbox(B, F, sofaD - 0.2, topY + 0.02, ctT, 0.18, 0.04, 0.14, 0x202020);          // scale
            fbox(B, F, sofaD - 0.2, topY + 0.045, ctT, 0.12, 0.01, 0.1, 0x90a0a0, { glow: true });
            for (let q = 0; q < 6; q++) fbox(B, F, sofaD + 0.05 + (q % 3) * 0.07, topY + 0.01, ctT + (q > 2 ? 0.08 : -0.02), 0.05, 0.02, 0.05, 0xf4f4f4);
            fbox(B, F, sofaD + 0.3, topY + 0.03, ctT, 0.16, 0.06, 0.07, 0x3a6a3a);          // a banded stack
          } else if (plan.tenant === "messy" || plan.tenant === "student") {
            fbox(B, F, sofaD + 0.2, topY + 0.025, ctT, 0.4, 0.05, 0.4, 0xc8a070);          // pizza box
            for (let q = 0; q < 3; q++) fbox(B, F, sofaD - 0.25 + q * 0.09, topY + 0.06, ctT + (q - 1) * 0.1, 0.066, 0.12, 0.066, [0xc03030, 0x3060b0, 0xd0d0d0][q]);
          } else {
            fbox(B, F, sofaD, topY + 0.01, ctT + 0.05, 0.3, 0.02, 0.22, ART[(salt | 0) % ART.length]);   // a magazine
            fbox(B, F, sofaD + 0.25, topY + 0.05, ctT - 0.08, 0.09, 0.1, 0.09, 0xf2f2f0);               // a mug
          }
        }
        // TV on a low unit against the kitchen-side wall (past the kitchen run)
        const tvT = plan.edgeK - sK * 0.22;
        const kEndD = plan.kitchen && !plan.kitchen.behindBath ? plan.kitchen.d1 : 0;
        if (sofaD - 0.8 > kEndD + 0.1) {
          drawTV(B, F.P(sofaD, tvT).x, F.P(sofaD, tvT).z, F.yaw(0, sB), Math.min(1.8, len), salt, plan.tenant === "family");
        } else {
          // no wall for it: the TV stands on a unit facing the sofa, back to the kitchen
          drawTV(B, F.P(sofaD, tvT - sK * 0.5).x, F.P(sofaD, tvT - sK * 0.5).z, F.yaw(0, sB), Math.min(1.5, len), salt, false);
        }
        B.light(F.P(sofaD, (sofaT + tvT) / 2).x, F.P(sofaD, (sofaT + tvT) / 2).z, { kind: "pendant", drop: 0.55, r: 4.5, i: 0.55, shade: plan.accent });
        // a floor lamp at the sofa's end, a plant in the corner
        const flD = sofaD + (len / 2 + 0.3);
        if (flD < L.d1 - 0.2) {
          const fp = F.P(flD, sofaT);
          B.box(fp.x, fy + 0.8, fp.z, 0.03, 1.6, 0.03, 0x2a2a2a);
          B.box(fp.x, fy + 1.55, fp.z, 0.36, 0.3, 0.36, 0xf3e8d2, { glow: true });
          B.lamp(fp.x, fp.z, fy + 1.5, { r: 3.0, i: 0.4 });
        }
        const pl = F.P(L.d1 - 0.35, plan.edgeB - sB * 0.35);
        plant(B, pl.x, pl.z, fy, true, salt);
        // art over the sofa
        frameArt(B, F, U, sofaD, fy + 1.55, plan.edgeB - sB * 0.012, Math.min(1.2, len), 0.8, false, -sB, ART[(H(salt, 7, 0xA28) * ART.length) | 0]);
        // a small table + 2 chairs by the kitchen when there is floor for it
        const dnD = L.d0 + 0.8;
        if (sofaD - len / 2 - dnD > 1.3) {
          const tp = F.P(dnD, (tLo + tHi) / 2 + sK * 0.3);
          B.furn("table", tp.x, tp.z, F.yaw(0, 1), { len: 0.9, deep: 0.8, seats: 2 });
          if (plan.tenant === "student") drawLaptop(B, tp.x, tp.z, fy + 0.745);
        }
      } else {
        // narrow: an armchair and a TV on a chest
        const ap = F.P(sofaD, (tLo + tHi) / 2);
        B.furn("armchair", ap.x, ap.z, F.yaw(1, 0));
        const tp = F.P(Math.min(L.d1 - 0.25, sofaD + 1.6), (tLo + tHi) / 2);
        drawTV(B, tp.x, tp.z, F.yaw(-1, 0), 1.0, salt, false);
        B.light(ap.x, ap.z, { kind: "dome", r: 4, i: 0.5 });
      }
    }
    if (plan.kind === "sro" && !vacant) B.light(F.P(D / 2, (tLo + tHi) / 2).x, F.P(D / 2, (tLo + tHi) / 2).z, { kind: "bulb", r: 4.2, i: 0.6 });

    // ---- THE ENTRY: shoes, hooks, a mat -----------------------------------------
    if (!vacant) {
      fbox(B, F, 0.25, fy + 0.006, 0, 0.5, 0.012, 0.8, 0x4a3a2a, { faces: 4 });
      for (let q = 0; q < 2; q++) fbox(B, F, 0.25 + q * 0.15, fy + 0.05, -sB * 0.3, 0.12, 0.1, 0.28, [0x222222, 0x8a4a2a][q]);
      if (plan.bath) {
        // coat hooks on the bath's hall wall, between the front door and the bath door
        const hookT = plan.bath.tWall - sB * 0.08;
        fbox(B, F, 0.95, fy + 1.7, hookT, 0.5, 0.05, 0.04, 0x5a4030);
        fbox(B, F, 0.95, fy + 1.35, hookT - sB * 0.05, 0.3, 0.6, 0.08, plan.accent);                   // a coat on the hook
      }
    } else {
      // BETWEEN TENANTS: a drop cloth, a paint tray, a roller on a pole
      const c = F.P(D * 0.5, (tLo + tHi) / 2);
      B.box(c.x, fy + 0.005, c.z, F.wx(Math.min(2.6, D * 0.4), 1.8), 0.01, F.wz(Math.min(2.6, D * 0.4), 1.8), 0xe0dccf, { faces: 4 });
      B.box(c.x + 0.3, fy + 0.03, c.z + 0.2, 0.32, 0.05, 0.42, 0x8a8f96);
      B.box(c.x - 0.4, fy + 0.13, c.z - 0.3, 0.26, 0.26, 0.26, 0xd8d8d0);
      B.box(c.x - 0.1, fy + 0.7, c.z + 0.6, 0.03, 1.4, 0.03, 0x9a7a4a);
      B.light(c.x, c.z, { kind: "bulb", r: 5, i: 0.55 });
    }

    // ---- WINDOWS: curtains on the facade panes this flat owns ---------------------
    const win = B.windows();
    const facAxis = U.alongX ? "x" : "z", facSide = U.alongX ? Math.sign(U.inZ) : Math.sign(U.inX);
    const curtain = vacant ? null : [0xd8cfc0, 0x6a7a8a, 0x8a5a4a, 0xe8e4dc, 0x4a5a4a][(H(salt, 11, 0xC0C) * 5) | 0];
    for (let i = 0; i < win.length; i++) {
      const w = win[i];
      if (w.axis !== facAxis || w.side !== facSide) continue;
      if (w.x < U.x0 - 0.05 || w.x > U.x1 + 0.05 || w.z < U.z0 - 0.05 || w.z > U.z1 + 0.05) continue;
      const tW = (U.alongX ? w.x : w.z) - (U.alongX ? U.door.x : U.door.z);
      const top = Math.min(ceil - 0.08, w.y + w.hh + 0.18);
      // sill
      fbox(B, F, D - 0.08, w.y - w.hh - 0.02, tW, 0.16, 0.04, w.hw * 2 + 0.16, 0xf2efe8);
      if (!curtain) continue;
      fbox(B, F, D - 0.12, top, tW, 0.03, 0.03, w.hw * 2 + 0.8, 0x3a3a3a);   // rod
      for (const s2 of [-1, 1]) {
        const ct = tW + s2 * (w.hw + 0.2);
        if (ct < tLo + 0.12 || ct > tHi - 0.12) continue;
        const ch = top - (fy + 0.04);
        fbox(B, F, D - 0.14, fy + 0.04 + ch / 2, ct, 0.05, ch, 0.36, curtain);
      }
      if (plan.tenant === "elder" || plan.tenant === "tidy") {
        const sp = F.P(D - 0.15, tW + 0.25);
        plant(B, sp.x, sp.z, w.y - w.hh, false, salt + i);
      }
    }
    // ---- THE OWNER'S ROOM: the default pieces stand down, placements draw in fitout.js
  }

  function drawTV(B, x, z, yaw, len, salt, kids) {
    // a low unit and a flat screen facing `yaw`
    const fx = Math.round(Math.sin(yaw)), fz = Math.round(Math.cos(yaw));
    const along = fx === 0;                      // screen spans x when it faces ±z
    const w = Math.max(1.0, len), fy = B.fy;
    B.box(x, fy + 0.22, z, along ? w : 0.42, 0.44, along ? 0.42 : w, 0x2e2a26);
    const sw = w * 0.75, sh = sw * 0.56;
    const sy = fy + 0.46 + 0.05 + sh / 2;
    B.box(x - fx * 0.05, sy, z - fz * 0.05, along ? sw : 0.05, sh, along ? 0.05 : sw, 0x0e0f11);
    // the picture: somebody left the news on
    const scr = [0x3a5a7a, 0x2f4a66, 0x4a6a5a, 0x5a4a6a][(H(x, z, 0x7E1) * 4) | 0];
    B.box(x + fx * -0.05 + fx * 0.028, sy, z + fz * -0.05 + fz * 0.028, along ? sw - 0.06 : 0.004, sh - 0.06, along ? 0.004 : sw - 0.06, scr, { glow: true });
    B.box(x + fx * -0.05 + fx * 0.03, sy - sh * 0.3, z + fz * -0.05 + fz * 0.03, along ? sw - 0.06 : 0.004, sh * 0.14, along ? 0.004 : sw - 0.06, 0xc8342e, { glow: true });
    B.lamp(x + fx * 0.8, z + fz * 0.8, sy, { r: 2.4, i: 0.22, color: 0x9fb8d8 });
    if (kids) B.box(x + (along ? w * 0.3 : 0.6 * fx), fy + 0.06, z + (along ? 0.6 * fz : w * 0.3), 0.3, 0.12, 0.2, 0xd04040);
  }
  function drawLaptop(B, x, z, y) {
    B.box(x, y + 0.01, z, 0.34, 0.02, 0.24, 0x3a3a3e);
    B.box(x, y + 0.13, z - 0.12, 0.34, 0.22, 0.012, 0x3a3a3e);
    B.box(x, y + 0.13, z - 0.112, 0.3, 0.18, 0.003, 0x9ab8d8, { glow: true });
  }

  /* ========================================================================
     "residential" — the corridor and every flat off it
     ======================================================================== */
  CBZ.fitoutPlan("residential", function (B) {
    const info = B.info || {};
    const units = info.units || [];
    const C = info.corridor;
    const fy = B.fy;
    if (C) {
      // the hall: a runner down the middle, skirting, lights on a 4 m pitch
      const along = C.alongX;
      const c0 = C.cLo + 0.08, c1 = C.cHi - 0.08;
      const r0 = C.runLo, r1 = C.runHi;
      const hallMat = B.k === 0 ? "terrazzo" : "carpet";
      if (along) B.plane(r0, c0, r1, c1, fy, hallMat, B.k === 0 ? 0xffffff : 0xb8a8a0, { cell: 1.2 });
      else B.plane(c0, r0, c1, r1, fy, hallMat, B.k === 0 ? 0xffffff : 0xb8a8a0, { cell: 1.2 });
      if (along) B.plane(r0, c0, r1, c1, B.ceil - 0.01, "ceiling", 0xffffff, { down: true, cell: 1.2 });
      else B.plane(c0, r0, c1, r1, B.ceil - 0.01, "ceiling", 0xffffff, { down: true, cell: 1.2 });
      const n = Math.max(1, Math.round((r1 - r0) / 4.2));
      for (let i = 0; i < n; i++) {
        const rr = r0 + (i + 0.5) * (r1 - r0) / n, cc = (c0 + c1) / 2;
        B.light(along ? rr : cc, along ? cc : rr, { kind: "dome", r: 4.6, i: 0.5,
          rect: along ? { x0: r0, x1: r1, z0: c0, z1: c1 } : { x0: c0, x1: c1, z0: r0, z1: r1 } });
      }
      // each flat's front: paint + skirting on the corridor face, a frame round
      // the door, a mat. Only where there IS a corridor wall (a built flat).
      const hallPaint = [0xd8d2c4, 0xc9cfc8, 0xd4ccbf][(B.h(1, 2, 0x4A11) * 3) | 0];
      for (let i = 0; i < units.length; i++) {
        const U = units[i];
        const face = U.alongX ? U.door.z : U.door.x;
        const side = -(U.alongX ? U.inZ : U.inX);          // the corridor is behind the door
        const faceC = face + side * 0.16;                   // corridor-side face of the corridor wall
        const lo = U.alongX ? U.x0 - 0.08 : U.z0 - 0.08, hi = U.alongX ? U.x1 + 0.08 : U.z1 + 0.08;
        const dc = U.alongX ? U.door.x : U.door.z;
        B.skin(U.alongX ? "x" : "z", faceC, Math.max(lo, r0), Math.min(hi, r1), side,
          { tint: hallPaint, gaps: [{ c: dc, w: 1.14, h: 2.2 }] });
        const ax = U.alongX;
        const fc = 0x6a5a48;
        const off = faceC + side * 0.03;
        for (const s2 of [-1, 1]) B.box(ax ? dc + s2 * 0.56 : off, B.y0 + 1.1, ax ? off : dc + s2 * 0.56, ax ? 0.07 : 0.06, 2.2, ax ? 0.06 : 0.07, fc);
        B.box(ax ? dc : off, B.y0 + 2.23, ax ? off : dc, ax ? 1.2 : 0.06, 0.07, ax ? 0.06 : 1.2, fc);
        // a mat, and a peephole/knocker height plate on some doors
        const mx = ax ? dc : faceC + side * 0.35, mz = ax ? faceC + side * 0.35 : dc;
        if (B.h(dc, i, 0x4A12) < 0.7) B.box(mx, fy + 0.006, mz, ax ? 0.8 : 0.5, 0.012, ax ? 0.5 : 0.8, [0x4a3a2a, 0x3a4a5a, 0x5a2a2a][i % 3], { faces: 4 });
        drawUnit(B, U);
      }
      // ground floor: a mailbox bank by the way in
      if (B.k === 0 && B.b.localDoor) {
        const d = B.b.localDoor, tx = -d.nz, tz = d.nx;
        const mx = d.x + d.nx * 3.0 + tx * 1.35, mz = d.z + d.nz * 3.0 + tz * 1.35;
        if (B.clear(mx, mz, 0.1)) {
          const w = 1.2;
          B.box(mx, fy + 1.15, mz, Math.abs(tx) > 0.5 ? 0.3 : w, 0.9, Math.abs(tx) > 0.5 ? w : 0.3, 0x8a8e92);
          for (let q = 0; q < 12; q++) {
            const cx = (q % 4 - 1.5) * 0.28, cy = ((q / 4) | 0) * 0.28 - 0.28;
            B.box(mx + tx * cx - d.nx * 0.155, fy + 1.15 + cy, mz + tz * cx - d.nz * 0.155,
              Math.abs(tx) > 0.5 ? 0.01 : 0.24, 0.22, Math.abs(tx) > 0.5 ? 0.24 : 0.01, 0x6a6e72);
          }
        }
      }
    } else {
      for (let i = 0; i < units.length; i++) drawUnit(B, units[i]);
    }
  });

  /* ========================================================================
     "flat" — the one-dwelling storey (buildings.js furnishApartmentFloor)
     ======================================================================== */
  CBZ.fitoutPlan("flat", function (B) {
    const r = B.rect; if (!r) return;
    const info = B.info || {}, fy = B.fy;
    if (info.vacant) {
      B.plane(r.x0, r.z0, r.x1, r.z1, fy, "concrete", 0xffffff);
      const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
      B.box(cx, fy + 0.005, cz, 2.6, 0.01, 1.8, 0xe0dccf, { faces: 4 });
      B.box(cx + 0.4, fy + 0.13, cz - 0.3, 0.26, 0.26, 0.26, 0xd8d8d0);
      B.light(cx, cz, { kind: "bulb", r: 7, i: 0.6 });
      return;
    }
    const z = info.zones;
    B.plane(r.x0, r.z0, r.x1, r.z1, fy, "wood", 0xffffff, { holes: z && z.bath ? [z.bath].concat(B.holes()) : B.holes() });
    if (z && z.bath) B.plane(z.bath.x0, z.bath.z0, z.bath.x1, z.bath.z1, fy + 0.004, "tile", 0xffffff, { cell: 0.6 });
    if (z && z.din) B.plane(z.din.x0, z.din.z0, z.din.x1, z.din.z1, fy + 0.004, "tile", 0xe8e4dc, { cell: 0.6 });
    const rooms = z ? [z.liv, z.din, z.bed, z.bath] : [r];
    for (let i = 0; i < rooms.length; i++) {
      const R = rooms[i]; if (!R) continue;
      B.light((R.x0 + R.x1) / 2, (R.z0 + R.z1) / 2, { kind: i === 0 ? "pendant" : "dome", drop: 0.5, r: 5, i: 0.6, rect: R });
    }
    if (z && z.liv) {
      plant(B, z.liv.x0 + 0.4, z.liv.z0 + 0.4, fy, true, 3);
      plant(B, z.liv.x0 + 0.4, z.liv.z1 - 0.4, fy, false, 5);
    }
  });

  /* ========================================================================
     CATALOGUE DRAW VERBS (the owner's furnishing API draws these)
     ======================================================================== */
  if (CBZ.fitoutDraw) {
    CBZ.fitoutDraw("tv", function (B, x, z, yaw) { drawTV(B, x, z, yaw, 1.6, 1, false); });
    CBZ.fitoutDraw("plant", function (B, x, z) { plant(B, x, z, B.fy, true, x + z); });
    CBZ.fitoutDraw("rug", function (B, x, z, yaw) {
      const sw = Math.abs(Math.sin(yaw || 0)) > 0.7;
      B.box(x, B.fy + 0.006, z, sw ? 1.7 : 2.4, 0.012, sw ? 2.4 : 1.7, RUG[(H(x, z, 0x2A6) * RUG.length) | 0], { faces: 4 });
    });
  }
  CBZ.fitoutProps = { plant: plant, drawTV: drawTV, drawLaptop: drawLaptop };
})();
