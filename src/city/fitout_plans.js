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
      plan.bed = { x: p.x, z: p.z, yaw: F.yaw(-1, 0), len: 2.1, wide: wide, d: bdc, t: tb2, tone: { linen: 0xe8e8ee, duvet: plan.linen } };
      plan.living = { d0: front + 0.1, d1: dB - 0.12 };
    } else if (D - front >= 3.3 && W >= 2.6) {
      plan.kind = "studio";
      // bed in an alcove at the window, head to the bath-side party wall
      const len = 2.0, wide = Math.min(1.4, D - front - 1.4);
      const dC = D - 0.12 - wide / 2 - 0.35;
      const tC = edgeB - sB * (len / 2 + 0.08);
      const p = F.P(dC, tC);
      plan.bed = { x: p.x, z: p.z, yaw: F.yaw(0, sB), len: len, wide: Math.max(0.9, wide), d: dC, t: tC, tone: { linen: 0xe8e8ee, duvet: plan.linen } };
      plan.living = { d0: front + 0.1, d1: dC - wide / 2 - 0.2 };
    } else {
      plan.kind = "sro";
      const len = 1.95, wide = 0.95;
      const dC = Math.max(front + wide / 2 + 0.3, D - 0.12 - wide / 2 - 0.2);
      const tC = edgeB - sB * (len / 2 + 0.08);
      const p = F.P(dC, tC);
      if (dC + wide / 2 < D - 0.05 && Math.abs(tC - (tLo + tHi) / 2) + len / 2 < W / 2 + 0.01)
        plan.bed = { x: p.x, z: p.z, yaw: F.yaw(0, sB), len: len, wide: wide, d: dC, t: tC, tone: { linen: 0xe8e8ee, duvet: plan.linen } };
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
  // gaps are authored in the frame (t for an across wall, d for an along wall).
  // A gap's door leaf is authored in the frame too — {hinge: which end of the
  // gap (+1 = the high d/t end), side: which way it swings (+d / +t)} — and is
  // turned into the wall's world terms here, where the d axis may run backwards.
  function remapGaps(o, F, fixed, across, U) {
    if (!o || !o.gaps) return o;
    const out = Object.assign({}, o);
    const dirSign = (U.alongX ? U.inZ : U.inX) < 0 ? -1 : 1;
    out.gaps = o.gaps.map(function (g) {
      const p = across ? F.P(fixed, g.c) : F.P(g.c, fixed);
      const c = across ? (U.alongX ? p.x : p.z) : (U.alongX ? p.z : p.x);
      const r = { c: c, w: g.w, h: g.h };
      if (g.leaf) r.leaf = across
        ? { hinge: g.leaf.hinge, side: g.leaf.side * dirSign, color: g.leaf.color }
        : { hinge: g.leaf.hinge * dirSign, side: g.leaf.side, color: g.leaf.color };
      return r;
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

  const PORC = 0xf4f4f2, CHROME = 0xc9cdd1, STEEL = 0xb9bec4;
  const COATS = [0x2c3440, 0x4a3b2c, 0x3b4636, 0x5a2e2e, 0x7a6a50, 0x23262b];

  // A POTTED PLANT is the kit's F.planter (one plant for every interior in
  // the game): a snake plant on a sill, a ficus in a living-room corner.
  function plant(B, x, z, y, big, salt) {
    return B.furn("planter", x, z, (Math.round(salt || 0) & 3) * Math.PI / 2,
      { atY: y, kind: big ? "tree" : "snake", s: big ? 0.82 : 0.55 });
  }
  // A TABLE LAMP standing ON a surface at yb: turned base, stem, a drum shade
  // that is CLOTH (lit by its own bulb's baked source, so it glows the way
  // fabric does) and the bright mouth under it. The old one was a lit cube
  // hovering 6 cm over a 4 cm puck: the floating white block beside the bed.
  function tableLamp(B, x, z, yb, o) {
    o = o || {};
    const sh = o.shade == null ? 0xe9dfcc : o.shade, base = o.base == null ? 0x6a5a48 : o.base;
    B.box(x, yb + 0.02, z, 0.13, 0.04, 0.13, base);
    B.box(x, yb + 0.07, z, 0.08, 0.06, 0.08, base);
    B.box(x, yb + 0.165, z, 0.016, 0.13, 0.016, 0x9a9690);
    B.box(x, yb + 0.285, z, 0.28, 0.13, 0.28, sh);                                  // drum 0.22..0.35
    B.box(x, yb + 0.37, z, 0.21, 0.04, 0.21, sh);                                   // crown 0.35..0.39
    B.box(x, yb + 0.218, z, 0.25, 0.004, 0.25, 0xfff0d0, { glow: true, faces: 8 });  // the lit mouth
    B.lamp(x, z, yb + 0.28, { r: o.r || 2.4, i: o.i == null ? 0.42 : o.i, rect: o.rect || undefined });
  }
  // A BEDSIDE TABLE whose drawer faces +d or +t (dirD/dirT = the room side):
  // four short legs, a carcass, a drawer with a pull, a top that oversails.
  // Returns the top's height.
  function nightstand(B, F, d, t, col, dirD, dirT) {
    const y = B.fy;
    for (let a = -1; a <= 1; a += 2) for (let b = -1; b <= 1; b += 2)
      fbox(B, F, d + a * 0.17, y + 0.04, t + b * 0.15, 0.035, 0.08, 0.035, col);
    fbox(B, F, d, y + 0.29, t, 0.4, 0.42, 0.36, col);                                // carcass 0.08..0.50
    fbox(B, F, d, y + 0.51, t, 0.44, 0.02, 0.4, col);                                // top → 0.52
    const fd = d + dirD * 0.186, ft = t + dirT * 0.186;
    fbox(B, F, fd, y + 0.42, ft, dirD ? 0.012 : 0.36, 0.13, dirD ? 0.36 : 0.012, col);             // drawer
    fbox(B, F, fd + dirD * 0.012, y + 0.42, ft + dirT * 0.012, dirD ? 0.012 : 0.1, 0.018, dirD ? 0.1 : 0.012, 0xb9b4aa);   // pull
    return y + 0.52;
  }
  // A CLOSE-COUPLED WC against the wall at d = 0, facing +d, at lateral t:
  // trap pedestal, a bowl with a narrower rounded front, a seat, the lid (up
  // or down), the cistern and its flush plate. Real sizes: seat 0.40, 0.64
  // projection off the wall, cistern top 0.82.
  function toilet(B, F, t, lidUp) {
    const y = B.fy;
    fbox(B, F, 0.11, y + 0.61, t, 0.17, 0.4, 0.38, PORC);                // cistern 0.41..0.81
    fbox(B, F, 0.11, y + 0.82, t, 0.19, 0.02, 0.4, 0xeeeeec);             // its lid
    fbox(B, F, 0.11, y + 0.834, t, 0.07, 0.008, 0.07, CHROME);            // flush plate
    fbox(B, F, 0.33, y + 0.13, t, 0.3, 0.26, 0.2, PORC);                  // trap pedestal
    fbox(B, F, 0.36, y + 0.32, t, 0.34, 0.12, 0.36, PORC);                // bowl
    fbox(B, F, 0.575, y + 0.32, t, 0.11, 0.12, 0.28, PORC);               // its rounded front
    fbox(B, F, 0.41, y + 0.39, t, 0.44, 0.02, 0.35, 0xfafaf8);            // seat → 0.40
    if (lidUp) fbox(B, F, 0.215, y + 0.61, t, 0.02, 0.4, 0.33, 0xfafaf8);
    else fbox(B, F, 0.41, y + 0.41, t, 0.43, 0.02, 0.34, 0xf3f3f1);
  }
  // A VANITY against a wall along d at lateral tWall (its face), opening
  // toward s: plinth, carcass, a pair of doors, a stone counter at 0.84, an
  // inset basin (white rim, the bowl in shadow), a pillar tap.
  function vanity(B, F, dC, tWall, s) {
    const y = B.fy, tc = tWall + s * 0.23;
    fbox(B, F, dC, y + 0.05, tc - s * 0.03, 0.56, 0.1, 0.38, 0x2a2a2a);            // plinth, set back
    fbox(B, F, dC, y + 0.45, tc, 0.6, 0.7, 0.44, 0xeae9e4);                          // carcass 0.10..0.80
    fbox(B, F, dC, y + 0.45, tc + s * 0.226, 0.586, 0.66, 0.012, 0xf5f5f1);          // doors
    fbox(B, F, dC, y + 0.45, tc + s * 0.233, 0.004, 0.64, 0.004, 0x8e8e8a);          // their meeting line
    for (const e of [-1, 1]) fbox(B, F, dC + e * 0.05, y + 0.68, tc + s * 0.24, 0.012, 0.1, 0.012, CHROME);
    fbox(B, F, dC, y + 0.82, tc + s * 0.01, 0.63, 0.04, 0.47, 0xd6d2ca);             // counter → 0.84
    fbox(B, F, dC, y + 0.845, tc + s * 0.03, 0.46, 0.01, 0.34, PORC);               // basin rim → 0.85
    fbox(B, F, dC, y + 0.8505, tc + s * 0.035, 0.38, 0.001, 0.26, 0xc4c9ca);        // the bowl in shadow
    fbox(B, F, dC, y + 0.94, tWall + s * 0.06, 0.035, 0.18, 0.035, CHROME);          // tap
    fbox(B, F, dC, y + 1.02, tWall + s * 0.11, 0.03, 0.025, 0.1, CHROME);            // spout
    fbox(B, F, dC + 0.05, y + 1.05, tWall + s * 0.06, 0.012, 0.012, 0.06, CHROME);   // lever
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
     THE KITCHEN RUN — a fitted kitchen, built the way one is: a plinth set
     back for your toes, 600 carcasses with doors and a drawer line, a 40 mm
     worktop at 0.92 that oversails the doors, a sink and a hob each CENTRED
     on their own unit (the oven is under the hob), wall units at 1.50-2.20
     with a chimney hood between them over the hob, tiled splashback, and a
     fridge-freezer at the door end. Everything the old run did as one slab
     with its sink and hob buried INSIDE the worktop (both boxes sat below the
     worktop's top face, so neither was ever visible).
     ======================================================================== */
  function drawKitchen(B, U, F, plan, salt, vacant) {
    const k = plan.kitchen, fy = B.fy, ceil = B.ceil;
    const s = k.behindBath ? plan.sB : plan.sK;          // which party wall it hugs (+t side of the room = -s)
    const tE = k.tEdge, tC = tE - s * 0.31;             // cabinet centre line
    const d0 = k.d0, d1 = k.d1;
    const body = [0x55606e, 0xe6e2da, 0x3c4a3c, 0x7a5a3e][(H(salt, 3, 0xC17) * 4) | 0];
    const top = [0xd9d6cf, 0x2a2a2a, 0xb9aa90][(H(salt, 4, 0xC18) * 3) | 0];
    const face = tC - s * 0.29;                          // the carcass front face
    // ---- fridge-freezer by the door end --------------------------------------
    const frD = d0 + 0.36;
    fbox(B, F, frD, fy + 0.93, tC, 0.68, 1.86, 0.62, 0xdcdcda);
    fbox(B, F, frD, fy + 1.24, face - s * 0.021, 0.66, 0.008, 0.004, 0x8a8a8a);          // freezer door split
    for (const hy of [0.98, 1.5]) fbox(B, F, frD + 0.27, fy + hy, face - s * 0.0325, 0.025, hy < 1 ? 0.32 : 0.22, 0.025, 0x9a9a9a);
    // ---- base units ------------------------------------------------------------
    const b0 = d0 + 0.72, bL = Math.max(0.6, d1 - b0);
    const n = Math.max(1, Math.floor(bL / 0.58)), uw = bL / n;
    const unitC = function (i) { return b0 + uw * (i + 0.5); };
    const sinkI = Math.min(n - 1, Math.max(0, Math.round(n * 0.35 - 0.5)));
    let hobI = Math.min(n - 1, Math.max(0, Math.round(n * 0.8 - 0.5)));
    if (hobI === sinkI && n > 1) hobI = sinkI === n - 1 ? n - 2 : n - 1;
    const hasHob = hobI !== sinkI;                      // a one-unit run is a sink and a worktop
    fbox(B, F, b0 + bL / 2, fy + 0.05, tC + s * 0.03, bL, 0.1, 0.52, 0x262626);           // plinth, 6 cm back
    fbox(B, F, b0 + bL / 2, fy + 0.49, tC, bL, 0.78, 0.58, body);                         // carcasses 0.10..0.88
    fbox(B, F, b0 + bL / 2, fy + 0.9, tC - s * 0.01, bL + 0.02, 0.04, 0.62, top);         // worktop → 0.92
    for (let i = 0; i < n; i++) {
      const uc = unitC(i), oven = i === hobI && hasHob;
      if (oven) {
        fbox(B, F, uc, fy + 0.8, face - s * 0.011, uw - 0.006, 0.1, 0.022, 0x1d1f22);                  // control strip
        fbox(B, F, uc, fy + 0.43, face - s * 0.011, uw - 0.006, 0.6, 0.022, 0x2a2c30);                 // oven door
        fbox(B, F, uc, fy + 0.45, face - s * 0.023, uw - 0.12, 0.34, 0.003, 0x0e0f10);                 // its window
        fbox(B, F, uc, fy + 0.7, face - s * 0.045, uw - 0.14, 0.02, 0.02, STEEL);                     // bar handle
        continue;
      }
      fbox(B, F, uc, fy + 0.79, face - s * 0.009, uw - 0.006, 0.14, 0.018, body);                     // drawer
      fbox(B, F, uc, fy + 0.415, face - s * 0.009, uw - 0.006, 0.59, 0.018, body);                    // door
      fbox(B, F, uc, fy + 0.8, face - s * 0.026, 0.16, 0.015, 0.015, STEEL);                          // drawer pull
      fbox(B, F, uc + (i % 2 ? -1 : 1) * (uw / 2 - 0.05), fy + 0.6, face - s * 0.026, 0.015, 0.12, 0.015, STEEL);   // door pull
    }
    // sink: steel rim ON the worktop, the bowl in shadow, a gooseneck tap
    const sinkD = unitC(sinkI);
    fbox(B, F, sinkD, fy + 0.922, tC - s * 0.02, Math.min(0.56, uw - 0.04), 0.004, 0.46, STEEL);
    fbox(B, F, sinkD, fy + 0.9245, tC - s * 0.03, Math.min(0.46, uw - 0.12), 0.001, 0.36, 0x5f666c);
    fbox(B, F, sinkD, fy + 1.06, tE - s * 0.07, 0.035, 0.28, 0.035, CHROME);
    fbox(B, F, sinkD, fy + 1.2, tE - s * 0.16, 0.03, 0.03, 0.2, CHROME);
    fbox(B, F, sinkD, fy + 1.16, tE - s * 0.255, 0.028, 0.07, 0.028, CHROME);
    // hob: ceramic glass on the worktop over the oven, four rings
    const hobD = unitC(hobI);
    if (hasHob) {
      fbox(B, F, hobD, fy + 0.923, tC - s * 0.02, Math.min(0.58, uw - 0.02), 0.006, 0.51, 0x121314);
      for (const a of [-1, 1]) for (const c2 of [-1, 1])
        fbox(B, F, hobD + a * 0.13, fy + 0.9265, tC - s * 0.02 + c2 * 0.12, 0.17, 0.001, 0.17, 0x2c2d2f);
    }
    // splashback tile to the underside of the wall units
    skinAt(B, U, F, "t", tE - s * 0.012, b0, d1, { side: -s, mat: "subway", tint: 0xffffff, h: 1.5, noSkirt: true });
    // wall units either side of a chimney hood over the hob
    const wu = function (ua, ub) {
      if (ub - ua < 0.3) return;
      const L = ub - ua, m = (ua + ub) / 2;
      fbox(B, F, m, fy + 1.85, tE - s * 0.17, L, 0.7, 0.34, body);
      const nn = Math.max(1, Math.round(L / 0.5)), dw = L / nn;
      for (let i = 0; i < nn; i++) {
        const c = ua + dw * (i + 0.5);
        fbox(B, F, c, fy + 1.85, tE - s * 0.347, dw - 0.006, 0.68, 0.014, body);
        fbox(B, F, c + (i % 2 ? -1 : 1) * (dw / 2 - 0.05), fy + 1.56, tE - s * 0.36, 0.015, 0.1, 0.015, STEEL);
      }
      fbox(B, F, m, fy + 1.497, tE - s * 0.3, L - 0.06, 0.006, 0.03, 0xfff3d8, { glow: true, faces: 8 });   // under-cabinet LED
    };
    if (hasHob) {
      const hh = 0.32;
      wu(b0, hobD - hh);
      wu(hobD + hh, d1);
      fbox(B, F, hobD, fy + 1.65, tE - s * 0.25, 0.6, 0.1, 0.5, STEEL);                  // hood canopy 1.60..1.70
      fbox(B, F, hobD, (fy + 1.7 + ceil) / 2, tE - s * 0.14, 0.26, ceil - fy - 1.7, 0.26, STEEL);   // chimney
    } else wu(b0, d1);
    B.lamp(F.P(b0 + bL / 2, tE - s * 0.3).x, F.P(b0 + bL / 2, tE - s * 0.3).z, fy + 1.4, { r: 2.2, i: 0.35, color: 0xfff1d6 });
    // life on the worktop
    if (!vacant) {
      const topY = fy + 0.92;
      // the worktop things stand on the units that are NOT the sink or the hob
      const free = [];
      for (let i = 0; i < n; i++) if (i !== sinkI && !(hasHob && i === hobI)) free.push(i);
      if (free.length) {
        const kd = unitC(free[0]);
        fbox(B, F, kd, topY + 0.01, tC + s * 0.08, 0.18, 0.02, 0.18, 0x2a2a2a);        // kettle base
        fbox(B, F, kd, topY + 0.13, tC + s * 0.08, 0.16, 0.22, 0.15, 0xd8d8d6);        // kettle
        fbox(B, F, kd, topY + 0.25, tC + s * 0.08, 0.1, 0.02, 0.1, 0x2a2a2a);          // lid
        fbox(B, F, kd - 0.1, topY + 0.14, tC + s * 0.08, 0.03, 0.16, 0.05, 0x2a2a2a);  // handle
      }
      if (free.length > 1) {
        const cd = unitC(free[free.length - 1]);
        fbox(B, F, cd, topY + 0.01, tC - s * 0.05, 0.34, 0.02, 0.24, plan.wood);       // chopping board
        fbox(B, F, cd + 0.12, topY + 0.1, tE - s * 0.1, 0.1, 0.2, 0.14, 0x3a2e24);     // knife block
      }
      if (plan.tenant === "messy" || plan.tenant === "student") {
        for (let q = 0; q < 3; q++) fbox(B, F, sinkD - 0.04 + q * 0.03, fy + 0.93 + q * 0.022, tC - s * 0.03, 0.24, 0.02, 0.24, 0xefefef);   // dishes in the sink
        if (hasHob) {
          fbox(B, F, hobD + 0.13, topY + 0.05, tC - s * 0.14, 0.26, 0.09, 0.26, 0x3a3a3a);                 // a pan left on
          fbox(B, F, hobD + 0.13, topY + 0.07, tC - s * 0.36, 0.03, 0.02, 0.2, 0x1a1a1a);                  // its handle, out over the front
        }
      }
      if (plan.tenant === "family") highChair(B, F, d1 + 0.45, tC - s * 0.75);
    }
    B.light(F.P((d0 + d1) / 2, tC - s * 0.7).x, F.P((d0 + d1) / 2, tC - s * 0.7).z, { kind: "dome", r: 4.2, i: 0.55 });
  }
  // a wooden high chair: splayed legs, a seat at 0.55, a back, a tray
  function highChair(B, F, d, t) {
    const y = B.fy, c = 0xe8d8b8;
    for (let a = -1; a <= 1; a += 2) for (let b = -1; b <= 1; b += 2)
      fbox(B, F, d + a * 0.2, y + 0.28, t + b * 0.2, 0.035, 0.56, 0.035, c);
    for (let a = -1; a <= 1; a += 2) fbox(B, F, d + a * 0.2, y + 0.12, t, 0.03, 0.03, 0.4, c);   // foot bars
    fbox(B, F, d, y + 0.57, t, 0.36, 0.03, 0.34, c);                                 // seat
    fbox(B, F, d - 0.17, y + 0.8, t, 0.03, 0.44, 0.32, c);                           // back
    fbox(B, F, d + 0.2, y + 0.76, t, 0.2, 0.025, 0.42, 0xf4f2ec);                    // tray
  }

  /* ========================================================================
     THE BATHROOM — WC on the corridor wall, a vanity and mirror cabinet on the
     hall wall, a walk-in shower in the far corner tiled to 2.1 m with a glass
     screen on a wall channel, a rain head on a riser, a mixer, a towel and a
     bath mat. The door opens IN and stands against the wall when that wall
     is clear of the shower.
     ======================================================================== */
  function drawBath(B, U, F, plan, paint, vacant) {
    const bt = plan.bath, sB = plan.sB, fy = B.fy;
    const t0 = Math.min(bt.tWall, bt.tEdge), t1 = Math.max(bt.tWall, bt.tEdge);
    const tw = bt.tWall;
    const tin = tw + sB * 0.06;                             // the hall wall's bath-side face
    const bw = Math.abs(bt.tEdge - tin);
    const shW = Math.min(0.9, bw * 0.5), shD = Math.min(1.0, bt.d1 - 0.3);
    const shT = bt.tEdge - sB * (shW / 2 + 0.02), shDc = bt.d1 - 0.07 - shD / 2;
    const leafIn = bw - shW - 0.8 > 0.04;
    wallAlong(B, U, F, tw, 0.02, bt.d1, { gaps: [{ c: bt.doorD, w: 0.78, h: 2.05, leaf: leafIn ? { hinge: 1, side: sB } : null }], tint: paint, mat: "plaster" });
    wallAcross(B, U, F, bt.d1, t0 - (sB < 0 ? 0 : 0.06), t1 + (sB < 0 ? 0.06 : 0), { tint: paint, mat: "plaster" });
    // TILE. Wet walls to 1.25 m, and the shower's two walls to 2.1 m. The far
    // wall's tile now sits ON its face (it used to hang 2 cm off it).
    const shA = bt.tEdge - sB * (shW + 0.04);
    const shLo = Math.min(shA, bt.tEdge), shHi = Math.max(shA, bt.tEdge);
    const dryLo = sB > 0 ? t0 + 0.02 : shHi, dryHi = sB > 0 ? shLo : t1 - 0.02;
    skinAt(B, U, F, "d", bt.d1 - 0.05, dryLo, dryHi, { side: -1, mat: "subway", tint: 0xffffff, h: 1.25, noSkirt: true });
    skinAt(B, U, F, "d", bt.d1 - 0.05, shLo, shHi, { side: -1, mat: "subway", tint: 0xffffff, h: 2.1, noSkirt: true });
    skinAt(B, U, F, "d", 0.012, t0 + 0.02, t1 - 0.02, { side: 1, mat: "subway", tint: 0xffffff, h: 1.25, noSkirt: true });
    skinAt(B, U, F, "t", bt.tEdge - sB * 0.008, bt.d1 - 0.07 - shD - 0.02, bt.d1 - 0.07, { side: -sB, mat: "subway", tint: 0xffffff, h: 2.1, noSkirt: true });
    // WC against the corridor wall, 0.45 off the hall wall; paper beside it
    const wcT = tin + sB * 0.45;
    toilet(B, F, wcT, H(U.n | 0, 5, 0x7C1) < 0.3);
    fbox(B, F, 0.62, fy + 0.72, tin + sB * 0.03, 0.14, 0.02, 0.05, CHROME);
    fbox(B, F, 0.62, fy + 0.66, tin + sB * 0.07, 0.11, 0.11, 0.11, 0xf8f6f0);
    // shower: low tray, glass screen on a channel, mixer, riser, rain head
    fbox(B, F, shDc, fy + 0.02, shT, shD, 0.04, shW, 0xeeeeec);
    fbox(B, F, shDc, fy + 0.041, shT, 0.1, 0.002, 0.1, 0x9a9ea2);                    // waste
    const gT = shT - sB * (shW / 2);
    fbox(B, F, shDc, fy + 1.05, gT, shD, 1.9, 0.01, 0xcfe3ea, { glass: true });
    fbox(B, F, bt.d1 - 0.075, fy + 1.05, gT, 0.02, 1.9, 0.03, CHROME);              // wall channel
    fbox(B, F, shDc, fy + 2.005, gT, shD, 0.012, 0.02, CHROME);                      // top rail
    const wf = bt.tEdge - sB * 0.02;                                                 // the tiled face
    fbox(B, F, shDc, fy + 1.05, wf - sB * 0.01, 0.13, 0.13, 0.02, CHROME);           // mixer plate
    fbox(B, F, shDc, fy + 1.05, wf - sB * 0.05, 0.02, 0.02, 0.07, CHROME);           // lever
    fbox(B, F, shDc, fy + 1.6, wf - sB * 0.02, 0.022, 1.0, 0.022, CHROME);           // riser
    fbox(B, F, shDc, fy + 2.1, wf - sB * 0.17, 0.022, 0.022, 0.3, CHROME);           // arm
    fbox(B, F, shDc, fy + 2.08, wf - sB * 0.3, 0.22, 0.014, 0.22, CHROME);           // rain head
    // basin + mirror cabinet on the hall wall (inside), clear of the door
    const bnD = 0.95;
    if (Math.abs(bnD - bt.doorD) > 0.65) {
      vanity(B, F, bnD, tin, sB);
      fbox(B, F, bnD, fy + 1.55, tin + sB * 0.06, 0.55, 0.7, 0.12, 0xe4e4e0);        // mirror cabinet
      fbox(B, F, bnD, fy + 1.55, tin + sB * 0.1215, 0.53, 0.68, 0.003, 0xaebbc2);    // its mirror door
      fbox(B, F, bnD, fy + 1.97, tin + sB * 0.05, 0.5, 0.05, 0.08, 0xd8d8d4);        // bar light
      fbox(B, F, bnD, fy + 1.9445, tin + sB * 0.05, 0.46, 0.004, 0.05, 0xfff6e6, { glow: true, faces: 8 });
      B.loot(F.P(bnD, tin).x, F.P(bnD, tin).z, "medicine");
    }
    // towel on a rail on the party wall by the shower's open end, a bath mat
    const trD = bt.d1 - 0.07 - shD - 0.35;
    if (trD > 0.75) {
      fbox(B, F, trD, fy + 1.1, bt.tEdge - sB * 0.06, 0.5, 0.02, 0.02, CHROME);
      if (!vacant) {
        fbox(B, F, trD, fy + 0.9, bt.tEdge - sB * 0.075, 0.42, 0.4, 0.035, plan.accent);
        fbox(B, F, trD, fy + 1.1, bt.tEdge - sB * 0.06, 0.42, 0.035, 0.05, plan.accent);
      }
    }
    if (!vacant) fbox(B, F, shDc - shD / 2 - 0.26, fy + 0.004, shT, 0.45, 0.008, Math.min(0.72, shW), plan.accent, { faces: 4 });
    B.light(F.P(bt.d1 / 2, (bt.tEdge + tin) / 2).x, F.P(bt.d1 / 2, (bt.tEdge + tin) / 2).z,
      { kind: "dome", r: 3.2, i: 0.7, rect: (function () { const a = F.P(0, t0), b = F.P(bt.d1, t1); return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) }; })() });
  }

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

    if (plan.bath) drawBath(B, U, F, plan, paint, vacant);
    if (plan.kitchen) drawKitchen(B, U, F, plan, salt, vacant);

    // ---- BEDROOM ----------------------------------------------------------------
    const bed = plan.bed;
    if (plan.bedroom) {
      const br = plan.bedroom;
      // the door opens INTO the bedroom and stands against the party-wall side
      wallAcross(B, U, F, br.d, tLo, tHi, { gaps: [{ c: br.gapT, w: br.gapW, h: 2.05, leaf: { hinge: sK, side: 1 } }], tint: paint, mat: "plaster" });
      B.light(F.P((br.d + D) / 2, (tLo + tHi) / 2).x, F.P((br.d + D) / 2, (tLo + tHi) / 2).z,
        { kind: "dome", r: 4.2, i: 0.55, rect: lit(br.d, D, tLo, tHi) });
    }
    if (bed && !vacant && !cleared) {
      const headD = plan.kind === "onebed" ? plan.bedroom.d + 0.3 : bed.d;
      if (plan.kind === "onebed") {
        // a bedside table each side of the headboard, a lamp ON each
        for (const s2 of [-1, 1]) {
          const nt = bed.t + s2 * (bed.wide / 2 + 0.3);
          if (nt < tLo + 0.24 || nt > tHi - 0.24) continue;
          const ty = nightstand(B, F, headD, nt, plan.wood, 1, 0);
          const lp = F.P(headD - 0.04, nt);
          tableLamp(B, lp.x, lp.z, ty, { rect: lit(plan.bedroom.d, D, tLo, tHi) });
          if (s2 === 1) for (let q = 0; q < 3; q++)                                   // a stack of books, lying flat
            fbox(B, F, headD + 0.1, ty + 0.016 + q * 0.032, nt + (q - 1) * 0.012, 0.2 - q * 0.02, 0.03, 0.15 - q * 0.01, [0x7a2e2e, 0x2e4a7a, 0xc8b88a][q]);
        }
        const rugD = bed.d + 0.4;
        fbox(B, F, rugD, fy + 0.006, bed.t, 1.6, 0.012, Math.min(bed.wide + 1.0, tHi - tLo - 0.3), plan.rug, { faces: 4 });
        // a timber wardrobe on the kitchen-side party wall, clear of the bed and the door
        const wT = plan.edgeK - sK * 0.31;
        const bedEdge = bed.t + sK * bed.wide / 2;
        if ((wT - sK * 0.31 - bedEdge) * sK > 0.55) {
          const wd0 = plan.bedroom.d + 1.0, wd1 = Math.min(D - 0.3, wd0 + 1.4);
          const wp = F.P((wd0 + wd1) / 2, wT);
          if (wd1 - wd0 > 0.9 && B.furn("wardrobe", wp.x, wp.z, F.yaw(0, -sK), { len: wd1 - wd0, h: 2.1, deep: 0.6, tone: { wood: plan.wood } }))
            B.loot(wp.x, wp.z, "closet");
        }
        // art over the bed
        frameArt(B, F, U, plan.bedroom.d + 0.06, fy + 1.55, bed.t, Math.min(1.1, bed.wide), 0.7, true, 1, ART[(H(salt, 9, 0xA27) * ART.length) | 0]);
      } else {
        // alcove bed: one bedside table and a lamp at the window end
        const nd = bed.d - (bed.wide / 2 + 0.26), ntT = plan.edgeB - sB * 0.25;
        if (nd > (plan.living ? plan.living.d0 : 0) + 0.3) {
          const ty = nightstand(B, F, nd, ntT, plan.wood, 0, -sB);
          const lp = F.P(nd, ntT + sB * 0.04);
          tableLamp(B, lp.x, lp.z, ty, { r: 2.2, i: 0.36 });
        }
      }
      // WHAT IS UNDER THE MATTRESS
      const lootP = F.P(bed.d, bed.t);
      B.loot(lootP.x, lootP.z, "mattress");
      if (plan.tenant === "messy" || plan.tenant === "student") {
        // a heap of clothes: a few garments, not a blue brick
        const ld = bed.d + (plan.kind === "onebed" ? 1.35 : 0), lt = bed.t + sK * (bed.wide / 2 + 0.3);
        fbox(B, F, ld, fy + 0.04, lt, 0.55, 0.08, 0.45, 0x4a5a7a);
        fbox(B, F, ld + 0.08, fy + 0.1, lt - 0.05, 0.36, 0.06, 0.3, 0x2a2a2e);
        fbox(B, F, ld - 0.1, fy + 0.14, lt + 0.04, 0.26, 0.04, 0.22, 0xb8b0a0);
      }
    }

    // ---- LIVING -------------------------------------------------------------------
    const L = plan.living;
    if (L && !vacant && !cleared && L.d1 - L.d0 > 1.8) {
      const len = Math.min(2.2, L.d1 - L.d0 - 0.4);
      const sofaD = (L.d0 + L.d1) / 2 + (plan.kitchen && !plan.kitchen.behindBath ? Math.min(0.5, (L.d1 - L.d0) * 0.1) : 0);
      const W2 = tHi - tLo;
      if (W2 >= 3.0 && len >= 1.5) {
        // the room is arranged round the TV: sofa back to the bath-side party
        // wall, a coffee table 40 cm off its front, the TV on the opposite wall
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
        const ctT = sofaT - sB * 1.02;
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
        // TV on a low console against the kitchen-side wall (past the kitchen run)
        const tvT = plan.edgeK - sK * 0.22;
        const kEndD = plan.kitchen && !plan.kitchen.behindBath ? plan.kitchen.d1 : 0;
        if (sofaD - 0.8 > kEndD + 0.1) {
          drawTV(B, F.P(sofaD, tvT).x, F.P(sofaD, tvT).z, F.yaw(0, sB), Math.min(1.8, len), salt);
        } else {
          // no wall for it: the console stands free facing the sofa, back to the kitchen
          drawTV(B, F.P(sofaD, tvT - sK * 0.5).x, F.P(sofaD, tvT - sK * 0.5).z, F.yaw(0, sB), Math.min(1.5, len), salt);
        }
        B.light(F.P(sofaD, (sofaT + tvT) / 2).x, F.P(sofaD, (sofaT + tvT) / 2).z, { kind: "pendant", drop: 0.55, r: 4.5, i: 0.55, shade: plan.accent });
        // a floor lamp at the sofa's end, a plant in the corner
        const flD = sofaD + (len / 2 + 0.3);
        if (flD < L.d1 - 0.2) {
          const fp = F.P(flD, sofaT);
          B.furn("lamp", fp.x, fp.z, 0, { h: 1.55 });
          B.lamp(fp.x, fp.z, fy + 1.4, { r: 3.0, i: 0.42 });
        }
        const pl = F.P(L.d1 - 0.38, plan.edgeB - sB * 0.38);
        plant(B, pl.x, pl.z, fy, true, salt);
        // art over the sofa
        frameArt(B, F, U, sofaD, fy + 1.55, plan.edgeB - sB * 0.012, Math.min(1.2, len), 0.8, false, -sB, ART[(H(salt, 7, 0xA28) * ART.length) | 0]);
        // a small table + 2 chairs by the kitchen when there is floor for it
        const dnD = L.d0 + 0.8;
        if (sofaD - len / 2 - dnD > 1.3) {
          const tp = F.P(dnD, (tLo + tHi) / 2 + sK * 0.3);
          B.furn("table", tp.x, tp.z, F.yaw(0, 1), { len: 0.9, deep: 0.8, seats: 2, tone: { wood: plan.wood, cloth: plan.sofa } });
          if (plan.tenant === "student") drawLaptop(B, tp.x, tp.z, fy + 0.745);
        }
      } else {
        // narrow: an armchair and a TV on a console, facing each other
        const ap = F.P(sofaD, (tLo + tHi) / 2);
        B.furn("armchair", ap.x, ap.z, F.yaw(1, 0), { tone: { cloth: plan.sofa } });
        const tp = F.P(Math.min(L.d1 - 0.25, sofaD + 1.6), (tLo + tHi) / 2);
        drawTV(B, tp.x, tp.z, F.yaw(-1, 0), 1.0, salt);
        B.light(ap.x, ap.z, { kind: "dome", r: 4, i: 0.5 });
      }
    }
    if (plan.kind === "sro" && !vacant) B.light(F.P(D / 2, (tLo + tHi) / 2).x, F.P(D / 2, (tLo + tHi) / 2).z, { kind: "bulb", r: 4.2, i: 0.6 });

    // ---- THE ENTRY: shoes, hooks with coats on them, a mat -----------------------
    if (!vacant) {
      fbox(B, F, 0.25, fy + 0.006, 0, 0.5, 0.012, 0.8, 0x4a3a2a, { faces: 4 });
      for (let q = 0; q < 2; q++) {
        const sd = 0.2 + q * 0.14, st = -sB * 0.3;
        fbox(B, F, sd, fy + 0.03, st, 0.11, 0.06, 0.27, [0x222222, 0x6a3a22][q]);          // sole + upper
        fbox(B, F, sd, fy + 0.08, st - 0.07, 0.1, 0.06, 0.1, [0x222222, 0x6a3a22][q]);     // heel counter
      }
      if (plan.bath) {
        // a hook rail on the bath's hall wall between the front door and the
        // bath door, with a coat and a bag hanging OFF it (they stand proud of
        // the wall: a coat is a thing with a body, not a board)
        const face = plan.bath.tWall - sB * 0.06;
        fbox(B, F, 0.9, fy + 1.72, face - sB * 0.01, 0.62, 0.08, 0.02, plan.wood);
        for (let q = -1; q <= 1; q++) fbox(B, F, 0.9 + q * 0.22, fy + 1.7, face - sB * 0.04, 0.02, 0.02, 0.05, 0x3a3a3a);
        const cc = COATS[(H(salt, 13, 0xC0A) * COATS.length) | 0];
        fbox(B, F, 0.68, fy + 1.62, face - sB * 0.08, 0.36, 0.1, 0.12, cc);                // shoulders
        fbox(B, F, 0.68, fy + 1.24, face - sB * 0.09, 0.44, 0.68, 0.15, cc);               // body
        fbox(B, F, 0.68, fy + 1.58, face - sB * 0.155, 0.12, 0.1, 0.02, 0x1d1d1f);         // the collar opening
        fbox(B, F, 1.12, fy + 1.45, face - sB * 0.06, 0.28, 0.32, 0.09, plan.accent);      // a tote bag
        fbox(B, F, 1.12, fy + 1.64, face - sB * 0.06, 0.18, 0.08, 0.012, plan.accent);    // its strap
      }
    } else {
      // BETWEEN TENANTS: a drop cloth, a paint tray, a tin, a roller on a pole
      const c = F.P(D * 0.5, (tLo + tHi) / 2);
      B.box(c.x, fy + 0.005, c.z, F.wx(Math.min(2.6, D * 0.4), 1.8), 0.01, F.wz(Math.min(2.6, D * 0.4), 1.8), 0xe0dccf, { faces: 4 });
      B.box(c.x + 0.3, fy + 0.03, c.z + 0.2, 0.32, 0.05, 0.42, 0x8a8f96);
      B.box(c.x + 0.3, fy + 0.056, c.z + 0.12, 0.26, 0.004, 0.2, 0xe8e4da);
      B.box(c.x - 0.4, fy + 0.13, c.z - 0.3, 0.24, 0.24, 0.24, 0xd8d8d0);
      B.box(c.x - 0.4, fy + 0.255, c.z - 0.3, 0.25, 0.012, 0.25, 0x9a9a96);
      B.box(c.x - 0.1, fy + 0.7, c.z + 0.6, 0.025, 1.4, 0.025, 0x9a7a4a);
      B.box(c.x - 0.1, fy + 1.42, c.z + 0.6, 0.23, 0.06, 0.06, 0xf0ede4);
      B.light(c.x, c.z, { kind: "bulb", r: 5, i: 0.55 });
    }

    // ---- WINDOWS: pleated curtains on the facade panes this flat owns -------------
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
      fbox(B, F, D - 0.12, top, tW, 0.025, 0.025, w.hw * 2 + 0.8, 0x3a3a3a);         // pole
      for (const e of [-1, 1]) fbox(B, F, D - 0.12, top, tW + e * (w.hw + 0.41), 0.045, 0.045, 0.03, 0x3a3a3a);   // finials
      const ch = top - (fy + 0.04);
      for (const s2 of [-1, 1]) {
        const ct = tW + s2 * (w.hw + 0.2);
        if (ct < tLo + 0.12 || ct > tHi - 0.12) continue;
        // four pleats, alternately forward and back: drawn-back cloth folds
        for (let q = 0; q < 4; q++) {
          const pt = ct + (q - 1.5) * 0.09;
          fbox(B, F, D - 0.14 - (q & 1) * 0.03, fy + 0.04 + ch / 2, pt, 0.03, ch, 0.095, curtain);
        }
      }
      if (plan.tenant === "elder" || plan.tenant === "tidy") {
        const sp = F.P(D - 0.15, tW + 0.25);
        plant(B, sp.x, sp.z, w.y - w.hh, false, salt + i);
      }
    }
    // ---- THE OWNER'S ROOM: the default pieces stand down, placements draw in fitout.js
  }

  // A TV ON A MEDIA CONSOLE facing `yaw`: a console on short legs with door
  // fronts, and a flat panel standing on its own foot ON the console (the old
  // screen hovered 7 cm over its unit). The picture: somebody left the news on.
  function drawTV(B, x, z, yaw, len) {
    const fx = Math.round(Math.sin(yaw)), fz = Math.round(Math.cos(yaw));
    const along = fx === 0;                      // screen spans x when it faces ±z
    const w = Math.max(1.0, len), fy = B.fy, dp = 0.4;
    const bx = function (u, y, v, su, h, sv, c, o) {    // u along the console, v toward the room
      B.box(x + (along ? u : fx * v), y, z + (along ? fz * v : u), along ? su : sv, h, along ? sv : su, c, o);
    };
    for (const a of [-1, 1]) for (const b2 of [-1, 1]) bx(a * (w / 2 - 0.06), fy + 0.05, b2 * (dp / 2 - 0.05), 0.04, 0.1, 0.04, 0x1e1c1a);
    bx(0, fy + 0.29, 0, w, 0.38, dp, 0x2e2a26);                                        // console 0.10..0.48
    const nd = Math.max(2, Math.round(w / 0.5)), dw = w / nd;
    for (let i = 0; i < nd; i++) {
      bx(-w / 2 + dw * (i + 0.5), fy + 0.29, dp / 2 + 0.006, dw - 0.008, 0.34, 0.012, 0x36312c);
      bx(-w / 2 + dw * (i + 0.5), fy + 0.42, dp / 2 + 0.018, 0.1, 0.012, 0.012, 0x8a8680);
    }
    const sw = w * 0.72, sh = sw * 0.5625;
    const base = fy + 0.48;
    bx(0, base + 0.006, -0.02, 0.36, 0.012, 0.2, 0x151619);                            // foot
    bx(0, base + 0.05, -0.05, 0.06, 0.08, 0.03, 0x151619);                             // neck
    const sy = base + 0.08 + sh / 2;
    bx(0, sy, -0.03, sw, sh, 0.03, 0x0e0f11);                                           // panel
    const scr = [0x3a5a7a, 0x2f4a66, 0x4a6a5a, 0x5a4a6a][(H(x, z, 0x7E1) * 4) | 0];
    bx(0, sy + 0.01, -0.03 + 0.018, sw - 0.03, sh - 0.05, 0.003, scr, { glow: true });
    bx(0, sy - sh * 0.3, -0.03 + 0.0205, sw - 0.03, sh * 0.13, 0.002, 0xc8342e, { glow: true });   // the news ticker
    bx(0, base + 0.035, 0.12, Math.min(0.8, sw * 0.6), 0.07, 0.09, 0x1c1d20);          // soundbar
    B.lamp(x + fx * 0.8, z + fz * 0.8, sy, { r: 2.4, i: 0.22, color: 0x9fb8d8 });
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
      if (along) B.plane(r0, c0, r1, c1, B.ceil - 0.01, "plaster", 0xf2f0ea, { down: true, cell: 1.2 });
      else B.plane(c0, r0, c1, r1, B.ceil - 0.01, "plaster", 0xf2f0ea, { down: true, cell: 1.2 });
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
      B.plane(r.x0, r.z0, r.x1, r.z1, B.ceil - 0.01, "plaster", 0xe6e4df, { down: true, cell: 1.2, holes: B.holes() });
      const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
      B.box(cx, fy + 0.005, cz, 2.6, 0.01, 1.8, 0xe0dccf, { faces: 4 });
      B.box(cx + 0.4, fy + 0.13, cz - 0.3, 0.26, 0.26, 0.26, 0xd8d8d0);
      B.light(cx, cz, { kind: "bulb", r: 7, i: 0.6 });
      return;
    }
    const z = info.zones;
    B.plane(r.x0, r.z0, r.x1, r.z1, fy, "wood", 0xffffff, { holes: z && z.bath ? [z.bath].concat(B.holes()) : B.holes() });
    B.plane(r.x0, r.z0, r.x1, r.z1, B.ceil - 0.01, "plaster", 0xf6f4f0, { down: true, cell: 1.2, holes: B.holes() });
    if (z && z.bath) B.plane(z.bath.x0, z.bath.z0, z.bath.x1, z.bath.z1, fy + 0.004, "tile", 0xffffff, { cell: 0.6 });
    if (z && z.din) B.plane(z.din.x0, z.din.z0, z.din.x1, z.din.z1, fy + 0.004, "tile", 0xe8e4dc, { cell: 0.6 });
    const rooms = z ? [z.liv, z.din, z.bed, z.bath] : [r];
    for (let i = 0; i < rooms.length; i++) {
      const R = rooms[i]; if (!R) continue;
      B.light((R.x0 + R.x1) / 2, (R.z0 + R.z1) / 2, { kind: i === 0 ? "pendant" : "dome", drop: 0.5, r: 5, i: 0.6, rect: R });
    }
    if (z && z.liv) {
      plant(B, z.liv.x0 + 0.45, z.liv.z0 + 0.45, fy, true, 3);
      plant(B, z.liv.x0 + 0.35, z.liv.z1 - 0.35, fy, false, 5);
    }
  });

  /* ========================================================================
     CATALOGUE DRAW VERBS (the owner's furnishing API draws these)
     ======================================================================== */
  if (CBZ.fitoutDraw) {
    CBZ.fitoutDraw("tv", function (B, x, z, yaw) { drawTV(B, x, z, yaw, 1.6); });
    CBZ.fitoutDraw("plant", function (B, x, z) { plant(B, x, z, B.fy, true, x + z); });
    CBZ.fitoutDraw("rug", function (B, x, z, yaw) {
      const sw = Math.abs(Math.sin(yaw || 0)) > 0.7;
      B.box(x, B.fy + 0.006, z, sw ? 1.7 : 2.4, 0.012, sw ? 2.4 : 1.7, RUG[(H(x, z, 0x2A6) * RUG.length) | 0], { faces: 4 });
    });
  }
  CBZ.fitoutProps = { plant: plant, drawTV: drawTV, drawLaptop: drawLaptop };
})();
