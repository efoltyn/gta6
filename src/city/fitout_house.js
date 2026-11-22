/* ============================================================
   city/fitout_house.js — HOW A HOUSE IS LIVED IN: the "house" fit-out.

   city/house_plan.js decides what a house IS (its rooms, its walls and
   doors, its stair) and builds the part of it the world needs all the time.
   This is everything else, built only while you are at the house and freed
   when you leave (city/fitout.js): the floors, the ceilings, paint on every
   wall, casings round every doorway, linings and a stool in every window
   and curtains or a blind over it, and each room as the room it is:

     hall      a runner, a console under a mirror, coats on a rail, shoes
     living    a sofa under the window facing the television on the hall
               wall, a coffee table on a rug, an armchair, a bookcase, a
               floor lamp, a plant; a fireplace in a house with money
     kitchen   the fitted run a flat has (city/fitout_plans.js's, the same
               carcasses, sink, hob, hood and fridge) on the hall wall, and a
               table by the window
     dining    a table for six under a pendant, a sideboard
     study     a desk at the window, bookcases, a reading chair
     bedroom   the bed's head on the outside wall with a bedside table and a
               lamp each side, a chest of drawers, a wardrobe in the closet
               nook, a rug at the foot
     bathroom  tiled: a bath with a screen and a shower over it, a WC, a
               vanity under a mirror cabinet, a towel rail, a mat
     the stair its strings, its balusters and handrail, a cupboard under it,
               the balustrade round the well upstairs

   WHO LIVES HERE decides the finish (plan.tier, from the neighbourhood's
   own wealth): vinyl and carpet, a small sofa, a blind and a bare bulb in a
   poor street; oak, curtains and shaded lights in an ordinary one; parquet
   and marble, a fireplace, long curtains and more of everything in a rich
   one.

   Every piece is the game's one furniture kit (CBZ.furnish through B.furn),
   so a chair is a chair you can sit in and a bed is a bed you can sleep in.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.fitoutPlan || !CBZ.fitoutProps) return;
  const FP = CBZ.fitoutProps;
  const PW = (CBZ.cityHouse && CBZ.cityHouse.PW) || 0.14;

  function H(a, b, s) { return CBZ.hash01 ? CBZ.hash01(a, b, s) : 0.5; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function shade(hex, f) {
    const r = Math.max(0, Math.min(255, (((hex >> 16) & 255) * f) | 0)), g = Math.max(0, Math.min(255, (((hex >> 8) & 255) * f) | 0)), b = Math.max(0, Math.min(255, ((hex & 255) * f) | 0));
    return (r << 16) | (g << 8) | b;
  }

  const TIERS = {
    poor: { floor: "vinyl", floorTint: 0xd6cbb8, bed: "carpet", bedTint: 0x8f8a80, wet: "vinyl", wetTint: 0xc9cec9, kitchen: "vinyl", kitTint: 0xc9cec9,
            trim: 0xe4dfd3, paintK: 0.93, sofa: 1.7, tv: 1.0, bedW: 1.4, light: "bulb", curtain: "blind" },
    mid:  { floor: "wood", floorTint: 0xffffff, bed: "wood", bedTint: 0xffffff, wet: "tile", wetTint: 0xffffff, kitchen: "tile", kitTint: 0xe8e4dc,
            trim: 0xf2efe8, paintK: 1, sofa: 2.1, tv: 1.5, bedW: 1.6, light: "dome", curtain: "curtain" },
    rich: { floor: "parquet", floorTint: 0xffffff, bed: "wood", bedTint: 0xefe0ca, wet: "marble", wetTint: 0xffffff, kitchen: "marble", kitTint: 0xf2efe9,
            trim: 0xf7f4ee, paintK: 1.02, sofa: 2.5, tv: 2.0, bedW: 1.8, light: "pendant", curtain: "drape" },
  };
  const PAINTS = [0xeee8dc, 0xe6ddd0, 0xdfe5dc, 0xd9e1e8, 0xe9e2d6, 0xefe7e1, 0xdcd4c8];
  const BEDPAINT = [0xd9e1e8, 0xdfe5dc, 0xe8dcd4, 0xe3dbe6, 0xe6ddd0, 0xd6dccf];
  const BOOKS = [0x7b2f2a, 0x2f4a6b, 0x3d5a3a, 0xc9b98f, 0x5b3a5e, 0x2a2a2e, 0xa8672f, 0xd9d2c0];
  const OPP = { front: "back", back: "front", lo: "hi", hi: "lo" };

  CBZ.fitoutPlan("house", function (B) {
    const info = B.info || {}, plan = info.house;
    if (!plan || !plan.F) return;
    const k = info.floor | 0, fl = plan.floors[k];
    if (!fl) return;
    const F = plan.F, fy = B.fy, y0 = B.y0, ceil = B.ceil;
    const T = TIERS[plan.tier] || TIERS.mid;
    const G = FP.frame(F.U);                              // the same frame, as the flat's parts take it
    const salt = Math.round(plan.ox * 3.1 + plan.oz * 7.7) + k * 13;
    const pick = function (arr, s) { return arr[(H(plan.ox + s, plan.oz - s * 0.7, 0x7E50 + s) * arr.length) | 0]; };
    const look = { paint: shade(pick(PAINTS, 1), T.paintK), accent: pick(FP.ACCENT, 2), sofa: pick(FP.SOFA, 3), linen: pick(FP.LINEN, 4),
      rug: pick(FP.RUG, 5), wood: pick(FP.WOOD, 6), curtain: pick([0xd8cfc0, 0x6a7a8a, 0x8a5a4a, 0xe8e4dc, 0x4a5a4a, 0x7a6a8a], 7) };
    const WHITE = 0xf2f0ea, TRIM = T.trim, CHROME = 0xc9cdd1, PORC = 0xf4f4f2;
    const owned = !!(plan.lot && CBZ.cityOwnsLot && CBZ.cityOwnsLot(plan.lot));
    const nn = F.alongX ? F.nz : F.nx;                    // the d axis's sign on its building-local axis

    // ---- boxes in the frame ---------------------------------------------------
    const hb = function (d, y, t, sd, h, st, col, o) { const p = F.P(d, t); return B.box(p.x, y, p.z, F.alongX ? st : sd, h, F.alongX ? sd : st, col, o); };
    const loc = function (r) { return F.R(r.d0, r.d1, r.t0, r.t1); };
    // the building-local face bit (B.box o.faces) of a frame direction
    const bit = function (dd, dt) {
      const vx = F.nx * dd + (F.alongX ? dt : 0), vz = F.nz * dd + (F.alongX ? 0 : dt);
      return vx > 0.5 ? 1 : vx < -0.5 ? 2 : vz > 0.5 ? 16 : 32;
    };
    // a room's wall: its face in the frame, the way into the room, its span
    const wallOf = function (r, w) {
      if (w === "front") return { d: r.d0, dd: 1, dt: 0, lo: r.t0, hi: r.t1, deep: r.d1 - r.d0 };
      if (w === "back") return { d: r.d1, dd: -1, dt: 0, lo: r.t0, hi: r.t1, deep: r.d1 - r.d0 };
      if (w === "lo") return { t: r.t0, dd: 0, dt: 1, lo: r.d0, hi: r.d1, deep: r.t1 - r.t0 };
      return { t: r.t1, dd: 0, dt: -1, lo: r.d0, hi: r.d1, deep: r.t1 - r.t0 };
    };
    // (d, t) of the point `a` along wall w of room r, `off` into the room
    const at = function (r, w, a, off) {
      const W = wallOf(r, w);
      return W.d != null ? { d: W.d + W.dd * off, t: a } : { d: a, t: W.t + W.dt * off };
    };
    // a box on a wall: centre `a` along it, `off` off it, `la` long, `lo` across
    const rw = function (r, w, a, y, off, la, h, lo, col, o) {
      const p = at(r, w, a, off);
      return (w === "front" || w === "back") ? hb(p.d, y, p.t, lo, h, la, col, o) : hb(p.d, y, p.t, la, h, lo, col, o);
    };
    // the coordinate along walls square to `from`, x metres in from it
    const inFrom = function (r, from, x) {
      return from === "front" ? r.d0 + x : from === "back" ? r.d1 - x : from === "lo" ? r.t0 + x : r.t1 - x;
    };
    const yawOf = function (w) { const W = wallOf({ d0: 0, d1: 1, t0: 0, t1: 1 }, w); return F.yaw(W.dd, W.dt); };
    const winsOn = function (r, w, ext) {
      if (!ext && !r.ext[w]) return [];
      const W = wallOf(r, w);
      return plan.wins.filter(function (q) { return q.wall === w && q.k === k && q.a1 > W.lo + 0.02 && q.a0 < W.hi - 0.02; });
    };
    // a frame for the flat's parts whose d runs along building-local (ux, uz) from p
    const subFrame = function (p, ux, uz, r) {
      const R = loc(r);
      return FP.frame({ x0: R.x0, x1: R.x1, z0: R.z0, z1: R.z1, door: { x: p.x, z: p.z }, inX: ux, inZ: uz, alongX: Math.abs(uz) > 0.5, floor: k, n: salt & 255, id: "h" });
    };
    const dirL = function (dd, dt) { return { x: F.nx * dd + (F.alongX ? dt : 0), z: F.nz * dd + (F.alongX ? 0 : dt) }; };

    // ---- what a room keeps clear, and what stands where ------------------------
    const prep = function (r) {
      r._keep = [];
      for (const dr of r.doors) {
        const hw = dr.w / 2 + (dr.leaf ? 0.15 : 0.04), reach = Math.max(1.05, dr.leaf ? dr.w + 0.15 : 1.0);
        if (dr.wall === "front") r._keep.push({ d0: r.d0, d1: r.d0 + reach, t0: dr.a - hw, t1: dr.a + hw });
        else if (dr.wall === "back") r._keep.push({ d0: r.d1 - reach, d1: r.d1, t0: dr.a - hw, t1: dr.a + hw });
        else if (dr.wall === "lo") r._keep.push({ d0: dr.a - hw, d1: dr.a + hw, t0: r.t0, t1: r.t0 + reach });
        else if (dr.wall === "hi") r._keep.push({ d0: dr.a - hw, d1: dr.a + hw, t0: r.t1 - reach, t1: r.t1 });
      }
      // the street door's own floor: nothing stands in the way in
      if (k === 0 && r.ext.front && r.t0 < 0.8 && r.t1 > -0.8) r._keep.push({ d0: 0, d1: 1.5, t0: -1.05, t1: 1.05 });
      // the owner's fixtures have their places (city/realestate.js)
      for (const nm in plan.spots) {
        const sp = plan.spots[nm];
        if (!sp || sp.room !== r) continue;
        const len = nm === "rack" ? 1.6 : nm === "wardrobe" ? 1.3 : 0.8, deep = nm === "rack" ? 0.36 : 0.66;
        const along = sp.fd ? len / 2 : deep / 2 + 0.3, across = sp.fd ? deep / 2 + 0.3 : len / 2;
        r._keep.push({ d0: sp.d - along - (sp.fd ? 0 : 0), d1: sp.d + along, t0: sp.t - across, t1: sp.t + across, spot: nm });
      }
    };
    const hit = function (a, c) { return a.d1 > c.d0 + 0.01 && a.d0 < c.d1 - 0.01 && a.t1 > c.t0 + 0.01 && a.t0 < c.t1 - 0.01; };
    const free = function (r, R) {
      const inMain = R.d0 >= r.d0 - 0.01 && R.d1 <= r.d1 + 0.01 && R.t0 >= r.t0 - 0.01 && R.t1 <= r.t1 + 0.01;
      const a = r.alc;
      const inAlc = a && R.d0 >= a.d0 - 0.01 && R.d1 <= a.d1 + 0.01 && R.t0 >= a.t0 - 0.01 && R.t1 <= a.t1 + 0.01;
      if (!inMain && !inAlc) return false;
      for (const q of r._keep) if (hit(R, q)) return false;
      return true;
    };
    /* a piece `len` along wall w, `deep` off it, with `front` of floor kept
       before it: slid along the wall from `pref` until it is clear. Returns
       { d, t (its centre), yaw (facing the room), a, R } or null. */
    const put = function (r, w, pref, len, deep, front, o) {
      o = o || {};
      const W = wallOf(r, w), gap = o.gap == null ? 0.02 : o.gap;
      const lo = W.lo + len / 2 + 0.04, hi = W.hi - len / 2 - 0.04;
      if (hi < lo - 1e-6) return null;
      const wins = o.noWin ? winsOn(r, w) : null;
      const span = Math.max(hi - lo, 0);
      const start = clamp(pref == null ? (lo + hi) / 2 : pref, lo, hi);
      for (let s = 0; s <= span + 0.01; s += 0.1) {
        for (const a of (s ? [start - s, start + s] : [start])) {
          if (a < lo - 1e-6 || a > hi + 1e-6) continue;
          if (wins && wins.some(function (q) { return q.a1 > a - len / 2 - 0.05 && q.a0 < a + len / 2 + 0.05 && q.y0 - y0 < (o.tall || 2.0); })) continue;
          const c = at(r, w, a, gap + deep / 2), e = at(r, w, a, gap + deep + front);
          const R = W.d != null
            ? { d0: Math.min(W.d, e.d), d1: Math.max(W.d, e.d), t0: a - len / 2, t1: a + len / 2 }
            : { d0: a - len / 2, d1: a + len / 2, t0: Math.min(W.t, e.t), t1: Math.max(W.t, e.t) };
          if (!free(r, R)) continue;
          const body = W.d != null
            ? { d0: Math.min(W.d, c.d + W.dd * deep / 2), d1: Math.max(W.d, c.d + W.dd * deep / 2), t0: a - len / 2, t1: a + len / 2 }
            : { d0: a - len / 2, d1: a + len / 2, t0: Math.min(W.t, c.t + W.dt * deep / 2), t1: Math.max(W.t, c.t + W.dt * deep / 2) };
          r._keep.push(body);
          const p = F.P(c.d, c.t);
          return { d: c.d, t: c.t, x: p.x, z: p.z, yaw: F.yaw(W.dd, W.dt), a: a, wall: w, dd: W.dd, dt: W.dt, R: body };
        }
      }
      return null;
    };
    const kit = function (name, P, o) { return P ? B.furn(name, P.x, P.z, o && o.yaw != null ? o.yaw : P.yaw, o) : null; };
    const lightAt = function (r, d, t, o) {
      const p = F.P(d, t);
      B.light(p.x, p.z, Object.assign({ kind: T.light, drop: 0.5, r: 4.6, i: 0.6, rect: loc(r), shade: look.accent }, o || {}));
    };
    const rug = function (d, t, sd, st, col) { hb(d, fy + 0.006, t, sd, 0.012, st, col, { faces: 4 }); };
    const art = function (r, w, a, y, wide, high, col) {
      rw(r, w, a, y, 0.015, wide, high, 0.03, 0x1d1b19);
      rw(r, w, a, y, 0.032, wide - 0.08, high - 0.08, 0.004, 0xf2eee6);
      rw(r, w, a, y, 0.036, wide - 0.2, high - 0.2, 0.004, col);
    };
    // a timber bookcase with its books, `len` along the wall
    const bookcase = function (r, P, len, hgt) {
      if (!P) return;
      const w = P.wall, deep = 0.32, col = look.wood;
      rw(r, w, P.a, fy + hgt / 2, 0.02 + 0.012, len, hgt, 0.02, shade(col, 0.8));                       // back
      for (const e of [-1, 1]) rw(r, w, P.a + e * (len / 2 - 0.015), fy + hgt / 2, 0.02 + deep / 2, 0.03, hgt, deep, col);
      const n = Math.max(3, Math.round(hgt / 0.38));
      for (let i = 0; i <= n; i++) {
        const yy = fy + 0.04 + (hgt - 0.08) * i / n;
        rw(r, w, P.a, yy, 0.02 + deep / 2, len - 0.06, 0.03, deep - 0.02, col);
        if (i === n) break;
        let x = -len / 2 + 0.06, q = 0;
        while (x < len / 2 - 0.1 && q < 30) {
          const hh = H(P.a + x * 7.1, i * 3.3 + P.d, 0x5b0 + q), bw = 0.028 + hh * 0.04, bh = Math.min((hgt - 0.08) / n - 0.06, 0.2 + H(x, i, 0x5b7 + q) * 0.1);
          if (H(x * 13.7, i + P.t, 0x5c1 + q) < 0.14) { x += 0.09; q++; continue; }
          rw(r, w, P.a + x + bw / 2, yy + 0.015 + bh / 2, 0.02 + deep / 2 + 0.02, bw, bh, deep - 0.1, BOOKS[(H(x * 3.1, i - P.d, 0x5c9 + q) * BOOKS.length) | 0]);
          x += bw + 0.004; q++;
        }
      }
      const R = F.R(P.R.d0, P.R.d1, P.R.t0, P.R.t1);
      B.solid(R.x0, R.x1, R.z0, R.z1, fy, fy + hgt);
    };

    // ---- 1. FLOORS, CEILING ------------------------------------------------------
    const WET = { bath: 1, wc: 1 };
    const floorOf = function (r) {
      if (WET[r.type]) return [T.wet, T.wetTint, 0.6];
      if (r.type === "kitchen") return [T.kitchen, T.kitTint, 0.6];
      if (r.type === "bed" || r.type === "dress" || r.type === "store") return [T.bed, T.bedTint, 1.0];
      return [T.floor, T.floorTint, 1.0];
    };
    /* (the ceiling is laid room by room like the floor: each room's lights are
       baked into its own surfaces only, and one sheet over the whole house
       took a saw-tooth of lit and unlit triangles along every wall it crossed) */
    const planeR = function (R, f) {
      if (!(R.x1 - R.x0 > 0.02 && R.z1 - R.z0 > 0.02)) return;
      B.plane(R.x0, R.z0, R.x1, R.z1, fy, f[0], f[1], { cell: f[2] });
      B.plane(R.x0 - PW / 2, R.z0 - PW / 2, R.x1 + PW / 2, R.z1 + PW / 2, ceil - 0.01, "plaster", 0xf6f4f0, { down: true, cell: 1.2 });
    };
    for (const r of fl.rooms) {
      const f = floorOf(r);
      planeR(loc(r), f);
      if (r.alc) planeR(loc(r.alc), f);
      if (r.cor) {
        if (r.cor.t0 < r.t0) planeR(F.R(r.cor.d0, r.cor.d1, r.cor.t0, r.t0), f);
        if (r.cor.t1 > r.t1) planeR(F.R(r.cor.d0, r.cor.d1, r.t1, r.cor.t1), f);
      }
    }

    // ---- 2. THE PARTITIONS: paint on both faces, a casing round each doorway ----
    const roomAt = function (d, t) {
      const inR = function (q) { return q && d > q.d0 && d < q.d1 && t > q.t0 && t < q.t1; };
      for (const r of fl.rooms) if (inR(r) || inR(r.alc) || inR(r.cor)) return r;
      return null;
    };
    const paintOf = function (r) {
      if (!r) return look.paint;
      if (r._paint != null) return r._paint;
      let p = look.paint;
      if (r.type === "bed") p = shade(BEDPAINT[(H(plan.ox + r.t0 * 3, plan.oz + r.d0 * 5 + k, 0x9A1) * BEDPAINT.length) | 0], T.paintK);
      else if (r.type === "study") p = shade(look.accent, 1.18);
      else if (r.type === "kitchen") p = shade(0xf0ede4, T.paintK);
      else if (r.type === "dining") p = shade(look.paint, 0.96);
      r._paint = p;
      return p;
    };
    const cuts = [];
    for (const r of fl.rooms) for (const q of [r, r.alc, r.cor]) if (q) { const R = loc(q); cuts.push(R); }
    for (const L of fl.local || []) {
      const runX = L.axis === "x";
      const pts = [L.from, L.to];
      for (const R of cuts) for (const v of (runX ? [R.x0, R.x1] : [R.z0, R.z1])) if (v > L.from + 0.06 && v < L.to - 0.06) pts.push(v);
      pts.sort(function (a, c) { return a - c; });
      for (const side of [1, -1]) {
        const face = L.at + side * PW / 2;
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i], c = pts[i + 1];
          if (c - a < 0.06) continue;
          const m = (a + c) / 2, px = runX ? m : face + side * 0.2, pz = runX ? face + side * 0.2 : m;
          const r = roomAt(F.dOf(px, pz), F.tOf(px, pz));
          if (!r) continue;
          const gaps = L.gaps.filter(function (g) { return g.c + g.w / 2 > a && g.c - g.w / 2 < c; }).map(function (g) { return { c: g.c, w: g.w, h: g.h }; });
          if (WET[r.type]) B.skin(L.axis, face, a, c, side, { mat: "subway", tint: 0xffffff, gaps: gaps, noSkirt: true });
          else B.skin(L.axis, face, a, c, side, { tint: paintOf(r), gaps: gaps, skirt: TRIM });
        }
      }
      for (const g of L.gaps) {
        const g0 = g.c - g.w / 2, g1 = g.c + g.w / 2, ch = g.h;
        // the threshold: a board across the wall's thickness, between two floors
        if (runX) B.box(g.c, fy + 0.002, L.at, g.w, 0.012, PW + 0.02, shade(look.wood, 1.05), { faces: 4 });
        else B.box(L.at, fy + 0.002, g.c, PW + 0.02, 0.012, g.w, shade(look.wood, 1.05), { faces: 4 });
        if (runX) {
          B.box(g0 - 0.03, y0 + ch / 2, L.at, 0.06, ch, PW + 0.05, TRIM);
          B.box(g1 + 0.03, y0 + ch / 2, L.at, 0.06, ch, PW + 0.05, TRIM);
          B.box(g.c, y0 + ch + 0.03, L.at, g.w + 0.12, 0.06, PW + 0.05, TRIM);
        } else {
          B.box(L.at, y0 + ch / 2, g0 - 0.03, PW + 0.05, ch, 0.06, TRIM);
          B.box(L.at, y0 + ch / 2, g1 + 0.03, PW + 0.05, ch, 0.06, TRIM);
          B.box(L.at, y0 + ch + 0.03, g.c, PW + 0.05, 0.06, g.w + 0.12, TRIM);
        }
      }
    }

    // ---- 3. THE SHELL'S WALLS: plaster cut round the windows, their linings ----
    const FO = CBZ.facadeOpenings;
    const doorTop = 2.27 + (/townhouse|lobby|office/.test(String(B.b.doorKind || "")) ? 0.5 : 0);
    const extWall = function (r, w, lo, hi) {
      const W = wallOf(r, w), paint = paintOf(r), wet = !!WET[r.type];
      const holes = plan.wins.filter(function (q) { return q.wall === w && q.k === k && q.a1 > lo && q.a0 < hi; })
        .map(function (q) { return { a0: q.a0, a1: q.a1, y0: q.y0, y1: q.y1 }; });
      if (w === "front" && k === 0 && lo < 0.8 && hi > -0.8) holes.push({ a0: -0.82, a1: 0.82, y0: -1, y1: doorTop });
      const rects = FO && FO.solidRects ? FO.solidRects(lo, hi, fy, ceil, holes) : [[lo, hi, fy, ceil]];
      const fb = bit(W.dd, W.dt);
      for (const q of rects) rw(r, w, (q[0] + q[1]) / 2, (q[2] + q[3]) / 2, 0.012, q[1] - q[0], q[3] - q[2], 0.01, wet ? 0xffffff : paint, { mat: wet ? "subway" : "plaster", faces: fb });
      // skirting, broken at the street door
      if (!wet) {
        const runs = (w === "front" && k === 0 && lo < 0.8 && hi > -0.8) ? [[lo, -0.9], [0.9, hi]] : [[lo, hi]];
        for (const q of runs) if (q[1] - q[0] > 0.08) rw(r, w, (q[0] + q[1]) / 2, fy + 0.05, 0.025, q[1] - q[0], 0.1, 0.03, TRIM);
      }
      // each window: its reveal lined, a stool along the bottom
      for (const hq of holes) {
        if (hq.y0 < 0.3) continue;
        const a0 = Math.max(lo, hq.a0), a1 = Math.min(hi, hq.a1);
        if (a1 - a0 < 0.2) continue;
        rw(r, w, a0 + 0.006, (hq.y0 + hq.y1) / 2, -0.13, 0.012, hq.y1 - hq.y0, 0.26, WHITE);
        rw(r, w, a1 - 0.006, (hq.y0 + hq.y1) / 2, -0.13, 0.012, hq.y1 - hq.y0, 0.26, WHITE);
        rw(r, w, (a0 + a1) / 2, hq.y1 - 0.006, -0.13, a1 - a0, 0.012, 0.26, WHITE);
        rw(r, w, (a0 + a1) / 2, hq.y0 + 0.014, -0.11, a1 - a0 + 0.08, 0.028, 0.32, TRIM);
      }
      return holes;
    };
    // curtains (or a blind) over a run of windows on wall w of room r
    const dress = function (r, w, lo, hi, kind) {
      const ws = plan.wins.filter(function (q) { return q.wall === w && q.k === k && q.a1 > lo && q.a0 < hi && q.y0 > 0.3; })
        .sort(function (a, c) { return a.a0 - c.a0; });
      const groups = [];
      for (const q of ws) {
        const g = groups[groups.length - 1];
        if (g && q.a0 - g.a1 < 0.4) { g.a1 = Math.max(g.a1, q.a1); g.y1 = Math.max(g.y1, q.y1); g.y0 = Math.min(g.y0, q.y0); }
        else groups.push({ a0: q.a0, a1: q.a1, y0: q.y0, y1: q.y1 });
      }
      for (const g of groups) {
        const a0 = Math.max(lo + 0.05, g.a0), a1 = Math.min(hi - 0.05, g.a1), mid = (a0 + a1) / 2;
        if (a1 - a0 < 0.3) continue;
        if (kind === "blind") {
          // a roller blind, half down, on its cassette
          rw(r, w, mid, g.y1 + 0.04, 0.05, a1 - a0 + 0.1, 0.07, 0.07, 0xe9e6de);
          rw(r, w, mid, g.y1 - (g.y1 - g.y0) * 0.22, 0.03, a1 - a0 + 0.04, (g.y1 - g.y0) * 0.44, 0.008, shade(look.curtain, 1.25));
          rw(r, w, mid, g.y1 - (g.y1 - g.y0) * 0.44 - 0.012, 0.03, a1 - a0 + 0.04, 0.024, 0.02, 0xd8d4cb);
          continue;
        }
        const top = Math.min(ceil - 0.07, g.y1 + 0.2);
        const foot = kind === "drape" ? fy + 0.03 : Math.max(fy + 0.03, g.y0 - 0.22);
        rw(r, w, mid, top, 0.12, a1 - a0 + 0.7, 0.025, 0.025, 0x3a3a3a);
        for (const e of [-1, 1]) rw(r, w, mid + e * ((a1 - a0) / 2 + 0.37), top, 0.12, 0.03, 0.045, 0.045, 0x3a3a3a);
        if (kind === "drape") rw(r, w, mid, top + 0.07, 0.1, a1 - a0 + 0.8, 0.16, 0.14, shade(look.curtain, 0.9));   // a pelmet
        const ch = top - foot;
        for (const e of [-1, 1]) {
          const ct = e < 0 ? a0 - 0.2 : a1 + 0.2;
          if (ct < lo + 0.14 || ct > hi - 0.14) continue;
          for (let q = 0; q < 4; q++) rw(r, w, ct + (q - 1.5) * 0.09, foot + ch / 2, 0.14 + (q & 1) * 0.03, 0.095, ch, 0.03, look.curtain);
        }
      }
    };
    for (const r of fl.rooms) {
      for (const w of ["front", "back", "lo", "hi"]) {
        if (!r.ext[w]) continue;
        const W = wallOf(r, w);
        let lo = W.lo, hi = W.hi;
        // a closet nook that reaches the same outside wall is the same wall
        if (r.alc && (w === "lo" || w === "hi") && ((w === "lo" && r.alc.t0 <= r.t0 + 0.01) || (w === "hi" && r.alc.t1 >= r.t1 - 0.01))) lo = Math.min(lo, r.alc.d0);
        extWall(r, w, lo, hi);
        const kind = (WET[r.type] || r.type === "kitchen" || r.type === "store") ? "blind" : T.curtain;
        if (r.type !== "hall" || w !== "front") dress(r, w, lo, hi, kind);
      }
      // the passage's ends, where it runs out to an outside wall
      if (r.cor) {
        const c = { d0: r.cor.d0, d1: r.cor.d1, t0: r.cor.t0, t1: r.cor.t1, type: r.type, _paint: paintOf(r), ext: {} };
        if (c.t0 <= F.tLo + 0.01) { extWall(c, "lo", c.d0, c.d1); dress(c, "lo", c.d0, c.d1, T.curtain === "drape" ? "curtain" : T.curtain); }
        if (c.t1 >= F.tHi - 0.01) { extWall(c, "hi", c.d0, c.d1); dress(c, "hi", c.d0, c.d1, T.curtain === "drape" ? "curtain" : T.curtain); }
      }
    }

    // ---- 4. THE ROOMS ---------------------------------------------------------------
    const tone = { cloth: look.sofa, linen: 0xe8e8ee, duvet: look.linen, wood: look.wood, frame: shade(look.wood, 0.8) };
    const outerOf = function (r) { return (r.t0 + r.t1) / 2 > (F.tLo + F.tHi) / 2 ? "hi" : "lo"; };
    const innerOf = function (r) { return OPP[outerOf(r)]; };

    const R_hall = function (r) {
      const g = plan.g || {}, mid = (r.t0 + r.t1) / 2;
      // the walk: the way in and on to the passage stays clear
      const stair = plan.stair, s = plan.s;
      const walk = stair ? (s > 0 ? [stair.lane[1], r.t1] : [r.t0, stair.lane[0]]) : [r.t0, r.t1];
      const wc = (walk[0] + walk[1]) / 2;
      rug(Math.min(r.d1 - 0.3, 2.4) / 2 + 0.5, wc, Math.min(r.d1 - 1.4, 2.6), Math.min(0.9, walk[1] - walk[0] - 0.3), look.rug);
      hb(0.32, fy + 0.007, 0, 0.5, 0.014, 0.9, 0x4a3a2a, { faces: 4 });                 // the mat inside the door
      lightAt(r, Math.min(1.6, r.d1 * 0.3), wc, { kind: T.light === "bulb" ? "dome" : T.light, r: 4.2 });
      if (r.cor) {
        const c = r.cor, cm = (c.d0 + c.d1) / 2;
        lightAt({ d0: c.d0, d1: c.d1, t0: c.t0, t1: c.t1 }, cm, (c.t0 + c.t1) / 2, { kind: "dome", r: 4.2, i: 0.5 });
        if (c.t1 - c.t0 > 3.2) rug(cm, (c.t0 + c.t1) / 2, 0.7, c.t1 - c.t0 - 1.0, shade(look.rug, 0.9));
      }
      if (k > 0) {
        // the gallery: a chair and a plant at the window over the front door
        const pl = F.P(0.45, wc + (stair && s > 0 ? 0.35 : -0.35));
        FP.plant(B, pl.x, pl.z, fy, true, salt + 3);
        return;
      }
      if (stair) return;                                 // the stair is the hall's furniture
      // the wall on the kitchen's side: a console under a mirror by the door,
      // coats on a rail; the far end of it is kept for the owner's rack
      const w = s > 0 ? "lo" : "hi";
      const P = put(r, w, 1.25, 0.9, 0.3, 0, { gap: 0.02 });
      if (P) {
        kit("credenza", P, { len: 0.9, h: 0.78, deep: 0.3, n: 2, tone: tone });
        rw(r, w, P.a, fy + 1.5, 0.02, 0.6, 0.8, 0.03, shade(look.wood, 0.85));
        rw(r, w, P.a, fy + 1.5, 0.037, 0.5, 0.7, 0.004, 0xaebbc2);
        const lp = F.P(P.a - 0.25, P.t);
        FP.tableLamp(B, lp.x, lp.z, fy + 0.78, { rect: loc(r), r: 2.2, i: 0.34 });
        hb(P.a + 0.2, fy + 0.795, P.t, 0.16, 0.03, 0.12, 0x6a5a48);                    // a bowl for the keys
      }
      const livW = OPP[w];
      // shoes by the door on the living side, under a hook rail
      const sd = at(r, livW, 0.45, 0.16);
      for (let q = 0; q < 2; q++) { hb(0.3 + q * 0.16, fy + 0.03, sd.t, 0.11, 0.06, 0.27, [0x222222, 0x6a3a22][q]); hb(0.3 + q * 0.16, fy + 0.08, sd.t + (livW === "lo" ? -0.07 : 0.07), 0.1, 0.06, 0.1, [0x222222, 0x6a3a22][q]); }
      rw(r, livW, 0.45, fy + 1.72, 0.02, 0.6, 0.08, 0.02, look.wood);
      const cc = FP.COATS[(H(salt, 13, 0xC0A) * FP.COATS.length) | 0];
      rw(r, livW, 0.32, fy + 1.24, 0.09, 0.42, 0.68, 0.15, cc);
      rw(r, livW, 0.32, fy + 1.62, 0.08, 0.36, 0.1, 0.12, cc);
      void g; void mid;
    };

    const fireplace = function (r, w, a) {
      const BR = 0xe9e4da, DK = 0x1c1a18;
      rw(r, w, a, fy + 0.6, 0.14, 1.6, 1.2, 0.28, BR);                                 // the breast's surround
      rw(r, w, a, fy + 0.42, 0.285, 0.8, 0.72, 0.02, DK);                              // the firebox
      rw(r, w, a, fy + 0.03, 0.36, 1.7, 0.06, 0.5, 0x5b5852);                          // the hearth
      rw(r, w, a, fy + 1.23, 0.17, 1.8, 0.07, 0.36, shade(look.wood, 0.9));            // the mantel
      rw(r, w, a - 0.12, fy + 0.16, 0.3, 0.5, 0.1, 0.1, 0x3a2a1c); rw(r, w, a + 0.1, fy + 0.2, 0.3, 0.5, 0.1, 0.1, 0x4a3524);
      rw(r, w, a, fy + 0.14, 0.3, 0.3, 0.12, 0.06, 0xff8a3a, { glow: true });
      const p = at(r, w, a, 0.6), q = F.P(p.d, p.t);
      B.lamp(q.x, q.z, fy + 0.4, { r: 2.6, i: 0.3, color: 0xffa860, rect: loc(r) });
      art(r, w, a, fy + 1.95, 1.1, 0.8, FP.ART[(H(salt, 3, 0xA31) * FP.ART.length) | 0]);
      for (const e of [-1, 1]) rw(r, w, a + e * 0.62, fy + 1.34, 0.17, 0.07, 0.16, 0.07, 0xb99347);   // candlesticks
      const body = at(r, w, a, 0.3);
      r._keep.push(w === "front" || w === "back" ? { d0: Math.min(body.d - 0.35, body.d + 0.35), d1: Math.max(body.d - 0.35, body.d + 0.35), t0: a - 0.9, t1: a + 0.9 }
        : { d0: a - 0.9, d1: a + 0.9, t0: body.t - 0.35, t1: body.t + 0.35 });
    };

    const R_living = function (r) {
      const outer = outerOf(r), inner = OPP[outer];
      const sofaLen = Math.min(T.sofa, r.d1 - r.d0 - 1.2);
      // the television on the hall wall, past the way in; the sofa across the
      // room from it, under the side windows
      const tvD = r.doors.length ? clamp(r.doors[0].a + r.doors[0].w / 2 + 0.25 + T.tv * 0.5 + 0.2, r.d0 + 1.2, r.d1 - T.tv * 0.5 - 0.3) : (r.d0 + r.d1) / 2;
      const tv = put(r, inner, tvD, Math.max(1.2, T.tv), 0.42, 0.5);
      const sd = tv ? tv.a : (r.d0 + r.d1) / 2;
      const sofa = sofaLen >= 1.5 ? put(r, outer, sd, sofaLen, 0.9, 0.9) : null;
      if (tv) FP.drawTV(B, tv.x, tv.z, tv.yaw, Math.max(1.2, T.tv));
      let seat = null;
      if (sofa) {
        const S = kit("sofa", sofa, { len: sofaLen, tone: tone });
        if (S && S.seats && S.seats[0] && S.seats[0].rec) seat = S.seats[0];
        const ct = at(r, outer, sofa.a, 0.02 + 0.9 + 0.55), cp = F.P(ct.d, ct.t);
        B.furn("coffee", cp.x, cp.z, sofa.yaw, { len: Math.min(1.2, sofaLen - 0.6), deep: 0.55, tone: tone });
        r._keep.push({ d0: ct.d - 0.7, d1: ct.d + 0.7, t0: ct.t - 0.4, t1: ct.t + 0.4 });
        rug(ct.d, ct.t, sofaLen + 0.5, 2.2, look.rug);
        // what is on the coffee table says who lives here
        const ty = fy + 0.4;
        if (plan.tier === "poor") { hb(ct.d + 0.2, ty + 0.025, ct.t, 0.36, 0.05, 0.36, 0xc8a070); for (let q = 0; q < 3; q++) hb(ct.d - 0.25 + q * 0.09, ty + 0.06, ct.t + (q - 1) * 0.08, 0.066, 0.12, 0.066, [0xc03030, 0x3060b0, 0xd0d0d0][q]); }
        else { hb(ct.d, ty + 0.01, ct.t + 0.05, 0.3, 0.02, 0.22, FP.ART[salt % FP.ART.length]); hb(ct.d + 0.26, ty + 0.05, ct.t - 0.06, 0.09, 0.1, 0.09, 0xf2f2f0); }
        // a floor lamp at the sofa's end
        const le = at(r, outer, sofa.a + sofaLen / 2 + 0.32, 0.3);
        if (free(r, { d0: le.d - 0.2, d1: le.d + 0.2, t0: le.t - 0.2, t1: le.t + 0.2 })) {
          const lp = F.P(le.d, le.t);
          B.furn("lamp", lp.x, lp.z, 0, { h: 1.55 });
          B.lamp(lp.x, lp.z, fy + 1.4, { r: 3.0, i: 0.42, rect: loc(r) });
          r._keep.push({ d0: le.d - 0.2, d1: le.d + 0.2, t0: le.t - 0.2, t1: le.t + 0.2 });
        }
        if (plan.tier !== "rich") art(r, outer, sofa.a, fy + 1.62, 0.9, 0.6, FP.ART[(H(salt, 7, 0xA28) * FP.ART.length) | 0]);
      }
      // a house with money has a fire on the back wall and chairs to it
      if (plan.tier === "rich" && r.t1 - r.t0 >= 4.2) {
        const W = wallOf(r, "back");
        fireplace(r, "back", clamp((W.lo + W.hi) / 2, W.lo + 1.2, W.hi - 1.2));
      }
      // an armchair at the front, turned to the room
      if (plan.tier !== "poor") {
        const ac = put(r, "front", outer === "hi" ? r.t1 - 1.5 : r.t0 + 1.5, 0.95, 0.92, 0.5);
        if (ac) kit("armchair", ac, { tone: tone });
      }
      // a bookcase on the back wall, out of the windows' way
      if (plan.tier !== "poor" || H(salt, 5, 0xB00) < 0.4) {
        const bc = put(r, "back", outer === "hi" ? r.t1 - 0.8 : r.t0 + 0.8, 1.0, 0.34, 0.5, { noWin: true });
        bookcase(r, bc, 1.0, plan.tier === "rich" ? 2.1 : 1.8);
      }
      // a plant in the front corner
      const pc = at(r, outer, r.d0 + 0.45, 0.45);
      if (free(r, { d0: pc.d - 0.3, d1: pc.d + 0.3, t0: pc.t - 0.3, t1: pc.t + 0.3 })) { const pp = F.P(pc.d, pc.t); FP.plant(B, pp.x, pp.z, fy, true, salt); }
      lightAt(r, sd, (r.t0 + r.t1) / 2, { kind: T.light, drop: 0.55, r: 5 });
      if (r.d1 - r.d0 > 4.6) lightAt(r, r.d0 + 1.0, (r.t0 + r.t1) / 2, { kind: "dome", r: 3.6, i: 0.4 });
      // somebody home: on the sofa by day
      if (seat && H(salt, 21, 0x9E0) < 0.5) B.person({ x: seat.x - B.ox, z: seat.z - B.oz, face: seat.face, seat: seat.rec, when: "day", opts: { resident: true } });
    };

    // the fitted run a flat has, along `len` of wall w from `from` (a coordinate along it)
    const kitchenRun = function (r, w, a0, a1) {
      const W = wallOf(r, w);
      const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
      if (hi - lo < 1.5) return false;
      // d of the part runs along the wall, from the end nearer the room's own door
      const dir = W.d != null ? dirL(0, a1 > a0 ? 1 : -1) : dirL(a1 > a0 ? 1 : -1, 0);
      const p0 = at(r, w, a0, 0), P0 = F.P(p0.d, p0.t), inw = dirL(W.dd, W.dt);
      const SF = subFrame(P0, dir.x, dir.z, r);
      const alongX = Math.abs(dir.z) > 0.5;
      const sK = -(alongX ? inw.x : inw.z);
      const U = { alongX: alongX, inX: dir.x, inZ: dir.z, n: salt & 255, floor: k };
      const tenant = plan.tier === "poor" ? "messy" : (H(salt, 31, 0x7E4) < 0.3 ? "family" : "tidy");
      try {
        FP.kitchen(B, U, SF, { kitchen: { d0: 0.06, d1: hi - lo, tEdge: 0, tFront: -sK * 0.62, behindBath: false }, sK: sK, sB: -sK, wood: look.wood, tenant: tenant }, salt, false);
      } catch (e) { return false; }
      const c0 = at(r, w, lo, 0), c1 = at(r, w, hi, 0.66);
      const body = { d0: Math.min(c0.d, c1.d), d1: Math.max(c0.d, c1.d), t0: Math.min(c0.t, c1.t), t1: Math.max(c0.t, c1.t) };
      r._keep.push(body);
      const R = F.R(body.d0, body.d1, body.t0, body.t1);
      B.solid(R.x0, R.x1, R.z0, R.z1, fy, fy + 0.92);
      B.loot((R.x0 + R.x1) / 2, (R.z0 + R.z1) / 2, "kitchen");
      return true;
    };
    // a table and its chairs, as near (d, t) as the room allows; a smaller one
    // where the one asked for does not fit. Returns { d, t, len } or null.
    const tableSet = function (r, d, t, len, deep, seats, alongD) {
      for (let L = len; L >= 0.85; L -= 0.3) {
        const n = L >= 1.9 ? Math.min(seats, 6) : L >= 1.3 ? Math.min(seats, 4) : Math.min(seats, 2);
        const hx = (alongD ? L : deep) / 2 + (n > 2 || !alongD ? 0.5 : 0.1), ht = (alongD ? deep : L) / 2 + (n > 2 || alongD ? 0.5 : 0.1);
        for (let ring = 0; ring <= 6; ring++) {
          for (const o of (ring ? [[ring, 0], [-ring, 0], [0, ring], [0, -ring], [ring, ring], [-ring, -ring], [ring, -ring], [-ring, ring]] : [[0, 0]])) {
            const dd = d + o[0] * 0.25, tt = t + o[1] * 0.25;
            if (!free(r, { d0: dd - hx, d1: dd + hx, t0: tt - ht, t1: tt + ht })) continue;
            r._keep.push({ d0: dd - hx + 0.1, d1: dd + hx - 0.1, t0: tt - ht + 0.1, t1: tt + ht - 0.1 });
            const p = F.P(dd, tt);
            B.furn("table", p.x, p.z, alongD ? F.yaw(0, 1) : F.yaw(1, 0), { len: L, deep: deep, seats: n, tone: { wood: look.wood, cloth: look.sofa } });
            return { d: dd, t: tt, len: L, x: p.x, z: p.z };
          }
        }
      }
      return null;
    };
    const R_kitchen = function (r) {
      const inner = innerOf(r), outer = OPP[inner];
      // the run on the hall wall, from the front wall back to the doorway
      const dr = r.doors[0];
      const end = dr && dr.wall === "back" ? r.d1 - 1.12 : r.d1 - 0.1;
      kitchenRun(r, inner, r.d0 + 0.08, end);
      const wd = r.t1 - r.t0;
      if (wd >= 3.1) {
        const tt = outer === "hi" ? r.t1 - Math.min(1.45, (wd - 0.7) / 2) : r.t0 + Math.min(1.45, (wd - 0.7) / 2);
        const big = wd >= 4.2 && plan.tier !== "poor";
        const tb = tableSet(r, r.d0 + (r.d1 - r.d0) * 0.46, tt, big ? 1.5 : 1.0, 0.85, big ? 4 : 2, true);
        if (tb) { B.light(tb.x, tb.z, { kind: plan.tier === "poor" ? "bulb" : "pendant", drop: 0.75, r: 3.6, i: 0.55, rect: loc(r), shade: look.accent }); hb(tb.d, fy + 0.8, tb.t, 0.24, 0.1, 0.24, 0x8a9a6a); }
      }
      // a bin by the back door, a tall cupboard where there is wall for it
      const cb = put(r, outer, r.d1 - 0.6, 0.9, 0.5, 0.6, { noWin: true });
      if (cb && plan.tier !== "poor") kit("wardrobe", cb, { len: 0.9, h: 2.05, deep: 0.5, tone: { wood: 0xe6e2da } });
      else if (cb) { hb(cb.d, fy + 0.32, cb.t, 0.34, 0.64, 0.34, 0x4a4f55); hb(cb.d, fy + 0.66, cb.t, 0.36, 0.04, 0.36, 0x2a2c30); }
      lightAt(r, (r.d0 + r.d1) / 2, (r.t0 + r.t1) / 2, { kind: T.light === "pendant" ? "can" : T.light, r: 4.6, i: 0.55 });
    };

    const R_dining = function (r) {
      const dc = (r.d0 + r.d1) / 2, tc = (r.t0 + r.t1) / 2, dp = r.d1 - r.d0, wd = r.t1 - r.t0;
      const alongD = dp > wd, room = Math.max(dp, wd);
      const len = clamp(room - 2.0, 1.2, plan.tier === "rich" ? 2.6 : 2.0);
      const tb = tableSet(r, dc, tc, len, 0.95, len >= 1.9 ? 6 : 4, alongD);
      if (tb) {
        B.light(tb.x, tb.z, { kind: "pendant", drop: 0.8, r: 4.6, i: 0.6, rect: loc(r), shade: look.accent });
        rug(tb.d, tb.t, alongD ? tb.len + 1.3 : 2.5, alongD ? 2.5 : tb.len + 1.3, look.rug);
        hb(tb.d, fy + 0.8, tb.t, 0.3, 0.12, 0.3, 0x7a8a9a);
      } else lightAt(r, dc, tc, { kind: "dome" });
      const sb = put(r, innerOf(r), dc, 1.5, 0.45, 0.6);
      if (sb) { kit("credenza", sb, { len: 1.5, h: 0.82, deep: 0.45, tone: tone }); art(r, sb.wall, sb.a, fy + 1.55, 1.1, 0.7, FP.ART[(H(salt, 4, 0xA32) * FP.ART.length) | 0]); }
    };

    const R_study = function (r) {
      const outer = outerOf(r);
      // the desk at the back window, looking out
      const dk = put(r, "back", outer === "hi" ? r.t1 - 1.3 : r.t0 + 1.3, 1.5, 0.72, 0.95) || put(r, outer, (r.d0 + r.d1) / 2, 1.5, 0.72, 0.95);
      if (dk) {
        const p = F.P(dk.d, dk.t);
        B.furn("desk", p.x, p.z, F.yaw(-dk.dd, -dk.dt), { len: 1.5, deep: 0.7 });
        const lp = at(r, dk.wall, dk.a + 0.5, 0.3), lq = F.P(lp.d, lp.t);
        FP.tableLamp(B, lq.x, lq.z, fy + 0.745, { rect: loc(r) });
        FP.drawLaptop(B, p.x, p.z, fy + 0.745);
      }
      const b1 = put(r, outer, r.d0 + 0.9, 1.1, 0.34, 0.5, { noWin: true });
      bookcase(r, b1, 1.1, 2.0);
      const ac = put(r, "front", outer === "hi" ? r.t1 - 0.9 : r.t0 + 0.9, 0.95, 0.92, 0.5);
      if (ac) { kit("armchair", ac, { tone: tone }); const lp = at(r, "front", ac.a + (outer === "hi" ? -0.75 : 0.75), 0.3), lq = F.P(lp.d, lp.t); if (free(r, { d0: lp.d - 0.2, d1: lp.d + 0.2, t0: lp.t - 0.2, t1: lp.t + 0.2 })) { B.furn("lamp", lq.x, lq.z, 0, { h: 1.5 }); B.lamp(lq.x, lq.z, fy + 1.4, { r: 2.6, i: 0.4, rect: loc(r) }); } }
      rug((r.d0 + r.d1) / 2, (r.t0 + r.t1) / 2, Math.min(2.4, r.d1 - r.d0 - 1.2), Math.min(2.0, r.t1 - r.t0 - 1.2), shade(look.rug, 0.85));
      lightAt(r, (r.d0 + r.d1) / 2, (r.t0 + r.t1) / 2, { kind: "dome" });
    };

    const R_bed = function (r, idx) {
      const outer = outerOf(r), inner = OPP[outer];
      const dp = r.d1 - r.d0, wd = r.t1 - r.t0;
      const small = Math.min(dp, wd) < 2.9;
      const wide = small ? 0.95 : (r.master ? T.bedW : Math.min(1.4, T.bedW));
      const L = 2.05;
      const ownSpot = plan.spots.wardrobe && plan.spots.wardrobe.room === r;
      // the head on the outside wall; a narrow room turns the bed to its end wall
      let head = outer, P = null, ns = true;
      const tryBed = function (w, withNs) {
        const W = wallOf(r, w);
        return put(r, w, (W.lo + W.hi) / 2, wide + (withNs ? 1.0 : 0.1), L + 0.16, 0.55, { gap: 0 });
      };
      if (wd >= L + 1.3) P = tryBed(outer, true) || tryBed(outer, false);
      if (P && P.R && (P.R.d1 - P.R.d0 < wide + 0.6 || P.R.t1 - P.R.t0 < wide + 0.6)) ns = false;
      if (!P) { for (const w of ["back", "front", outer, inner]) { P = tryBed(w, true); if (P) { head = w; break; } } }
      if (!P) { ns = false; for (const w of ["back", outer, "front", inner]) { P = tryBed(w, false); if (P) { head = w; break; } } }
      let bedRec = null;
      if (P) {
        const W = wallOf(r, head);
        const c = at(r, head, P.a, 0.14 + L / 2), cp = F.P(c.d, c.t);
        const bd = B.furn("bed", cp.x, cp.z, F.yaw(-W.dd, -W.dt), { len: L, wide: wide, tone: { linen: 0xe8e8ee, duvet: r.master ? look.linen : pick(FP.LINEN, 20 + idx), frame: tone.frame } });
        // (propuse files a bed once; a rebuilt floor gets the record the first build kept)
        if (bd && bd.beds && bd.beds[0]) r._bedRec = bd.beds[0];
        bedRec = r._bedRec || null;
        if (bedRec && r.master && H(salt, 22, 0x9E1) < 0.5 && !owned)
          B.person({ x: cp.x, z: cp.z, face: F.yaw(-W.dd, -W.dt), bed: bedRec, when: "night", opts: { resident: true } });
        B.loot(cp.x, cp.z, "mattress");
        if (ns) {
          for (const e of [-1, 1]) {
            const na = P.a + e * (wide / 2 + 0.3);
            if (na < W.lo + 0.24 || na > W.hi - 0.24) continue;
            if (plan.tier === "poor" && e > 0) continue;
            const n0 = at(r, head, na, 0.25);
            const ty = FP.nightstand(B, G, n0.d, n0.t, look.wood, W.dd, W.dt);
            const lq = F.P(n0.d, n0.t);
            FP.tableLamp(B, lq.x, lq.z, ty, { rect: loc(r) });
          }
        }
        // a rug at the foot
        const f = at(r, head, P.a, 0.14 + L * 0.8);
        if (W.d != null) rug(f.d, f.t, 1.5, wide + 0.9, shade(look.rug, r.master ? 1 : 0.9)); else rug(f.d, f.t, wide + 0.9, 1.5, shade(look.rug, r.master ? 1 : 0.9));
        art(r, head, P.a, fy + 1.6, Math.min(1.0, wide), 0.6, FP.ART[(H(salt + idx, 9, 0xA27) * FP.ART.length) | 0]);
      }
      // the wardrobe: in the closet nook (the main bedroom's is the owner's:
      // the house's own piece stands on the place city/realestate.js asks for)
      const wOpt = { len: 1.2, h: 2.1, deep: 0.6, tone: { wood: look.wood } };
      if (ownSpot) {
        const sp = plan.spots.wardrobe, p = F.P(sp.d, sp.t);
        if (B.furn("wardrobe", p.x, p.z, F.yaw(-sp.fd, -sp.ft), wOpt)) B.loot(p.x, p.z, "closet");
      } else if (r.alc && r.alc.t1 - r.alc.t0 >= 1.5) {
        const A = { d0: r.alc.d0, d1: r.alc.d1, t0: r.alc.t0, t1: r.alc.t1, alc: null, ext: {}, _keep: r._keep, doors: [] };
        const wp = put(A, "front", (A.t0 + A.t1) / 2, 1.2, 0.62, 0.3);
        if (wp && kit("wardrobe", wp, wOpt)) B.loot(wp.x, wp.z, "closet");
      } else {
        const wp = put(r, inner, (r.d0 + r.d1) / 2 + 0.6, 1.2, 0.62, 0.6, { noWin: true }) || put(r, "front", null, 1.2, 0.62, 0.6, { noWin: true });
        if (wp && kit("wardrobe", wp, wOpt)) B.loot(wp.x, wp.z, "closet");
      }
      // the closet nook: a rail of clothes on its outer end
      if (r.alc && r.alc.t1 - r.alc.t0 >= 2.4) {
        const a = r.alc, e = outer === "hi" ? a.t1 : a.t0, sg = outer === "hi" ? -1 : 1, dm = (a.d0 + a.d1) / 2;
        hb(dm, fy + 1.72, e + sg * 0.3, a.d1 - a.d0 - 0.1, 0.03, 0.03, CHROME);
        for (let q = 0; q < 6; q++) hb(a.d0 + 0.14 + q * ((a.d1 - a.d0 - 0.28) / 5), fy + 1.34, e + sg * 0.3, 0.05, 0.7, 0.44, FP.COATS[(q + salt) % FP.COATS.length]);
        hb(dm, fy + 1.98, e + sg * 0.22, a.d1 - a.d0 - 0.04, 0.03, 0.42, look.wood);
      }
      // a chest of drawers on the inside wall
      if (!small) {
        const cd = put(r, inner, (r.d0 + r.d1) / 2, 1.1, 0.46, 0.6);
        if (cd) {
          kit("credenza", cd, { len: 1.1, h: 0.86, deep: 0.46, n: 2, tone: tone });
          if (plan.tier !== "poor") { rw(r, cd.wall, cd.a, fy + 1.5, 0.02, 0.7, 0.9, 0.03, shade(look.wood, 0.85)); rw(r, cd.wall, cd.a, fy + 1.5, 0.037, 0.6, 0.8, 0.004, 0xaebbc2); }
        }
      }
      // a second bedroom is somebody's: a desk at the window, or a child's things
      if (!r.master && !small && plan.tier !== "poor") {
        const dk = put(r, "back", null, 1.2, 0.66, 0.9) || put(r, "front", null, 1.2, 0.66, 0.9);
        if (dk) { const p = F.P(dk.d, dk.t); B.furn("desk", p.x, p.z, F.yaw(-dk.dd, -dk.dt), { len: 1.2, deep: 0.62 }); FP.drawLaptop(B, p.x, p.z, fy + 0.745); }
      }
      if (plan.tier === "poor") {
        // a heap of clothes on the floor
        const hp = at(r, inner, (r.d0 + r.d1) / 2 - 0.9, 0.5);
        if (free(r, { d0: hp.d - 0.3, d1: hp.d + 0.3, t0: hp.t - 0.3, t1: hp.t + 0.3 })) { hb(hp.d, fy + 0.04, hp.t, 0.55, 0.08, 0.45, 0x4a5a7a); hb(hp.d + 0.08, fy + 0.1, hp.t - 0.05, 0.36, 0.06, 0.3, 0x2a2a2e); hb(hp.d - 0.1, fy + 0.14, hp.t + 0.04, 0.26, 0.04, 0.22, 0xb8b0a0); }
      }
      lightAt(r, (r.d0 + r.d1) / 2, (r.t0 + r.t1) / 2, { kind: T.light === "pendant" ? "dome" : T.light, r: 4.6, i: 0.55 });
    };

    // a WC against wall w of room r at `a` along it, a vanity likewise
    const wcOn = function (r, w, a) {
      const W = wallOf(r, w), p = at(r, w, a, 0), P = F.P(p.d, p.t), inw = dirL(W.dd, W.dt);
      FP.toilet(B, subFrame(P, inw.x, inw.z, r), 0, H(salt, 5, 0x7C1) < 0.3);
      const c = at(r, w, a, 0.34);
      r._keep.push({ d0: c.d - 0.45, d1: c.d + 0.45, t0: c.t - 0.45, t1: c.t + 0.45 });
      const R = F.R(c.d - 0.22, c.d + 0.22, c.t - 0.22, c.t + 0.22);
      B.solid(R.x0, R.x1, R.z0, R.z1, fy, fy + 0.42);
      // the paper beside it
      rw(r, w, a + 0.42, fy + 0.7, 0.07, 0.11, 0.11, 0.11, 0xf8f6f0);
    };
    const vanityOn = function (r, w, a) {
      const W = wallOf(r, w), p = at(r, w, a, 0), P = F.P(p.d, p.t), inw = dirL(W.dd, W.dt);
      // the part's frame runs along the wall; the wall is its t = 0
      const runX = Math.abs(inw.z) > 0.5;
      const SF = subFrame(P, runX ? 1 : 0, runX ? 0 : 1, r);
      const s = runX ? Math.sign(inw.z) : Math.sign(inw.x);
      FP.vanity(B, SF, 0, 0, s);
      FP.fbox(B, SF, 0, fy + 1.55, s * 0.06, 0.55, 0.7, 0.12, 0xe4e4e0);
      FP.fbox(B, SF, 0, fy + 1.55, s * 0.1215, 0.53, 0.68, 0.003, 0xaebbc2);
      FP.fbox(B, SF, 0, fy + 1.97, s * 0.05, 0.5, 0.05, 0.08, 0xd8d8d4);
      FP.fbox(B, SF, 0, fy + 1.9445, s * 0.05, 0.46, 0.004, 0.05, 0xfff6e6, { glow: true, faces: 8 });
      B.loot(P.x, P.z, "medicine");
      const c = at(r, w, a, 0.24);
      r._keep.push({ d0: c.d - 0.45, d1: c.d + 0.45, t0: c.t - 0.45, t1: c.t + 0.45 });
      const R = F.R(c.d - (W.d != null ? 0.24 : 0.32), c.d + (W.d != null ? 0.24 : 0.32), c.t - (W.d != null ? 0.32 : 0.24), c.t + (W.d != null ? 0.32 : 0.24));
      B.solid(R.x0, R.x1, R.z0, R.z1, fy, fy + 0.86);
    };
    const R_bath = function (r) {
      const dr = r.doors[0] || { wall: "front", a: (r.t0 + r.t1) / 2, w: 0.78 };
      const dw = dr.wall, far = OPP[dw];
      const Wd = wallOf(r, dw), Wf = wallOf(r, far);
      const depth = Wd.deep, width = Wd.hi - Wd.lo;
      // which side wall the open leaf lies on (the door is hung by it)
      const sideLo = dw === "front" || dw === "back" ? "lo" : "front", sideHi = OPP[sideLo];
      const leafW = (dr.a - Wd.lo) <= (Wd.hi - dr.a) ? sideLo : sideHi, otherW = OPP[leafW];
      const utility = r.type === "wc";
      // THE BATH along the far wall, a screen at its tap end, a shower over it
      const tubL = Math.min(1.7, width - 0.06), hasTub = !utility && width >= 1.55 && depth >= 2.3;
      if (hasTub) {
        const ac = leafW === sideLo ? Wd.hi - 0.03 - tubL / 2 : Wd.lo + 0.03 + tubL / 2;
        const sill = winsOn(r, far).reduce(function (m, q) { return Math.min(m, q.y0); }, 9);
        rw(r, far, ac, fy + 0.28, 0.39, tubL, 0.56, 0.75, PORC);                       // the tub's apron and rim
        rw(r, far, ac, fy + 0.562, 0.39, tubL - 0.14, 0.004, 0.6, 0xb9c6cc, { faces: 4 });   // the water line in shadow
        const te = ac + (leafW === sideLo ? 1 : -1) * (tubL / 2 - 0.12);              // the tap end, by the far side wall
        rw(r, far, te, fy + 0.66, 0.39, 0.05, 0.14, 0.05, CHROME);
        rw(r, far, te - (leafW === sideLo ? 0.08 : -0.08), fy + 0.72, 0.39, 0.16, 0.03, 0.03, CHROME);
        if (sill > 2.0 || !r.ext[far]) { rw(r, far, te, fy + 1.5, 0.06, 0.022, 1.3, 0.022, CHROME); rw(r, far, te, fy + 2.12, 0.2, 0.2, 0.014, 0.2, CHROME); }
        // a glass screen across the tub's open edge, at the tap end
        rw(r, far, te - (leafW === sideLo ? 0.5 : -0.5), fy + 1.3, 0.77, 0.9, 1.5, 0.01, 0xcfe3ea, { glass: true });
        const c0 = at(r, far, ac - tubL / 2, 0), c1 = at(r, far, ac + tubL / 2, 0.76);
        const body = { d0: Math.min(c0.d, c1.d), d1: Math.max(c0.d, c1.d), t0: Math.min(c0.t, c1.t), t1: Math.max(c0.t, c1.t) };
        r._keep.push(body);
        const R = F.R(body.d0, body.d1, body.t0, body.t1);
        B.solid(R.x0, R.x1, R.z0, R.z1, fy, fy + 0.56);
        // a mat before it
        const m = at(r, far, ac, 1.05);
        if (W_isD(far)) rug(m.d, m.t, 0.5, 0.8, look.accent); else rug(m.d, m.t, 0.8, 0.5, look.accent);
      }
      let hasShower = false;
      if (!hasTub && !utility && width >= 1.5 && depth >= 1.7) {
        // no room for a bath: a shower in the far corner away from the door,
        // a low tray, glass on its two open sides, a head on a riser
        hasShower = true;
        const sw = Math.min(0.9, width * 0.45);
        const ac = leafW === sideLo ? Wd.hi - 0.03 - sw / 2 : Wd.lo + 0.03 + sw / 2, e = leafW === sideLo ? -1 : 1;
        rw(r, far, ac, fy + 0.02, 0.02 + sw / 2, sw, 0.04, sw, 0xeeeeec);
        rw(r, far, ac, fy + 1.03, 0.02 + sw, sw, 1.9, 0.01, 0xcfe3ea, { glass: true });
        rw(r, far, ac + e * sw / 2, fy + 1.03, 0.02 + sw * 0.3, 0.01, 1.9, sw * 0.6, 0xcfe3ea, { glass: true });
        rw(r, far, ac, fy + 1.55, 0.05, 0.022, 1.1, 0.022, CHROME);
        rw(r, far, ac, fy + 2.1, 0.2, 0.2, 0.014, 0.2, CHROME);
        rw(r, far, ac, fy + 1.05, 0.03, 0.12, 0.12, 0.02, CHROME);
        const c0 = at(r, far, ac - sw / 2, 0), c1 = at(r, far, ac + sw / 2, sw + 0.04);
        r._keep.push({ d0: Math.min(c0.d, c1.d), d1: Math.max(c0.d, c1.d), t0: Math.min(c0.t, c1.t), t1: Math.max(c0.t, c1.t) });
      }
      // the WC on the wall away from the door's leaf, the vanity past the leaf
      const room = depth - (hasTub ? 0.8 : hasShower ? 0.95 : 0.1);
      const wcX = clamp(room * 0.5, 0.8, room - 0.5);
      wcOn(r, otherW, inFrom(r, dw, wcX));
      const vX = clamp(dr.w + 0.75, 1.2, room - 0.45);
      if (room >= 1.75) vanityOn(r, leafW, inFrom(r, dw, vX));
      else vanityOn(r, otherW, inFrom(r, dw, clamp(wcX - 0.95, 0.4, room)));
      // a towel on a rail
      const tx = inFrom(r, dw, clamp(wcX + 0.95, 0.9, room - 0.3));
      rw(r, otherW, tx, fy + 1.1, 0.06, 0.5, 0.02, 0.02, CHROME);
      rw(r, otherW, tx, fy + 0.9, 0.075, 0.42, 0.4, 0.035, look.accent);
      if (utility || (depth > 3.5 && plan.tier !== "poor")) {
        // room to spare: the washing machine and a linen cupboard
        const wm = put(r, leafW, inFrom(r, dw, room - 0.45), 0.62, 0.6, 0.5);
        if (wm) { hb(wm.d, fy + 0.43, wm.t, 0.6, 0.86, 0.6, 0xe9eaea); const f = at(r, wm.wall, wm.a, 0.02 + 0.6 + 0.008); hb(f.d, fy + 0.42, f.t, W_isD(wm.wall) ? 0.012 : 0.34, 0.34, W_isD(wm.wall) ? 0.34 : 0.012, 0x39424a); const R = F.R(wm.R.d0, wm.R.d1, wm.R.t0, wm.R.t1); B.solid(R.x0, R.x1, R.z0, R.z1, fy, fy + 0.86); }
        const lc = put(r, otherW, inFrom(r, dw, room - 0.4), 0.7, 0.42, 0.5, { noWin: true });
        if (lc) kit("wardrobe", lc, { len: 0.7, h: 1.9, deep: 0.42, tone: { wood: 0xe9e6de } });
      }
      const c = at(r, dw, (Wd.lo + Wd.hi) / 2, depth * 0.45), cp = F.P(c.d, c.t);
      B.light(cp.x, cp.z, { kind: "dome", r: 3.6, i: 0.7, rect: loc(r) });
      void Wf;
    };
    function W_isD(w) { return w === "front" || w === "back"; }

    const R_store = function (r) {
      // wardrobes along the inside wall, boxes, a mirror: a dressing room, or
      // the room the house keeps its things in
      const inner = innerOf(r);
      const n = Math.max(1, Math.min(3, Math.floor((r.d1 - r.d0 - 0.4) / 1.25)));
      for (let i = 0; i < n; i++) {
        const wp = put(r, inner, r.d0 + 0.75 + i * 1.25, 1.2, 0.6, 0.5);
        if (wp) kit("wardrobe", wp, { len: 1.2, h: 2.1, deep: 0.6, tone: { wood: r.type === "dress" ? 0xe9e6de : look.wood } });
      }
      const outer = OPP[inner];
      if (r.type === "dress") {
        const mp = put(r, outer, (r.d0 + r.d1) / 2, 0.7, 0.05, 0.6, { noWin: true });
        if (mp) { rw(r, outer, mp.a, fy + 1.0, 0.03, 0.6, 1.7, 0.03, shade(look.wood, 0.85)); rw(r, outer, mp.a, fy + 1.0, 0.047, 0.5, 1.6, 0.004, 0xaebbc2); }
      } else {
        for (let q = 0; q < 4; q++) {
          const bp = put(r, outer, r.d0 + 0.6 + q * 0.7, 0.55, 0.5, 0.2);
          if (bp) hb(bp.d, fy + 0.2 + (q & 1) * 0.06, bp.t, 0.5, 0.4 + (q & 1) * 0.12, 0.44, [0xb89468, 0xa98556, 0xc4a070][q % 3]);
        }
      }
      lightAt(r, (r.d0 + r.d1) / 2, (r.t0 + r.t1) / 2, { kind: T.light === "pendant" ? "dome" : T.light, r: 4, i: 0.5 });
    };

    const R_great = function (r) {
      // the cottage's one room: cooking on the bathroom's wall, a table by it,
      // the sofa under the front window facing the television on the back wall
      const s = plan.s, g = plan.g || {};
      const kSide = s > 0 ? "lo" : "hi", lSide = OPP[kSide];
      let ran = false;
      if (g.tD != null) {
        const a0 = s > 0 ? r.t0 + 0.08 : r.t1 - 0.08, a1 = s > 0 ? g.tD - 0.1 : g.tD + 0.1;
        if (Math.abs(a1 - a0) >= 1.9) ran = kitchenRun(r, "back", a0, a1);
      }
      if (!ran) ran = kitchenRun(r, kSide, r.d0 + 0.1, r.d1 - 0.1);
      const kc = s > 0 ? r.t0 + 1.7 : r.t1 - 1.7;
      const tb = tableSet(r, r.d0 + Math.min(1.25, (r.d1 - r.d0) * 0.36), kc, 1.0, 0.8, 2, false);
      if (tb) B.light(tb.x, tb.z, { kind: plan.tier === "poor" ? "bulb" : "pendant", drop: 0.75, r: 3.6, i: 0.55, rect: loc(r), shade: look.accent });
      const lc = s > 0 ? (0.9 + r.t1) / 2 : (r.t0 - 0.9) / 2;
      const sofaLen = Math.min(T.sofa, Math.abs((s > 0 ? r.t1 : r.t0) - (s > 0 ? 0.9 : -0.9)) - 0.5);
      const tv = put(r, "back", lc, Math.max(1.2, T.tv), 0.42, 0.5);
      const sofa = sofaLen >= 1.5 ? put(r, "front", tv ? tv.a : lc, sofaLen, 0.9, 0.8) : null;
      if (tv) FP.drawTV(B, tv.x, tv.z, tv.yaw, Math.max(1.2, T.tv));
      if (sofa) {
        kit("sofa", sofa, { len: sofaLen, tone: tone });
        const ct = at(r, "front", sofa.a, 0.02 + 0.9 + 0.5), cp = F.P(ct.d, ct.t);
        B.furn("coffee", cp.x, cp.z, sofa.yaw, { len: Math.min(1.1, sofaLen - 0.6), deep: 0.5, tone: tone });
        rug(ct.d, ct.t, 1.9, sofaLen + 0.4, look.rug);
      }
      const ac = put(r, lSide, r.d0 + (r.d1 - r.d0) * 0.5, 0.95, 0.92, 0.4);
      if (ac && plan.tier !== "poor") kit("armchair", ac, { tone: tone });
      lightAt(r, (r.d0 + r.d1) / 2, lc, { kind: T.light, drop: 0.5, r: 5 });
      hb(0.32, fy + 0.007, 0, 0.5, 0.014, 0.9, 0x4a3a2a, { faces: 4 });
      void lSide;
    };

    let bedIdx = 0;
    for (const r of fl.rooms) {
      prep(r);
      try {
        if (r.type === "hall" || r.type === "landing") R_hall(r);
        else if (r.type === "living") R_living(r);
        else if (r.type === "kitchen") R_kitchen(r);
        else if (r.type === "dining") R_dining(r);
        else if (r.type === "study") R_study(r);
        else if (r.type === "bed") R_bed(r, bedIdx++);
        else if (r.type === "bath" || r.type === "wc") R_bath(r);
        else if (r.type === "dress" || r.type === "store") R_store(r);
        else if (r.type === "great") R_great(r);
        else if (r.type === "studio") { R_great(r); R_bed(r, bedIdx++); }
      } catch (e) { if (window.console) console.warn("[house] room " + r.type + " failed", e); }
    }

    // ---- 5. THE STAIR'S JOINERY ---------------------------------------------------
    const S = plan.stair;
    if (S) {
      const OAK = 0x6b4a2e, PNT = 0xf1eee7;
      const tc = (S.lane[0] + S.lane[1]) / 2, lw = S.lane[1] - S.lane[0];
      const sg = S.open;                                   // the walk is on this side of the lane
      const inner = S.inner - sg * 0.02, wallT = S.wall + sg * 0.012;
      const bar = function (d0, ya, t0, d1, yb, t1, sv, sl, col, o) { const p = F.P(d0, t0), q = F.P(d1, t1); B.beam(p.x, ya, p.z, q.x, yb, q.z, sv, sl, col, o); };
      const FREE = { free: true, faces: 63 };
      for (const ft of S.flights) {
        if (ft.k === k) {
          const yN = function (d) { return ft.y0 + ft.rise + (d - S.dS) / S.g * ft.rise; };     // through the nosings
          // the strings: a board each side from the foot to the floor above
          bar(S.dS - 0.04, yN(S.dS - 0.04) - 0.13, inner, S.dT + 0.02, yN(S.dT + 0.02) - 0.13, inner, 0.36, 0.04, PNT);
          bar(S.dS - 0.04, yN(S.dS - 0.04) - 0.1, wallT, S.dT + 0.02, yN(S.dT + 0.02) - 0.1, wallT, 0.3, 0.022, PNT);
          // the handrail, 0.9 over the pitch; a newel at the foot
          bar(S.dS, yN(S.dS) + 0.9, inner, S.dT, yN(S.dT) + 0.9, inner, 0.055, 0.065, OAK, { mat: "wood" });
          hb(S.dS - 0.06, ft.y0 + (ft.rise + 1.02) / 2, inner, 0.1, ft.rise + 1.02, 0.1, PNT, FREE);
          hb(S.dS - 0.06, ft.y0 + ft.rise + 1.05, inner, 0.13, 0.05, 0.13, OAK, FREE);
          // a baluster on every tread
          for (let j = 1; j < S.n; j++) {
            const dc = S.dS + (j - 0.5) * S.g, top = ft.y0 + j * ft.rise, hh = yN(dc) + 0.875 - top;
            hb(dc, top + hh / 2, inner, 0.028, hh, 0.028, PNT, FREE);
          }
          if (k === 0) {
            // under the flight: panelled in, a cupboard door in its high end
            for (let j = 2; j < S.n; j++) {
              const dc = S.dS + (j - 0.5) * S.g, top = ft.y0 + j * ft.rise - 0.3;
              if (top - fy > 0.06) hb(dc, (fy + top) / 2, inner, S.g + 0.004, top - fy, 0.03, PNT, FREE);
            }
            const hi = ft.y0 + (S.n - 1) * ft.rise - 0.3;
            hb(S.dT - 0.02, (fy + hi) / 2, tc, 0.04, hi - fy, lw - 0.02, PNT, FREE);
            hb(S.dT + 0.004, fy + 0.95, tc, 0.012, 1.8, Math.min(0.7, lw - 0.2), shade(PNT, 0.96), FREE);
            hb(S.dT + 0.014, fy + 0.95, tc + 0.24, 0.02, 0.1, 0.03, 0xb9b4aa, FREE);
          } else {
            // an upper flight's soffit, seen from the flight below
            bar(S.dS, yN(S.dS) - 0.31, tc, S.dT, yN(S.dT) - 0.31, tc, 0.02, lw - 0.04, 0xf6f4f0, { mat: "plaster" });
          }
          // the well's edge, lined from this ceiling up to the floor above
          {
            const yb = ceil - 0.02, yt = ft.y1 + 0.01, ym = (yb + yt) / 2, hh = yt - yb;
            if (hh > 0.05) {
              hb((S.dS + S.dT) / 2, ym, S.inner + sg * 0.015, S.dT - S.dS + 0.06, hh, 0.03, 0xf6f4f0, FREE);
              hb((S.dS + S.dT) / 2, ym, S.wall - sg * 0.015, S.dT - S.dS + 0.06, hh, 0.03, 0xf6f4f0, FREE);
              hb(S.dS + 0.03, ym, tc, 0.03, hh, lw + 0.04, 0xf6f4f0, FREE);
              hb(S.dT + 0.015, ym, tc, 0.03, hh, lw + 0.04, 0xf6f4f0, FREE);
            }
          }
          const lp = F.P((S.dS + S.dT) / 2, tc + sg * 0.6);
          B.light(lp.x, lp.z, { kind: "dome", r: 4.4, i: 0.5 });
        }
        if (ft.k + 1 === k) {
          // THE WELL, on the floor the flight arrives at: a newel where it lands,
          // and (where no flight carries on up) a balustrade round the opening
          const yU = ft.y1;
          hb(S.dT + 0.05, yU + 0.52, inner, 0.1, 1.04, 0.1, PNT, FREE);
          hb(S.dT + 0.05, yU + 1.065, inner, 0.13, 0.05, 0.13, OAK, FREE);
          const more = S.flights.some(function (q) { return q.k === k; });
          if (!more) {
            const rail = function (d0, t0, d1, t1) {
              bar(d0, yU + 0.95, t0, d1, yU + 0.95, t1, 0.055, 0.065, OAK, { mat: "wood" });
              bar(d0, yU + 0.07, t0, d1, yU + 0.07, t1, 0.05, 0.04, PNT);
              const len = Math.hypot(d1 - d0, t1 - t0), n = Math.max(2, Math.round(len / 0.13));
              for (let i = 1; i < n; i++) hb(d0 + (d1 - d0) * i / n, yU + 0.51, t0 + (t1 - t0) * i / n, 0.028, 0.84, 0.028, PNT, FREE);
            };
            rail(S.dS - 0.02, inner, S.dT, inner);
            rail(S.dS - 0.02, inner, S.dS - 0.02, S.wall);
            hb(S.dS - 0.02, yU + 0.52, inner, 0.1, 1.04, 0.1, PNT, FREE);
            hb(S.dS - 0.02, yU + 1.065, inner, 0.13, 0.05, 0.13, OAK, FREE);
          }
        }
      }
    }
  });
})();
